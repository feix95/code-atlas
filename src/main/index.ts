import { app, dialog, ipcMain, shell, BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { basename, join } from 'node:path'
import { promises as fs } from 'node:fs'
import { scanDirectory } from '../scanner/index.ts'
import { annotateSummaries } from '../summarizer/index.ts'
import { analyzeSource, isAnalysisSupported } from '../analyzer/index.ts'
import { buildDependencyGraph } from '../depgraph/index.ts'
import { collectGitChanges, getChangeDiff } from '../git/index.ts'
import {
  explainWithModel,
  buildExplainPrompt,
  buildDiffPrompt,
  buildFolderPrompt,
  buildGuessPrompt,
  isBinaryFile,
  DIFF_SYSTEM_PROMPT,
  FOLDER_SYSTEM_PROMPT,
  GUESS_SYSTEM_PROMPT
} from '../ai/index.ts'
import { loadAiConfig, saveAiConfig, resolveAiTarget, type BuiltinRuntime } from '../ai/config.ts'
import { builtinNeedsRestart, ensureBuiltinServer, isBuiltinRunning, reapOrphanServer, stopBuiltinServer } from '../ai/builtin.ts'
import { BY_EXT } from '../parser/languages.ts'
import { joinRoot } from '../shared/paths.ts'
import type { AiConfig, AiDeltaPayload, ChatTarget } from '../shared/types.ts'

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/**
 * 文件夹/文件打不开时说人话:被 Windows 上锁的(EPERM/EACCES,常见于系统保护区)
 * 和真不存在的,必须分成两种说法 —— 谎报"不存在"会让用户以为自己删了什么东西
 */
function accessDeniedMessage(err: NodeJS.ErrnoException, kind: '文件夹' | '文件', relPath: string): string {
  if (err?.code === 'EPERM' || err?.code === 'EACCES') {
    return `「${relPath}」被 Windows 上了锁,软件没钥匙看不了 —— 这类多半是系统自管的内部文件夹,不是你的项目内容,不看也不影响`
  }
  return `${kind}不存在:${relPath}`
}

/** 读文件开头 64KB 当「内容片段」;含 空字节 = 二进制,返回 null */
async function readTextPreview(absPath: string): Promise<string | null> {
  const handle = await fs.open(absPath, 'r')
  try {
    const buf = Buffer.alloc(64 * 1024)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    const chunk = buf.subarray(0, bytesRead)
    if (chunk.includes(0)) return null
    return chunk.toString('utf8')
  } finally {
    await handle.close()
  }
}

/**
 * 三个讲解通道共用的前置:把当前 AI 配置收敛成 ChatTarget。
 * 选了内置模型就顺手把 llama-server 子进程拉起来(首次用 AI 才启动,不拖慢打开速度);
 * 没配好不抛异常,返回人话错误让界面原样展示。
 */
async function resolveChatTargetOrError(): Promise<{ target: ChatTarget } | { error: string }> {
  const config = await loadAiConfig(app.getPath('userData'))
  let runtime: BuiltinRuntime | undefined
  if (config.provider === 'builtin') {
    try {
      runtime = await ensureBuiltinServer(config.builtin)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
  const resolved = resolveAiTarget(config, runtime)
  return resolved.ok ? { target: resolved.target } : { error: resolved.message }
}

/**
 * 流式增量推送:渲染进程带 requestId 过来,就按 id 对号入座往回推
 * 'atlas:ai-delta',边生成边显示;没带 id(老调用方)就走一次性返回。
 */
function makeDeltaSender(event: IpcMainInvokeEvent, requestId: unknown): ((text: string) => void) | undefined {
  if (typeof requestId !== 'string' || requestId === '') return undefined
  return (text) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('atlas:ai-delta', { id: requestId, text } satisfies AiDeltaPayload)
    }
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'CodeAtlas',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // 外部链接交给系统浏览器打开,不在应用里开新窗口
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载 Vite 开发服务器,打包后加载本地文件
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  // 弹出系统"选择文件夹"对话框,返回所选路径;取消则返回 null
  ipcMain.handle('atlas:pick-folder', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const options: OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // 扫描指定文件夹,返回目录树 + 统计;顺手给每个节点打大白话速览标签
  ipcMain.handle('atlas:scan-folder', (_event, folderPath: unknown) => {
    if (typeof folderPath !== 'string' || folderPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    const result = scanDirectory(folderPath)
    return result.then((r) => {
      annotateSummaries(r.tree)
      return r
    })
  })

  // 分级扫描:点开某个还没探的子文件夹,只探这一层(预算内收工),返回子树 + 这一份统计
  ipcMain.handle('atlas:scan-subdir', (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    // 路径契约:绝对路径拼接只走 joinRoot;子树 relPath 必须带全项目前缀,拼回大树才不断链
    const result = scanDirectory(joinRoot(rootPath, relPath), relPath)
    return result.then((r) => {
      annotateSummaries(r.tree)
      return r
    })
  })

  // AST 分析单个文件;不支持的语言/超大文件返回 null(诚实的能力边界,不是出错)
  // 路径契约:收 (rootPath, relPath),绝对路径只能由 joinRoot 在这儿解析
  ipcMain.handle('atlas:analyze-file', async (_event, rootPath: unknown, relPath: unknown, languageId: unknown) => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string' || typeof languageId !== 'string') {
      throw new Error('参数不合法')
    }
    if (!isAnalysisSupported(languageId)) return null
    const absPath = joinRoot(rootPath, relPath) // relPath 想越界(.. 上跳、盘符注入)会在这里被拦
    const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
    if (stat instanceof Error) {
      throw new Error(accessDeniedMessage(stat, '文件', relPath))
    }
    if (!stat.isFile()) {
      throw new Error(`文件不存在:${relPath}`)
    }
    if (stat.size > 1_000_000) return null // 超过 1MB 的源码不解析,避免卡顿
    const code = await fs.readFile(absPath, 'utf8')
    return analyzeSource(code, languageId)
  })

  // 项目关系图:全项目谁引用谁。路径契约同 analyze-file,读文件只走 joinRoot
  ipcMain.handle('atlas:dep-graph', (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return buildDependencyGraph(rootPath)
  })

  // AI 配置:读 / 存(双 Provider:lmstudio 与 builtin 两个分支都收)
  ipcMain.handle('atlas:ai-config-get', () => loadAiConfig(app.getPath('userData')))
  ipcMain.handle('atlas:ai-config-save', async (_event, config: unknown) => {
    if (typeof config !== 'object' || config === null) throw new Error('配置不合法')
    const c = config as Partial<AiConfig>
    const lm = c.lmstudio
    const bi = c.builtin
    if (
      !lm || typeof lm.baseUrl !== 'string' || typeof lm.model !== 'string' ||
      !bi || typeof bi.serverPath !== 'string' || typeof bi.modelPath !== 'string'
    ) {
      throw new Error('配置不合法:缺 lmstudio / builtin 设置')
    }
    const previous = await loadAiConfig(app.getPath('userData'))
    const saved = await saveAiConfig(app.getPath('userData'), {
      provider: c.provider === 'builtin' ? 'builtin' : 'lmstudio',
      lmstudio: { baseUrl: lm.baseUrl, model: lm.model, apiKey: lm.apiKey ?? '' },
      builtin: { serverPath: bi.serverPath, modelPath: bi.modelPath }
    })
    // 垃圾不白占:切走了内置模式,或换了模型/引擎设置,旧子进程就地解散,
    // 下次用到 AI 时按新配置重新拉起 —— 不然讲着旧模型的旧账
    if (previous.provider === 'builtin' && saved.provider !== 'builtin' && isBuiltinRunning()) {
      stopBuiltinServer()
    }
    if (saved.provider === 'builtin' && builtinNeedsRestart(saved.builtin)) {
      stopBuiltinServer()
    }
    return saved
  })

  // 「AI 设置」选模型文件:引擎已内置,用户只需要挑一个 GGUF 模型
  ipcMain.handle('atlas:ai-pick-file', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'GGUF 模型', extensions: ['gguf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // 连接测试 + 列出本地模型:叫 LM Studio 报告它加载了哪些模型
  ipcMain.handle('atlas:ai-list-models', async (_event, baseUrl: unknown) => {
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') throw new Error('地址不能为空')
    const url = `${baseUrl.replace(/\/+$/, '')}/models`
    // 5 秒没应答就当没通:LM Studio 卡死时别让界面跟着无限转圈
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null)
    if (!res || !res.ok) {
      throw new Error(`连不上模型服务,检查 LM Studio 是否已启动(${baseUrl})`)
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return (data.data ?? []).map((m) => m.id)
  })

  // git 改动总览:谁动了、动了多少行。不是 git 仓库时返回 isGitRepo=false,不炸
  ipcMain.handle('atlas:git-changes', (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return collectGitChanges(rootPath)
  })

  // 人话讲解一个改动:diff 由主进程现场重取(不信任渲染进程传内容),再喂本地模型
  // 路径契约同 analyze-file:收 (rootPath, relPath),绝对路径只经 joinRoot 解析
  ipcMain.handle('atlas:git-explain-change', async (event, rootPath: unknown, relPath: unknown, requestId?: unknown) => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    const changes = await collectGitChanges(rootPath)
    if (!changes.isGitRepo) {
      return { status: 'error', text: '这个文件夹不在 git 仓库里,没有改动可讲', model: '', durationMs: 0 }
    }
    const change = changes.changes.find((c) => c.relPath === relPath)
    if (!change) {
      return { status: 'error', text: '这个文件当前没有改动', model: '', durationMs: 0 }
    }
    const changeDiff = await getChangeDiff(rootPath, change)
    if (!changeDiff) {
      return { status: 'error', text: change.binary ? '二进制文件没法逐行对比,讲不了' : '这个文件太大,讲不了(先拆小再试)', model: '', durationMs: 0 }
    }
    if (!changeDiff.diff.trim()) {
      return { status: 'error', text: '这个文件没有可逐行对比的内容(可能只改了权限/编码)', model: '', durationMs: 0 }
    }
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
    }
    const prompt = buildDiffPrompt({ relPath: change.relPath, kind: change.kind, diff: changeDiff.diff })
    return explainWithModel(resolved.target, prompt, DIFF_SYSTEM_PROMPT, makeDeltaSender(event, requestId))
  })

  // 人话解释一个文件:自动分流 —— AST 认识的语言摆结构(证据最硬);
  // 不认识的用名字 + 内容片段让模型猜(声明不确定);二进制直接本地人话,不劳烦模型
  // 路径契约同 analyze-file:收 (rootPath, relPath),绝对路径只经 joinRoot 解析
  ipcMain.handle(
    'atlas:ai-explain-file',
    async (event, rootPath: unknown, relPath: unknown, languageId: unknown, requestId?: unknown) => {
      if (typeof rootPath !== 'string' || typeof relPath !== 'string' || typeof languageId !== 'string') {
        throw new Error('参数不合法')
      }
      const resolved = await resolveChatTargetOrError()
      if ('error' in resolved) {
        return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
      }
      const absPath = joinRoot(rootPath, relPath) // relPath 想越界会在这里被拦
      const stat = await fs.stat(absPath).catch(() => null)
      if (!stat || !stat.isFile()) {
        throw new Error(`文件不存在:${relPath}`)
      }
      const name = relPath.split('/').pop() ?? relPath
      const onDelta = makeDeltaSender(event, requestId)

      // 结构流:证据最硬 —— 函数/类/导入导出都摆给模型
      if (isAnalysisSupported(languageId) && stat.size <= 1_000_000) {
        const code = await fs.readFile(absPath, 'utf8')
        const structure = await analyzeSource(code, languageId)
        if (structure) {
          const prompt = buildExplainPrompt({ relPath, name, languageName: structure.languageId, structure, graph: null })
          return explainWithModel(resolved.target, prompt, undefined, onDelta)
        }
      }

      // 兜底流:猜猜官 —— 名字 + 内容片段,推测并声明不确定
      if (isBinaryFile(name)) {
        return { status: 'unsupported', text: `「${name}」是图片/音视频/二进制文件,不是代码,就不用劳烦模型了`, model: '', durationMs: 0 }
      }
      const preview = stat.size === 0 ? '' : await readTextPreview(absPath)
      if (preview === null) {
        return { status: 'unsupported', text: `「${name}」看起来是二进制文件,不是代码,就不用劳烦模型了`, model: '', durationMs: 0 }
      }
      const languageName = BY_EXT.get(extOf(name))?.name ?? ''
      const prompt = buildGuessPrompt({ relPath, name, languageName, preview })
      return explainWithModel(resolved.target, prompt, GUESS_SYSTEM_PROMPT, onDelta)
    }
  )

  // 人话解释一个文件夹:目录清单就是证据;空文件夹直接本地人话,不劳烦模型
  // relPath 传 '' 表示解释项目根目录本身
  ipcMain.handle('atlas:ai-explain-folder', async (event, rootPath: unknown, relPath: unknown, requestId?: unknown) => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
    }
    const absPath = joinRoot(rootPath, relPath)
    const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
    if (stat instanceof Error) {
      throw new Error(accessDeniedMessage(stat, '文件夹', relPath || '(根目录)'))
    }
    if (!stat.isDirectory()) {
      throw new Error(`这不是一个文件夹:${relPath || '(根目录)'}`)
    }
    let dirents
    try {
      dirents = await fs.readdir(absPath, { withFileTypes: true })
    } catch (err) {
      // stat 能过但 readdir 被拒:也是"锁着",不是空文件夹
      throw new Error(accessDeniedMessage(err as NodeJS.ErrnoException, '文件夹', relPath || '(根目录)'), { cause: err })
    }
    if (dirents.length === 0) {
      return { status: 'unsupported', text: '这是个空文件夹,啥也没装,就不用劳烦模型了', model: '', durationMs: 0 }
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    const subdirs: string[] = []
    const files: string[] = []
    const languages = new Map<string, number>()
    for (const item of dirents) {
      if (item.isDirectory()) {
        subdirs.push(item.name)
        continue
      }
      if (!item.isFile()) continue // 符号链接等不靠谱的,跳过
      files.push(item.name)
      const langName = BY_EXT.get(extOf(item.name))?.name ?? '没认出的文件'
      languages.set(langName, (languages.get(langName) ?? 0) + 1)
    }
    const prompt = buildFolderPrompt({
      relPath,
      name: basename(absPath) || basename(rootPath),
      subdirs,
      files,
      languages: Object.fromEntries(languages)
    })
    return explainWithModel(resolved.target, prompt, FOLDER_SYSTEM_PROMPT, makeDeltaSender(event, requestId))
  })
}

/** 清掉 7 天前的崩溃转储(.dmp):单份好几 MB,崩几次就攒一坨,应用不该自己攒垃圾 */
async function cleanupOldCrashDumps(userDataDir: string): Promise<void> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const dirs = [join(userDataDir, 'Crashpad', 'reports'), join(userDataDir, 'Crashpad', 'pending')]
  for (const dir of dirs) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在 = 没崩过,好事
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.dmp')) continue
      const fullPath = join(dir, entry.name)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (stat && stat.mtimeMs < cutoff) {
        await fs.rm(fullPath, { force: true }).catch(() => {})
      }
    }
  }
}

app.whenReady().then(() => {
  createWindow()
  registerIpc()

  // 开场两件家务:上次异常退出留下的内置模型孤儿就地收尸(不占内存不堵端口);
  // 旧的崩溃转储过期的清掉。都是后台安静干,失败也不打扰启动
  void reapOrphanServer().catch(() => {})
  void cleanupOldCrashDumps(app.getPath('userData')).catch(() => {})

  // macOS:点 Dock 图标时,没有窗口就重新建一个
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  stopBuiltinServer() // 内置模型是子进程,退出时带走,不留孤儿进程占着显存
})

app.on('window-all-closed', () => {
  // Windows / Linux:关掉所有窗口就退出应用
  if (process.platform !== 'darwin') app.quit()
})
