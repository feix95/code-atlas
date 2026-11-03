// Wiki 新管线的阅读与生成形状:证据包、结构化笔记、账本与单页运行结果。
// 口径见仓库外《Wiki生成改造-需求》定稿 B、C、D 组;本文件只定形状,实现分在 wikiEvidence、wikiNotes、wikiPageGen。
import type { FileStructure, SymbolRange } from '../shared/types.ts'
import type { WikiMemberRole } from './wikiPlanTypes.ts'

/** 笔记规范版本:笔记字段或提示词口径变了就升它,旧缓存按 B4 自然失效 */
export const NOTE_SPEC_VERSION = 1

/** 单页管线版本:证据、笔记与生成口径的组合版本,进结果与后续记账的管线版本组 */
export const WIKI_PAGE_PIPELINE_VERSION = 1

/** 阅读档位(B2、B6):full 全文分段通读;slice 按符号切片;data 程序提取结构;list 只登记不读 */
export type WikiReadTier = 'full' | 'slice' | 'data' | 'list'

/** 代码段:按符号边界切出的阅读单位,是笔记与出处的最小粒度 */
export interface WikiSegment {
  id: string
  path: string
  /** header 为首个符号之前的导入与声明区;symbol 为单个符号声明;body 为符号之间的零散代码 */
  kind: 'header' | 'symbol' | 'body'
  symbolName: string | null
  /** 1 起的行号范围,含两端 */
  startLine: number
  endLine: number
  text: string
  estTokens: number
}

/** 证据包中的一个文件:事实层内容全部由程序提取,与模型无关(B4) */
export interface WikiEvidenceFile {
  path: string
  role: WikiMemberRole
  tier: WikiReadTier
  /** 读取时的内容哈希(G1);读不到为 null */
  contentHash: string | null
  sizeBytes: number
  languageId: string
  structure: FileStructure | null
  symbolRanges: SymbolRange[]
  segments: WikiSegment[]
  /** 数据档的结构提取结果(如 JSON 顶层键、文档标题),代码档为 null */
  dataFacts: string[] | null
  /** 证据不全的原因(读不到、二进制、不支持的语言等),没有为 null;页面须标注(B1) */
  evidenceNote: string | null
}

/** 每页预算账(D5):开跑前算清,所有裁剪与降级逐项记录,不静默丢弃 */
export interface WikiPageBudget {
  contextSize: number
  segmentTokenCap: number
  filesTotal: number
  filesReadable: number
  segmentsTotal: number
  estNoteCalls: number
  estInputTokens: number
  /** 降级与裁剪决定,如「src/x.ts 语言不支持,降为纯文本分段」 */
  decisions: string[]
}

export interface WikiPageEvidence {
  pageId: string
  pageTitle: string
  topicTitle: string | null
  files: WikiEvidenceFile[]
  /** 页内文件之间的引用边(程序图示与结构节的依据) */
  internalEdges: { from: string; to: string }[]
  /** 白名单的外部名:成员文件导入的包与模块名(C6 提及性引用) */
  externalNames: string[]
  budget: WikiPageBudget
}

/** 结构化阅读笔记中的单符号条目(B3 固定字段) */
export interface WikiSymbolNote {
  name: string
  /** 作用一句话 */
  role: string
  deps: string[]
  sideEffects: string
  crossRefs: string[]
}

/** 一段代码的解读层笔记(B3);degraded 表示模型失败后由程序按事实层兜底,不是模型产出 */
export interface WikiSegmentNote {
  segmentId: string
  path: string
  symbolNotes: WikiSymbolNote[]
  /** 本段一句话摘要,供分节生成挑选证据 */
  segmentSummary: string
  degraded: boolean
}

/** 账本条目键(B4):事实层按文件内容;解读层再叠加笔记规范版本与模型标识 */
export function noteCacheKey(
  path: string,
  contentHash: string,
  segmentId: string,
  modelId: string
): string {
  return `${path}|${contentHash}|${segmentId}|v${NOTE_SPEC_VERSION}|${modelId}`
}

/** 模型补全函数的统一形状:管线只依赖它,真实引擎与自测替身都从这里注入 */
export type WikiCompleter = (system: string, user: string, maxTokens: number) => Promise<string>

/** 单页运行的计时与成败统计(D4 实测的原始数据) */
export interface WikiPageRunStats {
  evidenceMs: number
  notesMs: number
  sectionsMs: number
  totalMs: number
  noteCalls: number
  sectionCalls: number
  retries: number
  /** B5 覆盖:主角与配角代码文件的符号总数与已入笔记数 */
  symbolsTotal: number
  symbolsCovered: number
  /** 覆盖缺口(重要符号未入笔记),逐个记录不掩盖 */
  coverageGaps: string[]
  /** 白名单校验未过的节名 */
  checkFailedSections: string[]
  /** 降级笔记的段数(模型失败兜底) */
  degradedNotes: number
  /** 账本命中的段数(没有调用模型) */
  cacheHits: number
  failures: string[]
}

export interface WikiPageRunResult {
  markdown: string
  evidence: WikiPageEvidence
  notes: WikiSegmentNote[]
  stats: WikiPageRunStats
}
