// Wiki 跨进程类型:设置、存储标记、提示词事实与输出形状。页面状态、任务事件在 P3 后续步骤用到时再加。
export const WIKI_MARKER_FILE = 'codeatlas-wiki.json'
/** 用户选的文件夹已有别的内容且没有应用标记时,写到这里,不跟用户文件混在一起 */
export const WIKI_SUBDIRECTORY = 'CodeAtlasWiki'
/** 语种代号取 src/shared/translateLangs.ts 的 code;默认简体中文 */
export const DEFAULT_WIKI_LANGUAGE = 'zh-CN'
/** 模型写的正文上限;超出由程序截断并标注 */
export const WIKI_DOC_MAX_CHARS = 4000

export interface WikiSettings {
  /** 用户手选的 Wiki 根;从没选过为 null,不预填、不提供默认路径 */
  location: string | null
  /** 生成语种代号,必须能对上 translateLangs */
  language: string
  /** 用户是否已确认过位置;由 location 是否存在推出,不单独存矛盾状态 */
  hasChosenLocation: boolean
}

/** 预算裁剪计数:裁掉了多少文件、多少文件的符号清单、多少段摘录 */
export interface WikiTruncated {
  files: number
  symbols: number
  excerpts: number
}

/** 一次请求只喂当前这一篇的模块或散件组事实;路径一律项目内相对路径 */
export interface WikiFileFact {
  path: string
  language: string
  inCount?: number
  outCount?: number
  /** 文件开头里的导入目标;内部相对路径与别名优先,用来还原模块内协作 */
  imports?: string[]
  exports?: string[]
  functions?: string[]
  classes?: string[]
  interfaces?: string[]
  reactComponents?: string[]
}

export interface WikiDependencyFact {
  /** 固定为 module:提示词据此说明依赖的是模块而不是文件 */
  kind: 'module'
  moduleId: string
  name: string | null
  /** 模块在仓库里的相对路径;图上展示名用「目录 · 文件」,写文档时按这个路径引用 */
  path?: string
  weight: number
}

export interface WikiModuleFact {
  id: string
  folders: string[]
  files: WikiFileFact[]
  attachedFiles: string[]
  dependsOn: WikiDependencyFact[]
  usedBy: WikiDependencyFact[]
}

/** 散件组沿用文件事实:散件里的源码同样有符号与导入可讲 */
export type WikiGroupFileFact = WikiFileFact

export interface WikiGroupFact {
  id: string
  name: string
  files: WikiGroupFileFact[]
}

export interface WikiExcerpt {
  path: string
  /** 文件开头的有限行数;敏感文件不提供 */
  head: string
}

/** 任务层的页面成员:路径与图上计数;结构符号由事实缓存补齐 */
export interface WikiPageFileSource {
  path: string
  language?: string
  inCount?: number
  outCount?: number
}

/** 一篇 Wiki 的输入:由 IPC 层从模块/散件组拼好,任务只负责逐页生成 */
export interface WikiPageSource {
  pageId: string
  kind: 'module' | 'group'
  /** 程序名,AI 名称不可用时的回退 */
  name: string
  files: WikiPageFileSource[]
  attachedFiles: string[]
  folders: string[]
  dependsOn: WikiDependencyFact[]
  usedBy: WikiDependencyFact[]
}

/** 进度事件里的单页状态:queued 只在首轮快照出现,之后按实际推进更新 */
export type WikiPageRunStatus = 'queued' | 'running' | 'done' | 'skipped' | 'failed' | 'cancelled'

export interface WikiPageProgress {
  pageId: string
  kind: 'module' | 'group'
  name: string
  status: WikiPageRunStatus
  /** 相对语种目录的 MD 路径;done/skipped 时有 */
  file?: string
  /** failed 时的人话原因 */
  error?: string
}

export interface WikiJobEvent {
  projectRoot: string
  language: string
  total: number
  /** 已处理页数(done + skipped + failed + cancelled),进度条按它推进 */
  processed: number
  page: WikiPageProgress
}

/** 主进程推给界面的整轮事件:逐页进度 + 收场汇总 */
export type WikiEvent =
  | ({ type: 'progress' } & WikiJobEvent)
  | {
      type: 'finished'
      projectRoot: string
      language: string
      status: 'done' | 'cancelled' | 'failed'
      done: number
      skipped: number
      failed: number
      cancelled: number
      error?: string
    }

/** 进度页晚于生成开跑时补读的运行快照;任务结束或没有任务时 active=false */
export type WikiRunStatus =
  | { active: false }
  | {
      active: true
      projectRoot: string
      language: string
      total: number
      processed: number
      provider: string
      model: string
    }

/** 开始生成:页面清单由渲染层按当前图谱装配,主进程只信路径与类型 */
export interface WikiStartRequest {
  requestId: string
  projectRoot: string
  language: string
  pages: WikiPageSource[]
  /** 只跑这些页(重试失败项 / 重新生成);不传按缓存键全量检查 */
  only?: string[]
  /** 忽略缓存强制重写 */
  force?: boolean
  /** 已有标签名,给模型对齐写法 */
  knownTags?: string[]
}

export type WikiStartResult =
  | { ok: true; total: number; provider: string; model: string; projectDir: string }
  | { ok: false; error: string }

/** 进度页读到的单篇现状:记账状态 + 文件是否还在 */
export interface WikiPageSummary {
  pageId: string
  kind: 'module' | 'group'
  name: string
  status: 'done' | 'stale' | 'missing' | 'failed' | 'cancelled'
  file: string
  generatedAt: string
  model: string
  truncated: boolean
  exists: boolean
}

/** 侧栏说明区块:没有记账的页返回 none,其余状态已按当前文件内容重算过 */
export type WikiPanelStatus = WikiPageSummary['status'] | 'none'

export interface WikiPanelPage {
  pageId: string
  kind: 'module' | 'group'
  status: WikiPanelStatus
  /** 记账里的 AI 名称;没有记录时为空串,由调用方回退程序名 */
  name: string
  summary: string
  tags: string[]
  keyFiles: string[]
  /** 正文第一段,压成一行给侧栏看 */
  excerpt: string
  file: string
  generatedAt: string
  model: string
}

export type WikiPanelStateResult =
  | { ok: true; language: string; damaged: boolean; pages: WikiPanelPage[] }
  | { ok: false; error: string }

/** 侧栏快照请求:项目、语种与当前图谱切出的页清单 */
export interface WikiPanelRequest {
  projectRoot: string
  language: string
  pages: WikiPageSource[]
}

export interface WikiLanguageSummary {
  code: string
  label: string
  pages: WikiPageSummary[]
}

export type WikiProjectStateResult =
  | { ok: true; projectDir: string; damaged: boolean; languages: WikiLanguageSummary[] }
  | { ok: false; error: string }

/** 根目录扫描(设置卡片与清理确认窗用) */
export interface WikiRootScan {
  location: string | null
  projects: number
  /** 记账里的篇数,含尚未生成成功的失败页 */
  pages: number
  /** 实际还在磁盘上的生成文档数 */
  files: number
  bytes: number
  /** 记账损坏的项目目录,清理会整体拒绝 */
  damaged: string[]
}

export type WikiCleanupOutcome =
  | { ok: true; projects: number; files: number; bytes: number; removedRoot: boolean }
  | { ok: false; reason: string; damaged: string[] }

export type WikiFileOpResult = { ok: true } | { ok: false; message: string }

export type WikiLocationChoice =
  | { ok: true; location: string; usedSubdirectory: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: string }

interface WikiPageFactsBase {
  language: { code: string; name: string }
  project: { name: string; moduleCount: number; groupCount: number; knownTags: string[] }
  excerpts: WikiExcerpt[]
  truncated: WikiTruncated
}

export type WikiPageFacts =
  | (WikiPageFactsBase & { kind: 'module'; module: WikiModuleFact })
  | (WikiPageFactsBase & { kind: 'group'; group: WikiGroupFact })

/** 模型输出通过校验后的内容;JSON 只是载体,这份才用于写 Markdown 与记账 */
export interface WikiPageContent {
  name: string
  summary: string
  tags: string[]
  keyFiles: string[]
  doc: string
  /** 正文超过 WIKI_DOC_MAX_CHARS 被截断 */
  docTruncated: boolean
}
