import { app, dialog, ipcMain, shell, BrowserWindow, type OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { scanDirectory } from '../scanner/index.ts'
import { analyzeSource, isAnalysisSupported } from '../analyzer/index.ts'
import { buildDependencyGraph } from '../depgraph/index.ts'
import { explainWithModel, isExplainable, buildExplainPrompt } from '../ai/index.ts'
import { loadAiConfig, saveAiConfig } from '../ai/config.ts'
import { joinRoot } from '../shared/paths.ts'
import type { AiConfig, FileStructure } from '../shared/types.ts'

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

  // 扫描指定文件夹,返回目录树 + 统计
  ipcMain.handle('atlas:scan-folder', (_event, folderPath: unknown) => {
    if (typeof folderPath !== 'string' || folderPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return scanDirectory(folderPath)
  })

  // AST 分析单个文件;不支持的语言/超大文件返回 null(诚实的能力边界,不是出错)
  // 路径契约:收 (rootPath, relPath),绝对路径只能由 joinRoot 在这儿解析
  ipcMain.handle('atlas:analyze-file', async (_event, rootPath: unknown, relPath: unknown, languageId: unknown) => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string' || typeof languageId !== 'string') {
      throw new Error('参数不合法')
    }
    if (!isAnalysisSupported(languageId)) return null
    const absPath = joinRoot(rootPath, relPath) // relPath 想越界(.. 上跳、盘符注入)会在这里被拦
    const stat = await fs.stat(absPath).catch(() => null)
    if (!stat || !stat.isFile()) {
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

  // AI 配置:读 / 存
  ipcMain.handle('atlas:ai-config-get', () => loadAiConfig(app.getPath('userData')))
  ipcMain.handle('atlas:ai-config-save', (_event, config: unknown) => {
    if (typeof config !== 'object' || config === null) throw new Error('配置不合法')
    const c = config as Partial<AiConfig>
    if (typeof c.baseUrl !== 'string' || typeof c.model !== 'string') {
      throw new Error('配置不合法:缺 baseUrl 或 model')
    }
    return saveAiConfig(app.getPath('userData'), { baseUrl: c.baseUrl, model: c.model, apiKey: c.apiKey ?? '' })
  })

  // 连接测试 + 列出本地模型:叫 LM Studio 报告它加载了哪些模型
  ipcMain.handle('atlas:ai-list-models', async (_event, baseUrl: unknown) => {
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') throw new Error('地址不能为空')
    const url = `${baseUrl.replace(/\/+$/, '')}/models`
    const res = await fetch(url).catch(() => null)
    if (!res || !res.ok) {
      throw new Error(`连不上模型服务,检查 LM Studio 是否已启动(${baseUrl})`)
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return (data.data ?? []).map((m) => m.id)
  })

  // 人话解释:读文件(joinRoot) → AST → 拼提示词 → 调本地模型。路径契约同 analyze-file
  ipcMain.handle(
    'atlas:ai-explain-file',
    async (_event, rootPath: unknown, relPath: unknown, languageId: unknown) => {
      if (typeof rootPath !== 'string' || typeof relPath !== 'string' || typeof languageId !== 'string') {
        throw new Error('参数不合法')
      }
      if (!isExplainable(languageId)) {
        return { status: 'unsupported', text: '这个语言暂不支持人话解释', model: '', durationMs: 0 }
      }
      const absPath = joinRoot(rootPath, relPath) // relPath 想越界会在这里被拦
      const code = await fs.readFile(absPath, 'utf8')
      const structure = (await analyzeSource(code, languageId)) as FileStructure | null
      if (!structure) {
        return { status: 'error', text: '解析不出这个文件的结构', model: '', durationMs: 0 }
      }
      const config = await loadAiConfig(app.getPath('userData'))
      if (!config.model) {
        return { status: 'error', text: '还没配置模型,先去「AI 设置」里连一下 LM Studio', model: '', durationMs: 0 }
      }
      const name = relPath.split('/').pop() ?? relPath
      const prompt = buildExplainPrompt({ relPath, name, languageName: structure.languageId, structure, graph: null })
      return explainWithModel(config, prompt)
    }
  )
}

app.whenReady().then(() => {
  createWindow()
  registerIpc()

  // macOS:点 Dock 图标时,没有窗口就重新建一个
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Windows / Linux:关掉所有窗口就退出应用
  if (process.platform !== 'darwin') app.quit()
})
