// 主进程与渲染进程共用的数据契约,两边都从这里导入,防止口径不一

export interface ScanFileNode {
  type: 'file'
  name: string
  /** 小写扩展名(含点),如 '.ts';无扩展名则为空字符串 */
  ext: string
}

export interface ScanDirNode {
  type: 'directory'
  name: string
  children: ScanTreeNode[]
  /** true 表示该目录读不了(无权限)或被深度上限截断,内容不完整 */
  truncated?: boolean
}

export type ScanTreeNode = ScanFileNode | ScanDirNode

export interface ScanStats {
  fileCount: number
  dirCount: number
  /** 按扩展名(小写,含点)统计的文件数;无扩展名归到 '' */
  byExt: Record<string, number>
  /** 因在忽略名单(node_modules、.git 等)而被跳过的条目数 */
  ignoredCount: number
  /** 因无权限、符号链接等原因跳过的条目数 */
  skippedCount: number
}

export interface ScanResult {
  rootPath: string
  rootName: string
  tree: ScanDirNode
  stats: ScanStats
  durationMs: number
}
