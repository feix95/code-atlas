import { contextBridge, ipcRenderer } from 'electron'
import type { AiConfig, AiExplainResult, DepGraphResult, FileStructure, GitChangesResult, ScanResult } from '../shared/types.ts'

// 挂在 window.atlas 命名空间下:版本信息、选文件夹、扫描、AST 分析,都从这儿走
contextBridge.exposeInMainWorld('atlas', {
  versions: {
    node: (): string => process.versions.node,
    chrome: (): string => process.versions.chrome,
    electron: (): string => process.versions.electron
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('atlas:pick-folder'),
  scanFolder: (folderPath: string): Promise<ScanResult> => ipcRenderer.invoke('atlas:scan-folder', folderPath),
  analyzeFile: (rootPath: string, relPath: string, languageId: string): Promise<FileStructure | null> =>
    ipcRenderer.invoke('atlas:analyze-file', rootPath, relPath, languageId),
  depGraph: (rootPath: string): Promise<DepGraphResult> => ipcRenderer.invoke('atlas:dep-graph', rootPath),
  aiConfigGet: (): Promise<AiConfig> => ipcRenderer.invoke('atlas:ai-config-get'),
  aiConfigSave: (config: AiConfig): Promise<AiConfig> => ipcRenderer.invoke('atlas:ai-config-save', config),
  aiListModels: (baseUrl: string): Promise<string[]> => ipcRenderer.invoke('atlas:ai-list-models', baseUrl),
  aiExplainFile: (rootPath: string, relPath: string, languageId: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:ai-explain-file', rootPath, relPath, languageId),
  aiExplainFolder: (rootPath: string, relPath: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:ai-explain-folder', rootPath, relPath),
  gitChanges: (rootPath: string): Promise<GitChangesResult> => ipcRenderer.invoke('atlas:git-changes', rootPath),
  gitExplainChange: (rootPath: string, relPath: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke('atlas:git-explain-change', rootPath, relPath)
})
