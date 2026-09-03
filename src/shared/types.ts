// 主进程与渲染进程共用的数据契约,两边都从这里导入,防止口径不一

export interface ScanFileNode {
  type: 'file'
  name: string
  /** 小写扩展名(含点),如 '.ts';无扩展名则为空字符串 */
  ext: string
  /** 语言识别结果;认不出语言时不填 */
  language?: LanguageTag
}

/** 一个文件的语言标签 */
export interface LanguageTag {
  id: string
  name: string
  /** extension = 靠后缀认的;content = 后缀认不出、靠内容嗅探认的 */
  source: 'extension' | 'content'
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
  /** 按语言统计:id → 语言名 + 文件数;认不出语言的文件不计入 */
  byLanguage: Record<string, { name: string; count: number }>
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
