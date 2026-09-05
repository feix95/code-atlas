import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type {
  AiConfig,
  AiDeltaPayload,
  AiExplainResult,
  AiHistoryMessage,
  DepGraphResult,
  FileStructure,
  GitChangesResult,
  ScanResult
} from '../shared/types.ts'

// 界面缩放(跟 VS Code 的界面缩放一个思路):用 Chromium 原生缩放,文字排版整体等比变,
// 多种显示器分辨率各自调舒服。存 localStorage,页面脚本跑之前就定好,不会先小后大闪一下
const UI_SCALE_KEY = 'atlas.ui-scale'
const SCALE_MIN = 0.8
const SCALE_MAX = 1.4

function readUiScale(): number {
  const v = Number(localStorage.getItem(UI_SCALE_KEY))
  return Number.isFinite(v) && v >= SCALE_MIN && v <= SCALE_MAX ? v : 1
}
webFrame.setZoomFactor(readUiScale())

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
    webFrame.setZoomFactor(f)
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('atlas:pick-folder'),
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
  aiExplainFile: (
    rootPath: string,
    relPath: string,
    languageId: string,
    requestId?: string,
    question?: string,
    history?: AiHistoryMessage[]
  ): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:ai-explain-file', rootPath, relPath, languageId, requestId, question, history),
  aiExplainFolder: (
    rootPath: string,
    relPath: string,
    requestId?: string,
    question?: string,
    history?: AiHistoryMessage[]
  ): Promise<AiExplainResult> => ipcRenderer.invoke('atlas:ai-explain-folder', rootPath, relPath, requestId, question, history),
  gitChanges: (rootPath: string): Promise<GitChangesResult> => ipcRenderer.invoke('atlas:git-changes', rootPath),
  gitExplainChange: (rootPath: string, relPath: string, requestId?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:git-explain-change', rootPath, relPath, requestId),
  /** 掐掉还在生成的讲解:换了讲解目标/关掉卡片时喊一声,模型立刻空出来 */
  aiCancel: (requestId: string): Promise<void> => ipcRenderer.invoke('atlas:ai-cancel', requestId),
  /** 订阅 AI 流式增量;返回退订函数,组件卸载时调用,防止泄漏监听 */
  onAiDelta: (callback: (payload: AiDeltaPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AiDeltaPayload): void => callback(payload)
    ipcRenderer.on('atlas:ai-delta', listener)
    return () => ipcRenderer.removeListener('atlas:ai-delta', listener)
  }
})
