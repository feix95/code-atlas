import { app, dialog, ipcMain, net, shell, BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { basename, join } from 'node:path'
import { promises as fs } from 'node:fs'
import { scanDirectory } from '../scanner/index.ts'
import { annotateSummaries } from '../summarizer/index.ts'
import { analyzeSource, isAnalysisSupported } from '../analyzer/index.ts'
import { buildDependencyGraph } from '../depgraph/index.ts'
import { collectGitChanges, getChangeDiff } from '../git/index.ts'
import {
  explainWithModel,
  explainWithMessages,
  buildExplainPrompt,
  buildDiffPrompt,
  buildFolderPrompt,
  buildGuessPrompt,
  buildBinaryPrompt,
  sniffBinaryKind,
  sanitizeHistory,
  sanitizeAttachment,
  buildFreeChatMessages,
  pickWebLookupQuery,
  resolveWebLookupMeta,
  buildRefineMessages,
  hasWebLookupSignal,
  hasSearchIntent,
  WEB_SIGNAL_INSTRUCTION,
  FREE_CHAT_SYSTEM_PROMPT,
  DIFF_SYSTEM_PROMPT,
  FOLDER_SYSTEM_PROMPT,
  GUESS_SYSTEM_PROMPT
} from '../ai/index.ts'
import { webLookupDetailed, webLookup, WEB_LOOKUP_TIMEOUT_MS, type LookupTransport } from '../ai/weblookup.ts'
import { loadAiConfig, saveAiConfig, resolveAiTarget, type BuiltinRuntime } from '../ai/config.ts'
import { builtinNeedsRestart, ensureBuiltinServer, isBuiltinRunning, reapOrphanServer, stopBuiltinServer } from '../ai/builtin.ts'
import { BY_EXT } from '../parser/languages.ts'
import { joinRoot } from '../shared/paths.ts'
import type { AiChatLookupPayload, AiChatResult, AiConfig, AiDeltaPayload, AiExplainResult, ChatTarget, DriveInfo, WebLookupMeta } from '../shared/types.ts'

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/**
 * 用户点名的问题(来自 AI 面板的预设问题/输入框):追加到证据后面,
 * 让模型围绕问题作答,而不是每次都做全面介绍。不传则保持原行为。
 */
function withQuestion(prompt: string, question: unknown): string {
  if (typeof question !== 'string') return prompt
  const q = question.trim()
  if (!q) return prompt
  return `${prompt}\n\n用户的问题:${q}\n请直接围绕这个问题回答(结合上面给出的文件信息),不要泛泛做全面介绍。`
}

/** 还在生成中的讲解请求,按 requestId 登记:渲染进程换了讲解目标,旧的就地掐掉,不让过气的生成占着模型排队 */
const explainAborters = new Map<string, AbortController>()

/**
 * 讲解通道的共用出口:证据优先,单问单答。question 是用户点名的问题(预设/输入框),
 * 追加到证据后面让模型围绕问题作答;lookupName(只传名字,绝不传路径)给着且开关开着时,
 * 首次讲解走联网增强:先正常讲,答案带「需要联网确认」信号才查公开资料并修正。
 * (自由聊天不在这里 —— 它有自己的 atlas:ai-chat 通道和人设,不往这条路上堆条件。)
 */
async function respondWithEvidence(
  event: IpcMainInvokeEvent,
  requestId: unknown,
  question: unknown,
  evidence: string,
  system: string | undefined,
  resolved: { target: ChatTarget; webLookup: boolean },
  lookupName?: string
): Promise<AiExplainResult> {
  const onDelta = makeDeltaSender(event, requestId)
  const hasQuestion = typeof question === 'string' && question.trim() !== ''
  if (resolved.webLookup && lookupName && !hasQuestion) {
    return explainWithWebLookup(requestId, evidence, system ?? FOLDER_SYSTEM_PROMPT, lookupName, resolved.target, onDelta)
  }
  return explainWithCancel(requestId, (signal) =>
    explainWithModel(resolved.target, withQuestion(evidence, hasQuestion ? question : undefined), system, onDelta, signal)
  )
}

/**
 * 联网增强的讲解:先安静地讲一遍(答案里可能带信号词),带信号就查公开资料、
 * 流式输出修正版;没信号/查不到/修正失败,都老老实实回落到本地推测的版本。
 */
async function explainWithWebLookup(
  requestId: unknown,
  evidence: string,
  system: string,
  lookupName: string,
  target: ChatTarget,
  onDelta: ((text: string) => void) | undefined
): Promise<AiExplainResult> {
  const first = await explainWithCancel(requestId, (signal) =>
    explainWithModel(target, evidence + WEB_SIGNAL_INSTRUCTION, system, undefined, signal)
  )
  if (first.status !== 'supported' || !hasWebLookupSignal(first.text)) return first
  const material = await webLookup(lookupName, electronFetchText).catch(() => '')
  if (!material) {
    // 查不到(没网/超时/太冷门):剥掉信号词,加上一句人话交代,回退本地推测
    const fallback = first.text.replace(/「?需要联网确认」?/g, '').trimEnd()
    return { ...first, text: `${fallback}\n\n(联网没查到这个,上面是本地推测。)` }
  }
  const refined = await explainWithCancel(requestId, (signal) =>
    explainWithMessages(target, buildRefineMessages(system, evidence, first.text, material), onDelta, signal)
  )
  return refined.status === 'supported' ? refined : first
}

/**
 * 带取消的讲解执行:requestId 对号入座。
 * 自动讲解时代用户会连点文件,旧生成必须能被掐断,模型才能马上讲下一个。
 */
async function explainWithCancel(
  requestId: unknown,
  run: (signal: AbortSignal) => Promise<AiExplainResult>
): Promise<AiExplainResult> {
  if (typeof requestId !== 'string' || requestId === '') {
    return run(new AbortController().signal)
  }
  const aborter = new AbortController()
  explainAborters.set(requestId, aborter)
  try {
    return await run(aborter.signal)
  } finally {
    explainAborters.delete(requestId)
  }
}

/**
 * 文件夹/文件打不开时说人话:被 Windows 上锁的(EPERM/EACCES,常见于系统保护区)
 * 和真不存在的,必须分成两种说法 —— 谎报"不存在"会让用户以为自己删了什么东西
 */
function accessDeniedMessage(err: NodeJS.ErrnoException, kind: '文件夹' | '文件', relPath: string): string {
  if (err?.code === 'EPERM' || err?.code === 'EACCES') {
    return `「${relPath}」被 Windows 上了锁,软件没钥匙看不了 —— 这类多半是系统自管的内部文件夹,不是你的项目内容,不看也不影响`
  }
  // Windows 核心文件(如 swapfile.sys)连 stat 都不给(EINVAL),独占占用是 EBUSY —— 不是"不存在",别谎报
  if (err?.code === 'EINVAL' || err?.code === 'EBUSY') {
    return `「${relPath}」被 Windows 独占占用(多半是系统自己管的核心文件),软件读不了 —— 不是你删了什么,不看也不影响`
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

/** 读文件头 64 字节给魔数识别用;只在 readTextPreview 已经成功打开过文件后调用,不另外兜错误 */
async function readHeader(absPath: string, bytes = 64): Promise<Buffer> {
  const handle = await fs.open(absPath, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * 联网查证的传输层:走 Chromium 的网络栈(net.fetch),跟用户浏览器一个路数 ——
 * 自动跟随系统代理设置,直连到不了的站点也能按用户自己的网络环境正常查。
 * 渲染进程依旧不碰网络,查询只发生在主进程。
 */
const electronFetchText: LookupTransport = async (url) => {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1' },
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** 字节数 → 人话大小(提示词里给模型的证据) */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 三个讲解通道共用的前置:把当前 AI 配置收敛成 ChatTarget。
 * 选了内置模型就顺手把 llama-server 子进程拉起来(首次用 AI 才启动,不拖慢打开速度);
 * 没配好不抛异常,返回人话错误让界面原样展示。
 * webLookup = 用户开没开「联网查证」(默认关):开着且讲解认不出品牌时才联网。
 */
async function resolveChatTargetOrError(): Promise<{ target: ChatTarget; webLookup: boolean } | { error: string }> {
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
  return resolved.ok ? { target: resolved.target, webLookup: config.webLookup === true } : { error: resolved.message }
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

/** 自由对话的联网状态播报:查着没查着都是程序说了算,按 requestId 对号推给界面挂标签 */
function sendChatLookup(event: IpcMainInvokeEvent, requestId: unknown, state: AiChatLookupPayload['state'], sources: string[]): void {
  if (typeof requestId !== 'string' || requestId === '') return
  if (!event.sender.isDestroyed()) {
    event.sender.send('atlas:ai-chat-lookup', { id: requestId, state, sources } satisfies AiChatLookupPayload)
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'CodeAtlas',
    // 圆角悬浮壳回归(模块四):frame:false 摘系统框,transparent 让四角露出真实桌面,
    // 14px 圆角 + 悬浮阴影全由 CSS 画。系统级圆角(DWM roundedCorners)只有 Windows 11
    // (build 22000+)认,本机 Win10 19045 不认 —— 所以抗锯齿圆角只有透明合成这一条路。
    // 上次「窗隐身」的病根已查明:不是透明本身,而是 show:false 时 ready-to-show 在
    // 4K + 150% 缩放屏上永不触发(实底窗同样隐身,第三十六锤补实测)。这次 show:false
    // 只是为了等首帧防白闪,但绝不指望 ready-to-show —— 露窗走下面的三保险链。
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // 系统影子跟着方框走,会描出一圈直角细线;悬浮阴影改由 CSS 画圆角的
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 首帧探测靠渲染层 rAF 发信号;窗口还藏着时后台节流会把 rAF 憋死,必须关掉
      backgroundThrottling: false
    }
  })

  // ── 露窗链:多路信号抢跑 + 无条件看门狗,窗口绝不永久隐身 ──
  // 本机实测(模块四验收):ready-to-show 只在 GPU 缓存健康时才来 —— 缓存被另一个
  // 实例锁住(Gpu Cache Creation failed)或被污染时就永远装死;当年「窗隐身」就是
  // 两实例缓存大战 + show 眼巴巴等 ready-to-show 叠出来的。所以下面每一路都只当快路,
  // 谁都不许当唯一依靠,3 秒看门狗才是保底。
  let shown = false
  let shownVia = 'never'
  const showOnce = (why: string): void => {
    if (shown || mainWindow.isDestroyed()) return
    shown = true
    shownVia = why
    mainWindow.show()
    console.log(`[window] 露窗方式:${why}`)
  }
  // 1) 常见快路:GPU 栈干净时它先到
  mainWindow.once('ready-to-show', () => showOnce('ready-to-show'))
  // 2) 渲染层双 rAF 信号(合成器肯给隐藏窗出帧的机器上生效,多数机器到不了这)
  ipcMain.removeAllListeners('atlas:first-frame')
  ipcMain.on('atlas:first-frame', () => showOnce('first-frame'))
  // 3) 加载完主动催一帧:万一合成器还醒着,别让它干等
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.invalidate()
  })
  // 4) 看门狗(唯一无条件的兜底):3 秒硬拉露窗 —— 宁可早闪一下,不可隐身躲猫猫。
  //    隐藏的透明窗此刻多半还没内容,用户看到「窗口浮现」的实际时刻仍是首帧画好之时
  setTimeout(() => showOnce('watchdog-3s'), 3000)

  // 最大化是两副面孔:贴满屏幕时圆角描边必须收掉,四角才不漏出怪缝 —— 状态一变就喊渲染进程换装
  const syncMaximized = (maximized: boolean): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('atlas:window-maximized', maximized)
  }
  mainWindow.on('maximize', () => syncMaximized(true))
  mainWindow.on('unmaximize', () => syncMaximized(false))

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

  // 验收探针(只在设置了 ATLAS_PROBE_DIR 时启用):露窗后截整窗图 + 记账再退出,
  // 专门伺候「100%/125%/150% 三档缩放实测」当证据;正常跑应用完全不碰这段
  const probeDir = process.env['ATLAS_PROBE_DIR']
  if (probeDir) {
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500)) // 露窗后再稳两秒半,让画面完全落定
      const scale = await mainWindow.webContents.executeJavaScript('String(window.devicePixelRatio)').catch(() => 'unknown')
      const image = await mainWindow.webContents.capturePage().catch(() => null)
      const png = image ? image.toPNG() : Buffer.alloc(0)
      const report = {
        devicePixelRatio: scale,
        shownVia,
        visible: mainWindow.isVisible(),
        maximized: mainWindow.isMaximized(),
        bounds: mainWindow.getBounds(),
        pngBytes: png.length
      }
      await fs.mkdir(probeDir, { recursive: true })
      await fs.writeFile(join(probeDir, `probe-dpr${scale}.json`), JSON.stringify(report, null, 2))
      if (png.length > 0) await fs.writeFile(join(probeDir, `probe-dpr${scale}.png`), png)
      app.quit()
    })()
  }
}

function registerIpc(): void {
  // 自绘窗口壳的三颗灰点:关 / 最小化 / 最大化切换。渲染进程不许直接碰 BrowserWindow,一律走这儿
  ipcMain.handle('atlas:window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('atlas:window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('atlas:window-maximize-toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('atlas:window-is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)

  // 弹出系统"选择文件夹"对话框,返回所选路径;取消则返回 null
  ipcMain.handle('atlas:pick-folder', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const options: OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // 列盘符(第六十锤):只问 Windows「有哪些盘」,不翻任何文件内容,秒回。
  // 跳过 A/B(软驱遗物,探测可能卡好几秒);容量用 statfs 一次系统调用,拿不到就只给盘符
  ipcMain.handle('atlas:list-drives', async (): Promise<DriveInfo[]> => {
    const out: DriveInfo[] = []
    for (const ch of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${ch}:\\`
      if (!(await fs.stat(root).then(() => true, () => false))) continue
      const info: DriveInfo = { letter: ch, root }
      const usage = await fs.statfs(root).then(
        (s) => ({ free: s.bsize * s.bfree, total: s.bsize * s.blocks }),
        () => null
      )
      if (usage) {
        info.free = usage.free
        info.total = usage.total
      }
      out.push(info)
    }
    return out
  })

  // 渲染层拿不到 app 版本,给个小通道(设置里的版本信息行用)
  ipcMain.handle('atlas:app-version', () => app.getVersion())

  // 扫描指定文件夹,返回目录树 + 统计;顺手给每个节点打大白话速览标签
  ipcMain.handle('atlas:scan-folder', async (_event, folderPath: unknown) => {
    if (typeof folderPath !== 'string' || folderPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    const root = folderPath.trim()
    // 地址栏手输的路径先验明正身:不存在 / 填的是文件,都得说人话,别吐 ENOENT 生面孔
    const stat = await fs.stat(root).catch((err: NodeJS.ErrnoException) => err)
    if (stat instanceof Error) {
      if (stat.code === 'ENOENT') {
        throw new Error(`找不到这个文件夹:${root} —— 检查一下盘符、拼写和斜杠方向;不确定的话,用「选择文件夹」点一个最稳`)
      }
      throw new Error(accessDeniedMessage(stat, '文件夹', root))
    }
    if (!stat.isDirectory()) {
      // 手滑填了文件路径:顺手把上一层文件夹指给他看
      const parent = root.replace(/[\\/]+[^\\/]+$/, '') || root
      throw new Error(`这个路径是一个文件,不是文件夹 —— 要填装它的那层文件夹,比如:${parent}`)
    }
    const result = scanDirectory(root)
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
      throw new Error(`这个路径不是一个文件:${relPath}`)
    }
    if (stat.size > 1_000_000) return null // 超过 1MB 的源码不解析,避免卡顿
    const code = await fs.readFile(absPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
      throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
    })
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
      builtin: { serverPath: bi.serverPath, modelPath: bi.modelPath },
      webLookup: c.webLookup === true
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
    return explainWithCancel(requestId, (signal) =>
      explainWithModel(resolved.target, prompt, DIFF_SYSTEM_PROMPT, makeDeltaSender(event, requestId), signal)
    )
  })

  // 人话解释一个文件:自动分流 —— AST 认识的语言摆结构(证据最硬);
  // 不认识的用名字 + 内容片段让模型猜(声明不确定);二进制直接本地人话,不劳烦模型
  // 路径契约同 analyze-file:收 (rootPath, relPath),绝对路径只经 joinRoot 解析
  ipcMain.handle(
    'atlas:ai-explain-file',
    async (event, rootPath: unknown, relPath: unknown, languageId: unknown, requestId?: unknown, question?: unknown) => {
      if (typeof rootPath !== 'string' || typeof relPath !== 'string' || typeof languageId !== 'string') {
        throw new Error('参数不合法')
      }
      const resolved = await resolveChatTargetOrError()
      if ('error' in resolved) {
        return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
      }
      const absPath = joinRoot(rootPath, relPath) // relPath 想越界会在这里被拦
      // stat 失败别吞成"不存在":系统核心文件(swapfile.sys 等)会给 EINVAL/EBUSY,得说真话
      const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
      if (stat instanceof Error) {
        throw new Error(accessDeniedMessage(stat, '文件', relPath), { cause: stat })
      }
      if (!stat.isFile()) {
        throw new Error(`这个路径不是一个文件:${relPath}`)
      }
      const name = relPath.split('/').pop() ?? relPath

      // 结构流:证据最硬 —— 函数/类/导入导出都摆给模型
      if (isAnalysisSupported(languageId) && stat.size <= 1_000_000) {
        // 读内容也可能撞上独占/上锁(EBUSY/EPERM),同样走人话口径,不吐生面孔
        const code = await fs.readFile(absPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
          throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
        })
        const structure = await analyzeSource(code, languageId)
        if (structure) {
          return respondWithEvidence(
            event,
            requestId,
            question,
            buildExplainPrompt({ relPath, name, languageName: structure.languageId, structure, graph: null }),
            undefined,
            resolved
            // 结构流证据够硬(真代码结构),不掺联网查证
          )
        }
      }

      // 兜底流:猜猜官 —— 名字 + 内容片段,推测并声明不确定
      const preview =
        stat.size === 0
          ? ''
          : await readTextPreview(absPath).catch((err: NodeJS.ErrnoException) => {
              throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
            })
      if (preview === null) {
        // 二进制读不出文字:读文件头认类型当真证据,照样让模型讲,只是明说"按类型推测"
        const header = stat.size === 0 ? Buffer.alloc(0) : await readHeader(absPath)
        const kind = sniffBinaryKind(header, name)
        const typeInfo = kind
          ? kind.dims
            ? `${kind.type},尺寸 ${kind.dims}`
            : kind.type
          : '认不出具体格式(文件头不像任何已知类型)'
        return respondWithEvidence(
          event,
          requestId,
          question,
          buildBinaryPrompt({ relPath, name, typeInfo, sizeText: formatSize(stat.size) }),
          GUESS_SYSTEM_PROMPT,
          resolved,
          name
        )
      }
      const languageName = BY_EXT.get(extOf(name))?.name ?? ''
      return respondWithEvidence(
        event,
        requestId,
        question,
        buildGuessPrompt({ relPath, name, absPath, languageName, preview }),
        GUESS_SYSTEM_PROMPT,
        resolved,
        name
      )
    }
  )

  // 人话解释一个文件夹:目录清单就是证据;空文件夹直接本地人话,不劳烦模型
  // relPath 传 '' 表示解释项目根目录本身;自由聊天有专门的 atlas:ai-chat 通道
  ipcMain.handle(
    'atlas:ai-explain-folder',
    async (event, rootPath: unknown, relPath: unknown, requestId?: unknown, question?: unknown) => {
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
    // 通用后缀分布:什么文件都数(.exe/.dll/.log 是认出系统文件夹的关键证据,编程语言认不出的也算)
    const extCounts = new Map<string, number>()
    for (const item of dirents) {
      if (item.isDirectory()) {
        subdirs.push(item.name)
        continue
      }
      if (!item.isFile()) continue // 符号链接等不靠谱的,跳过
      files.push(item.name)
      const langName = BY_EXT.get(extOf(item.name))?.name ?? '没认出的文件'
      languages.set(langName, (languages.get(langName) ?? 0) + 1)
      const dot = item.name.lastIndexOf('.')
      const ext = dot > 0 ? item.name.slice(dot).toLowerCase() : '(无后缀)'
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
    }
    const folderName = basename(absPath) || basename(rootPath)
    return respondWithEvidence(
      event,
      requestId,
      question,
      buildFolderPrompt({
        relPath,
        name: folderName,
        absPath,
        subdirs,
        files,
        languages: Object.fromEntries(languages),
        extCounts: Object.fromEntries(extCounts)
      }),
      FOLDER_SYSTEM_PROMPT,
      resolved,
      folderName
    )
  })

  // 自由对话:独立通道、独立人设(Atlas 小探针)。当前选中对象的资料以「附件」身份
  // 垫在最前面,仅供参考,不进历史 —— 换对象不带旧资料,旧对话也不污染新对象。
  // 用户点名要联网(联网/搜搜/查查…)且开关开着,程序先按名字真查一份资料再开答;
  // 查询的每一步状态(查着了/没查到/没开开关)都以程序账本为准回传,模型说了不算。
  ipcMain.handle('atlas:ai-chat', async (event, req: unknown): Promise<AiChatResult> => {
    const startedAt = Date.now()
    const notRequested: WebLookupMeta = { requested: false, enabled: false, attempted: false, state: 'not_requested', sources: [] }
    const body = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) {
      return { status: 'error', text: '先输入一句话再发送', model: '', durationMs: 0, webLookup: notRequested }
    }
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    const history = sanitizeHistory(body.history)
    const attachment = sanitizeAttachment(body.context)
    const requested = hasSearchIntent(question)

    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      // 模型服务都没通,查询自然也没发生:如实记成 failed,不让账本装无事发生
      const meta: WebLookupMeta = requested
        ? { requested: true, enabled: false, attempted: false, state: 'failed', sources: [] }
        : notRequested
      return { status: 'error', text: resolved.error, model: '', durationMs: Date.now() - startedAt, webLookup: meta }
    }

    // 联网查询先行:状态边查边播报(searching → completed/failed/empty),不等模型开金口
    const enabled = resolved.webLookup
    let outcome: { kind: 'skipped' } | { kind: 'attempted'; material: string; sources: string[] } | { kind: 'error' } = { kind: 'skipped' }
    let webMaterial: { query: string; material: string } | null = null
    if (requested && enabled) {
      const query = pickWebLookupQuery(question, attachment)
      sendChatLookup(event, requestId, 'searching', [])
      try {
        const found = await webLookupDetailed(query, electronFetchText)
        outcome = { kind: 'attempted', material: found.material, sources: found.sources }
        if (found.material) webMaterial = { query, material: found.material }
      } catch {
        outcome = { kind: 'error' }
      }
      const finalState = outcome.kind === 'attempted' ? (outcome.material === '' ? 'empty' : 'completed') : 'failed'
      sendChatLookup(event, requestId, finalState, outcome.kind === 'attempted' ? outcome.sources : [])
    }

    const meta = resolveWebLookupMeta(requested, enabled, outcome)
    const messages = buildFreeChatMessages(FREE_CHAT_SYSTEM_PROMPT, attachment, history, question, webMaterial)
    const aborter = new AbortController()
    if (requestId !== '') explainAborters.set(requestId, aborter)
    try {
      const res = await explainWithMessages(resolved.target, messages, makeDeltaSender(event, requestId), aborter.signal)
      // 用户主动掐掉(经 atlas:ai-cancel):如实记 cancelled,不算模型出错
      const status = aborter.signal.aborted ? 'cancelled' : res.status
      return { ...res, status, webLookup: meta }
    } finally {
      if (requestId !== '') explainAborters.delete(requestId)
    }
  })

  // 掐掉还在生成的讲解:渲染进程换了讲解目标/关掉卡片时喊一声,模型立刻空出来讲下一个
  ipcMain.handle('atlas:ai-cancel', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || requestId === '') return
    explainAborters.get(requestId)?.abort()
    explainAborters.delete(requestId)
  })

  // 联网查证(可选举手):讲解认不出软件/品牌时,拿「名字」去维基百科/DuckDuckGo 查免费公开资料。
  // 只许传名字,不许传本地路径 —— 隐私边界写在调用方;5 秒超时,查不到返回空串,上层自己回退
  ipcMain.handle('atlas:web-lookup', (_event, query: unknown) => {
    if (typeof query !== 'string' || query.trim() === '') return ''
    return webLookup(query, electronFetchText)
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
