// 主进程与渲染进程共用的数据契约,两边都从这里导入,防止口径不一

/** 全树速览给节点配的一句大白话标签(规则引擎现场算,不劳烦 AI) */
export interface NodeSummary {
  emoji: string
  /** 一句话说清这是干嘛的;界面原样展示 */
  text: string
}

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
  /** 全树速览标签;规则引擎实在认不出时不填(界面不硬凑) */
  summary?: NodeSummary
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
  /**
   * true = 分级扫描还没探进这一层(目录名已知,内容待点开再扫)。
   * 巨型目录(整个 C 盘)扫到节点预算就用不完全展开,靠这个标记让用户点哪探哪
   */
  lazy?: boolean
  /** 全树速览标签;空文件夹等内容太薄时也会给(说它空着) */
  summary?: NodeSummary
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
  /** 分级扫描:因节点预算用尽而暂时没探开的目录数(点开就扫) */
  lazyCount: number
}

/** 一个盘符:根路径 + 可选容量。列盘符只问 Windows「有哪些盘」,不翻任何文件内容 */
export interface DriveInfo {
  letter: string
  root: string
  free?: number
  total?: number
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
  /**
   * 模型上下文大小(tokens),整个 AI 层按它按比例算预算(地图/回复长度等)。
   * 留空 = 自动向模型服务探测(LM Studio /api/v0/models、llama-server /props);
   * 探测不到再退回保守默认 4096。撞墙自动减半重试当最后保险丝。
   */
  contextSize?: number
  /**
   * 联网查证开关,默认关(本地优先、默认离线):开着的唯一作用是——讲解认不出
   * 某个软件/品牌时,拿「名字」去免费公开源查一下再修正答案;不发路径、不发别的
   */
  webLookup?: boolean
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
  /** 能力边界:该语言是否被支持、服务是否通、模型是否返回了内容;cancelled = 用户主动掐掉 */
  status: 'supported' | 'unsupported' | 'error' | 'cancelled'
  /** 解释文本;出错时是给用户看的人话说明 */
  text: string
  /** 本次用了哪个模型(方便界面回显) */
  model: string
  /** 耗时(ms) */
  durationMs: number
}

/**
 * 自由对话挂到消息旁的「当前参考资料」:机器扫描出来的资料,仅供参考。
 * 它是本轮请求的附件,绝不混进对话历史 —— 切换文件时旧资料不会污染新对话。
 */
export interface ChatContextAttachment {
  /** 资料属于哪类对象;none = 没选中任何东西 */
  targetType: 'file' | 'folder' | 'project' | 'none'
  name: string
  relPath: string
  /** 一句话摘要(附件卡收起时展示这句) */
  summary: string
  /** 资料正文(清单/结构),随消息发给模型;有长度上限,别把上下文撑爆 */
  details: string
}

/** 本轮联网查询的程序真实状态:程序做了什么就是什么,模型自己说了不算 */
export type WebLookupState =
  | 'not_requested' // 用户没点名要联网
  | 'disabled' // 点名了,但「联网查证」开关没开,本轮没有查询
  | 'searching' // 正在联网查询
  | 'completed' // 查到了可用资料
  | 'failed' // 查询失败/超时
  | 'empty' // 查完了,但没有找到可用资料

/** 联网查询的状态账本(主进程如实记账 → 界面照实展示) */
export interface WebLookupMeta {
  /** 用户这轮有没有点名要联网/搜索 */
  requested: boolean
  /** 联网查证开关当时开没开 */
  enabled: boolean
  /** 程序有没有真的发起查询 */
  attempted: boolean
  state: WebLookupState
  /** 查到资料时,命中的来源(如「维基百科(中文)」「DuckDuckGo」) */
  sources: string[]
}

/** 自由对话一次请求的载荷(渲染进程 → 主进程) */
export interface AiChatRequest {
  requestId: string
  question: string
  /** 之前的问答(只含用户和探针的消息,资料附件不进来) */
  history: AiHistoryMessage[]
  /** 当前选中对象的资料;没选中就是 null */
  context: ChatContextAttachment | null
}

/** 自由对话一次请求的结果:AI 文本 + 程序真实执行过的联网账本 */
export interface AiChatResult extends AiExplainResult {
  webLookup: WebLookupMeta
}

/** 联网查询进行中/结束时的实时播报(主进程 → 渲染进程),按 requestId 对号入座 */
export interface AiChatLookupPayload {
  id: string
  state: Extract<WebLookupState, 'searching' | 'completed' | 'failed' | 'empty'>
  sources: string[]
}

/**
 * 追问的对话历史(渲染进程 → 主进程):之前的问答对,让追问不失忆。
 * 渲染进程只回传问题和模型自己的回答,证据(路径/清单/结构)由主进程每次现场重摆。
 */
export interface AiHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 功能定位的一个命中:带路人指的文件/文件夹 + 一句大白话理由 */
export interface FeatureHit {
  relPath: string
  reason: string
  /** 带路人自报的把握 0~100;只是排序参考,不是保证 */
  confidence?: number
}

/** 功能定位结果:hits 为空 = 带路人老实说指不了,text 是给人看的说明 */
export interface FeatureLocateResult {
  status: 'supported' | 'unsupported' | 'error' | 'cancelled'
  hits: FeatureHit[]
  /** supported 时是补充说明(可为空);unsupported/error/cancelled 时是给人看的人话 */
  text: string
  model: string
  durationMs: number
}
