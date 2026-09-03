import { contextBridge, ipcRenderer } from 'electron'
import type { ScanResult } from '../shared/types.ts'

// 挂在 window.atlas 命名空间下:版本信息、选文件夹、扫描,都从这儿走
contextBridge.exposeInMainWorld('atlas', {
  versions: {
    node: (): string => process.versions.node,
    chrome: (): string => process.versions.chrome,
    electron: (): string => process.versions.electron
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('atlas:pick-folder'),
  scanFolder: (folderPath: string): Promise<ScanResult> => ipcRenderer.invoke('atlas:scan-folder', folderPath)
})
