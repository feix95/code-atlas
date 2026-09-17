import { contextBridge, ipcRenderer } from 'electron'
import type { Appearance } from '../shared/appearancePrefs.ts'
import type { TavilyProbeResult } from '../shared/tavily.ts'
import type { ModelDownloadProgress, RepoFile, ShelfResult } from '../shared/modelShelf.ts'
import type {
  AiChatLookupPayload,
  AiChatRequest,
  AiChatResult,
  AiCompactRequest,
  AiConfig,
  AiDeltaPayload,
  AiExplainResult,
  DepGraphResult,
  DriveInfo,
  FeatureLocateResult,
  FileStructure,
  FilePreviewResult,
  GitChangesResult,
  ModelContextInfo,
  ModelFitVerdict,
  ModelStatus,
  ScanDirNode,
  ScanResult,
  DevLogEntry
} from '../shared/types.ts'

// 界面缩放(第四十七锤起换引擎):不再用 webFrame.setZoomFactor —— 那是 Chromium 整页缩放,
// 会把整个渲染坐标系缩一顿,无边框自绘窗的「鼠标判定」和「视觉框」就对不上:
// 设置面板 × 视觉上正对着却点不中、拖边热区跑出窗框、设置页比窗还大,三个连环 bug 同这个根。
// 现在改成改根字号:html 的 font-size = 16px × 系数,布局/字号/图标全挂 rem 跟着变,
// 没有第二套坐标系,鼠标坐标和视觉永远 1:1。存 localStorage,页面脚本跑之前就定好,不会先小后大闪一下。
// 超出范围的旧存档贴边处理(不再静默跳回 100%,用户调过 180% 就给他 180%)
const UI_SCALE_KEY = 'atlas.ui-scale'
const ROOT_FONT_BASE_PX = 16
export const SCALE_MIN = 0.8
export const SCALE_MAX = 1.8

function applyRootFont(factor: number): void {
  const set = (): void => {
    document.documentElement.style.fontSize = `${(ROOT_FONT_BASE_PX * factor).toFixed(2)}px`
  }
  // preload 跑在页面脚本之前,documentElement 一般已经在;万一没好就等 DOM 一就绪立刻补上
  if (document.documentElement) set()
  else document.addEventListener('DOMContentLoaded', set, { once: true })
}

function readUiScale(): number {
  const v = Number(localStorage.getItem(UI_SCALE_KEY))
  if (!Number.isFinite(v) || v <= 0) return 1
  return Math.min(Math.max(v, SCALE_MIN), SCALE_MAX)
}
applyRootFont(readUiScale())

// 首帧信号:连跑两个动画帧 = 合成器真的画出了画面,主进程收到才敢露窗。
// 这是露窗链的主保险 —— 无边框模式下 ready-to-show 在部分高缩放屏上永不触发
// (第三十六锤补实测),不能指望它;主进程另备 3 秒看门狗兜底,窗口绝不永久隐身
requestAnimationFrame(() => {
  requestAnimationFrame(() => ipcRenderer.send('atlas:first-frame'))
})

// 挂在 window.atlas 命名空间下:版本信息、选文件夹、扫描、AST 分析,都从这儿走
contextBridge.exposeInMainWorld('atlas', {
  versions: {
    node: (): string => process.versions.node,
    chrome: (): string => process.versions.chrome,
    electron: (): string => process.versions.electron
  },
  getUiScale: (): number => readUiScale(),
  setUiScale: (factor: number): void => {
    const f = Math.min(Math.max(Number(factor) || 1, SCALE_MIN), SCALE_MAX)
    localStorage.setItem(UI_SCALE_KEY, String(f))
    applyRootFont(f)
    // 喊一声界面:侧栏宽度这类「按比例跟缩放」的布局要实时跟着重算
    window.dispatchEvent(new CustomEvent('atlas:ui-scale', { detail: f }))
  },
  // 设置弹窗的暂存预览:根字号跟着草稿走,但不写 localStorage —— 点「应用更改」才真正 setUiScale 落盘
  previewUiScale: (factor: number): void => {
    const f = Math.min(Math.max(Number(factor) || 1, SCALE_MIN), SCALE_MAX)
    applyRootFont(f)
    window.dispatchEvent(new CustomEvent('atlas:ui-scale', { detail: f }))
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('atlas:pick-folder'),
  // 外观偏好(2026-09-16 起存主进程 appearance.json,不再用 localStorage):
  // getSync 是同步通道(sendSync 配 ipcMain.on),页面脚本跑之前把外观定下来,首帧不闪默认皮;
  // save 走 invoke(配 ipcMain.handle)异步落盘。
  // 2026-09-17 修:原来这里是 send 而主进程那边是 handle —— 一边发件一边只收 invoke,
  // 消息被静默丢弃,appearance.json 一次都没写成过,外观重启就回出厂。收发必须成对:
  // send/sendSync 配 ipcMain.on,invoke 配 ipcMain.handle。
  appearance: {
    getSync: (): Appearance | null => ipcRenderer.sendSync('atlas:appearance-get-sync'),
    save: (a: Appearance): Promise<void> => ipcRenderer.invoke('atlas:appearance-save', a)
  },
  // 列盘符(只问有哪些盘,不翻文件内容);app 版本号(设置里的版本信息行用)
  listDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke('atlas:list-drives'),
  appVersion: (): Promise<string> => ipcRenderer.invoke('atlas:app-version'),
  // 自绘窗口壳:三颗灰点背后的真动作 + 最大化状态同步,渲染进程不许直接碰 BrowserWindow
  windowClose: (): Promise<void> => ipcRenderer.invoke('atlas:window-close'),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('atlas:window-minimize'),
  windowMaximizeToggle: (): Promise<boolean> => ipcRenderer.invoke('atlas:window-maximize-toggle'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('atlas:window-is-maximized'),
  /** 订阅最大化/还原状态变化;返回退订函数,组件卸载时调用 */
  onWindowMaximized: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => callback(maximized)
    ipcRenderer.on('atlas:window-maximized', listener)
    return () => ipcRenderer.removeListener('atlas:window-maximized', listener)
  },
  scanFolder: (folderPath: string): Promise<ScanResult> => ipcRenderer.invoke('atlas:scan-folder', folderPath),
  scanSubdir: (rootPath: string, relPath: string): Promise<ScanResult> =>
    ipcRenderer.invoke('atlas:scan-subdir', rootPath, relPath),
  analyzeFile: (rootPath: string, relPath: string, languageId: string): Promise<FileStructure | null> =>
    ipcRenderer.invoke('atlas:analyze-file', rootPath, relPath, languageId),
  /** 代码预览:读一个文件的前一段当文本看(二进制/超大/读不了都有专门的话,不硬塞乱码) */
  readPreview: (rootPath: string, relPath: string): Promise<FilePreviewResult> =>
    ipcRenderer.invoke('atlas:read-preview', rootPath, relPath),
  depGraph: (rootPath: string): Promise<DepGraphResult> => ipcRenderer.invoke('atlas:dep-graph', rootPath),
  // 模型货架:实时榜(双源拉取+本机家底)+ 仓库文件清单
  modelShelf: (): Promise<ShelfResult> => ipcRenderer.invoke('atlas:model-shelf'),
  modelFiles: (repoId: string): Promise<RepoFile[]> => ipcRenderer.invoke('atlas:model-files', repoId),
  // 一键到位:点文件 → 断点续传下载 → 自动填 AI 配置;进度走事件推送
  modelDownloadStart: (repoId: string, filePath: string): Promise<string> =>
    ipcRenderer.invoke('atlas:model-download-start', { repoId, filePath }),
  modelDownloadCancel: (): Promise<boolean> => ipcRenderer.invoke('atlas:model-download-cancel'),
  onModelDownloadProgress: (callback: (p: ModelDownloadProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, p: ModelDownloadProgress): void => callback(p)
    ipcRenderer.on('atlas:model-download-progress', listener)
    return () => ipcRenderer.removeListener('atlas:model-download-progress', listener)
  },
  aiConfigGet: (): Promise<AiConfig> => ipcRenderer.invoke('atlas:ai-config-get'),
  aiConfigSave: (config: AiConfig): Promise<AiConfig> => ipcRenderer.invoke('atlas:ai-config-save', config),
  aiListModels: (baseUrl: string): Promise<string[]> => ipcRenderer.invoke('atlas:ai-list-models', baseUrl),
  /** Tavily Key 体检(2026-09-17):拿框里这把 Key 真打一次官方接口,只回结论,不回显 Key */
  aiTestTavily: (key: string): Promise<TavilyProbeResult> => ipcRenderer.invoke('atlas:ai-test-tavily', key),
  aiPickFile: (): Promise<string | null> => ipcRenderer.invoke('atlas:ai-pick-file'),
  aiExplainFile: (rootPath: string, relPath: string, languageId: string, requestId?: string, question?: string, note?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:ai-explain-file', rootPath, relPath, languageId, requestId, question, note),
  aiExplainFolder: (rootPath: string, relPath: string, requestId?: string, question?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:ai-explain-folder', rootPath, relPath, requestId, question),
  /** 自由对话:独立通道,资料当附件、联网状态程序记账,与文件解释互不掺和 */
  aiChat: (req: AiChatRequest): Promise<AiChatResult> => ipcRenderer.invoke('atlas:ai-chat', req),
  /** /compact 手动压缩(第一百四十二锤):把目前为止的对话提炼成摘要,流式增量走 atlas:ai-delta */
  aiCompact: (req: AiCompactRequest): Promise<AiExplainResult> => ipcRenderer.invoke('atlas:ai-compact', req),
  /** 试一句(第一百一十三锤):拿「还没保存的草稿」念一段,当场听说话方式的效果 */
  aiStyleSample: (personalization: unknown, requestId?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:ai-style-sample', personalization, requestId),
  /** 订阅自由对话的联网状态播报(查询中/查到/没查到);返回退订函数 */
  onChatLookup: (callback: (payload: AiChatLookupPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AiChatLookupPayload): void => callback(payload)
    ipcRenderer.on('atlas:ai-chat-lookup', listener)
    return () => ipcRenderer.removeListener('atlas:ai-chat-lookup', listener)
  },
  gitChanges: (rootPath: string): Promise<GitChangesResult> => ipcRenderer.invoke('atlas:git-changes', rootPath),
  gitExplainChange: (rootPath: string, relPath: string, requestId?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:git-explain-change', rootPath, relPath, requestId),
  /** AI 干活报告:整轮改动翻成大白话审计,流式增量走 atlas:ai-delta,按 requestId 对号 */
  gitReport: (rootPath: string, requestId?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:git-report', rootPath, requestId),
  /** 功能定位:「这个功能在哪」—— 扫描树递给主进程当地图,带路人指路,防编造校验在主进程 */
  locateFeature: (tree: ScanDirNode, question: string, requestId?: string): Promise<FeatureLocateResult> =>
    ipcRenderer.invoke('atlas:locate-feature', tree, question, requestId),
  /** 掐掉还在生成的讲解:换了讲解目标/关掉卡片时喊一声,模型立刻空出来 */
  aiCancel: (requestId: string): Promise<void> => ipcRenderer.invoke('atlas:ai-cancel', requestId),
  /** 联网查证(默认关):只把「名字」交给主进程去查公开资料,渲染进程不碰网络 */
  webLookup: (query: string): Promise<string> => ipcRenderer.invoke('atlas:web-lookup', query),
  /** 订阅 AI 流式增量;返回退订函数,组件卸载时调用,防止泄漏监听 */
  onAiDelta: (callback: (payload: AiDeltaPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AiDeltaPayload): void => callback(payload)
    ipcRenderer.on('atlas:ai-delta', listener)
    return () => ipcRenderer.removeListener('atlas:ai-delta', listener)
  },
  // ── 模型状态栏(第七十锤):查一次现状 + 订阅后续变化 + 取消热身/卸下模型 ──
  modelStatusGet: (): Promise<ModelStatus> => ipcRenderer.invoke('atlas:model-status-get'),
  modelEject: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('atlas:model-eject'),
  /** 右键文件链接复制完整路径:主进程 joinRoot 拼绝对路径写进剪贴板,只复制不打开 */
  copyFilePath: (rootPath: string, relPath: string): Promise<{ ok: boolean; path?: string; message?: string }> =>
    ipcRenderer.invoke('atlas:copy-file-path', rootPath, relPath),
  /** 右键文件链接「在文件资源管理器中显示」:资源管理器弹出并选中文件,不开文件 */
  revealFilePath: (rootPath: string, relPath: string): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke('atlas:reveal-file-path', rootPath, relPath),
  /** 订阅模型状态变化(热身进度/就绪/出岔子);返回退订函数,组件卸载时调用 */
  onModelStatus: (callback: (status: ModelStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ModelStatus): void => callback(status)
    ipcRenderer.on('atlas:model-status', listener)
    return () => ipcRenderer.removeListener('atlas:model-status', listener)
  },
  /** 量尺(第七十三锤):模型块头 vs 机器尺寸,选模型那一刻就给结论 */
  modelFitCheck: (modelPath: string): Promise<ModelFitVerdict> => ipcRenderer.invoke('atlas:model-fit-check', modelPath),
  /** 模型档案(上下文档位的账本):出厂上限 + 层数头数 + 机器家底,一次端齐;翻不到回 null */
  modelContextInfo: (modelPath: string): Promise<ModelContextInfo | null> =>
    ipcRenderer.invoke('atlas:model-context-info', modelPath),
  /** 救生圈的复活信号:画面断了被主进程重接回来时喊一声,页面弹人话横幅;返回退订函数 */
  onRendererRevived: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('atlas:renderer-revived', listener)
    return () => ipcRenderer.removeListener('atlas:renderer-revived', listener)
  },
  /** 报错小纸条:渲染层抓到的 JS 错误送进后台账本(主进程的账本不随渲染层陪葬) */
  reportRendererError: (text: string): void => {
    ipcRenderer.send('atlas:renderer-error', text)
  },
  /** 画面心跳(救生圈2.0):rAF 每秒报一跳「画面循环还在转」;窗露着心跳却停了,主进程自动重挂救命 */
  frameHeartbeat: (): void => {
    ipcRenderer.send('atlas:frame-heartbeat')
  },
  // ── 桌宠(桌宠托管第二锤):穿透开关 + 拖动三连 + 点击唤主面板,全是单向 send(配主进程 ipcMain.on) ──
  /** 光标在不在这只小家伙身上:在 → 主进程收穿透(可点可拖),不在 → 放行穿透(点的是桌面) */
  mascotMouse: (inside: boolean): void => {
    ipcRenderer.send('atlas:mascot-mouse', inside)
  },
  mascotDragStart: (): void => {
    ipcRenderer.send('atlas:mascot-drag-start')
  },
  mascotDragMove: (): void => {
    ipcRenderer.send('atlas:mascot-drag-move')
  },
  mascotDragEnd: (): void => {
    ipcRenderer.send('atlas:mascot-drag-end')
  },
  mascotActivate: (): void => {
    ipcRenderer.send('atlas:mascot-activate')
  },
  // ── Developer 日志(第八十七锤):拉旧账 / 清账 / 开窗 / 订阅新账 ──
  devLogsPull: (): Promise<DevLogEntry[]> => ipcRenderer.invoke('atlas:dev-log-pull'),
  devLogsClear: (): Promise<void> => ipcRenderer.invoke('atlas:dev-log-clear'),
  devLogsOpen: (): Promise<void> => ipcRenderer.invoke('atlas:dev-log-open'),
  /** 订阅新日志条目;返回退订函数,组件卸载时调用 */
  onDevLog: (callback: (entry: DevLogEntry) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: DevLogEntry): void => callback(entry)
    ipcRenderer.on('atlas:dev-log', listener)
    return () => ipcRenderer.removeListener('atlas:dev-log', listener)
  }
})
