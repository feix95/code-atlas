import { contextBridge } from 'electron'

// 挂在 window.atlas 命名空间下,以后目录扫描等能力都往这里加
contextBridge.exposeInMainWorld('atlas', {
  versions: {
    node: (): string => process.versions.node,
    chrome: (): string => process.versions.chrome,
    electron: (): string => process.versions.electron
  }
})
