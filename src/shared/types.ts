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

/** git 改动清单里的一个文件 */
export interface GitChange {
  relPath: string
  /** 重命名前的旧路径(仅 kind = renamed 时有) */
  oldPath?: string
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
  /** 这次改动是否已进暂存区(untracked 恒为 false) */
  staged: boolean
  /** 新增行数;二进制文件为 -1 */
  additions: number
  /** 删除行数;二进制文件为 -1 */
  deletions: number
  /** 二进制文件:git 没法逐行对比 */
  binary: boolean
}

/** 项目当前的 git 改动总览:谁动了、动了多少行 */
export interface GitChangesResult {
  rootPath: string
  /** false = 这个文件夹不在 git 仓库里,changes 为空,靠界面提示 */
  isGitRepo: boolean
  /** 当前分支名;仓库还没有任何提交时为"(还没有提交)" */
  branch: string
  changes: GitChange[]
  stats: {
    /** 有改动的文件数 */
    changed: number
    /** 全部新增行合计(二进制不计) */
    additions: number
    /** 全部删除行合计(二进制不计) */
    deletions: number
  }
  durationMs: number
}

/**
 * AI 服务的两种来源:LM Studio(外部)与内置模型(llama-server 子进程)。
 * 对上层业务它们是同一种服务 —— 都收敛成 ChatTarget(baseURL + 模型名)。
 */
export type AiProviderKind = 'lmstudio' | 'builtin'

/** LM Studio 这类外部 OpenAI 兼容服务的设置 */
export interface AiLmstudioSettings {
  /** 服务根地址,常以 /v1 结尾,如 http://127.0.0.1:1234/v1 */
  baseUrl: string
  /** 服务里已加载的模型名 */
  model: string
  /** 鉴权 key;本地 LM Studio 通常留空 */
  apiKey: string
}

/** 内置模型的设置:MVP 阶段手动指定 llama-server 程序与 GGUF 模型文件 */
export interface AiBuiltinSettings {
  /** llama-server 可执行文件的绝对路径 */
  serverPath: string
  /** GGUF 模型文件的绝对路径 */
  modelPath: string
}

/** AI 配置(存 userData,含两个 Provider 的全部设置 + 当前选用谁) */
export interface AiConfig {
  provider: AiProviderKind
  lmstudio: AiLmstudioSettings
  builtin: AiBuiltinSettings
}

/** 一次对话调用的运行时目标:上层业务只认它,不感知底层是 LM Studio 还是内置模型 */
export interface ChatTarget {
  baseUrl: string
  model: string
  apiKey?: string
}

/** 流式输出的增量推送(主进程 → 渲染进程),按 requestId 对号入座 */
export interface AiDeltaPayload {
  id: string
  text: string
}

/** AI 人话解释的结果 */
export interface AiExplainResult {
  /** 能力边界:该语言是否被支持、服务是否通、模型是否返回了内容 */
  status: 'supported' | 'unsupported' | 'error'
  /** 解释文本;出错时是给用户看的人话说明 */
  text: string
  /** 本次用了哪个模型(方便界面回显) */
  model: string
  /** 耗时(ms) */
  durationMs: number
}
