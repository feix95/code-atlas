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
  exports?: string[]
  functions?: string[]
  classes?: string[]
  interfaces?: string[]
  reactComponents?: string[]
}

export interface WikiDependencyFact {
  moduleId: string
  name: string | null
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

export interface WikiGroupFileFact {
  path: string
  language: string
}

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
