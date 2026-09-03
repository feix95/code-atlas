// 主进程与渲染进程共用的数据契约,两边都从这里导入,防止口径不一

export interface ScanFileNode {
  type: 'file'
  name: string
  /**
   * 相对扫描根的路径,如 'src/main/index.ts'。分隔符统一为 '/',
   * 不含根目录名 —— 这是全项目的文件标识契约,要读文件必须经
   * shared/paths 的 joinRoot(rootPath, relPath) 解析,不许手拼
   */
  relPath: string
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

/** AST 分析提取出的文件结构(只结构化,不解释) */
export interface FileStructure {
  languageId: string
  /** 导入的模块/包名 */
  imports: string[]
  /** 导出的名字(默认导出记为 default) */
  exports: string[]
  functions: string[]
  classes: string[]
  /** TS 的 interface 与 type 别名 */
  interfaces: string[]
  /** React 组件(文件含 JSX 且函数/类名大写开头) */
  reactComponents: string[]
}

export interface ScanDirNode {
  type: 'directory'
  name: string
  /** 相对扫描根的路径,分隔符统一为 '/';根节点为 ''(根名不进路径,防止与 rootPath 重复拼接) */
  relPath: string
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

/** 项目关系图的一条引用边:from 文件引用了 to 文件(两边都是 relPath,路径契约) */
export interface DepEdge {
  from: string
  to: string
}

/** 解析不出来的导入:老实记账,不假装连上了 */
export interface UnresolvedImport {
  from: string
  spec: string
}

/** 关系图里的一个文件节点 */
export interface DepGraphNode {
  relPath: string
  languageId: string
  /** 被几个文件引用(入度 = 影响范围:改它要小心) */
  inCount: number
  /** 引用了几个项目内文件(出度) */
  outCount: number
}

/** 项目关系分析结果:谁引用谁,全部用 relPath 说话 */
export interface DepGraphResult {
  rootPath: string
  nodes: DepGraphNode[]
  edges: DepEdge[]
  /** 被引用最多的文件排行(已按入度降序,前端直接展示) */
  hubs: DepGraphNode[]
  stats: {
    /** 实际做了 AST 分析的文件数 */
    analyzed: number
    /** 引用外部包(react、node:path 这类)的次数 */
    externalCount: number
    /** 读不了或超过大小上限而跳过的文件数 */
    skipped: number
    unresolved: UnresolvedImport[]
  }
  durationMs: number
}
