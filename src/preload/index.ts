import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiChatLookupPayload,
  AiChatRequest,
  AiChatResult,
  AiConfig,
  AiDeltaPayload,
  AiExplainResult,
  DepGraphResult,
  DriveInfo,
  FileStructure,
  GitChangesResult,
  ScanResult
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
  depGraph: (rootPath: string): Promise<DepGraphResult> => ipcRenderer.invoke('atlas:dep-graph', rootPath),
  aiConfigGet: (): Promise<AiConfig> => ipcRenderer.invoke('atlas:ai-config-get'),
  aiConfigSave: (config: AiConfig): Promise<AiConfig> => ipcRenderer.invoke('atlas:ai-config-save', config),
  aiListModels: (baseUrl: string): Promise<string[]> => ipcRenderer.invoke('atlas:ai-list-models', baseUrl),
  aiPickFile: (): Promise<string | null> => ipcRenderer.invoke('atlas:ai-pick-file'),
  aiExplainFile: (rootPath: string, relPath: string, languageId: string, requestId?: string, question?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:ai-explain-file', rootPath, relPath, languageId, requestId, question),
  aiExplainFolder: (rootPath: string, relPath: string, requestId?: string, question?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:ai-explain-folder', rootPath, relPath, requestId, question),
  /** 自由对话:独立通道,资料当附件、联网状态程序记账,与文件解释互不掺和 */
  aiChat: (req: AiChatRequest): Promise<AiChatResult> => ipcRenderer.invoke('atlas:ai-chat', req),
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
  /** 掐掉还在生成的讲解:换了讲解目标/关掉卡片时喊一声,模型立刻空出来 */
  aiCancel: (requestId: string): Promise<void> => ipcRenderer.invoke('atlas:ai-cancel', requestId),
  /** 联网查证(默认关):只把「名字」交给主进程去查公开资料,渲染进程不碰网络 */
  webLookup: (query: string): Promise<string> => ipcRenderer.invoke('atlas:web-lookup', query),
  /** 订阅 AI 流式增量;返回退订函数,组件卸载时调用,防止泄漏监听 */
  onAiDelta: (callback: (payload: AiDeltaPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AiDeltaPayload): void => callback(payload)
    ipcRenderer.on('atlas:ai-delta', listener)
    return () => ipcRenderer.removeListener('atlas:ai-delta', listener)
  }
})
