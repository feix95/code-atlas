// Wiki 页面规划(主题树切分)的输入与输出形状,以及文件分类口径。
// 规划只做切分与归属,不生成文字;实现见 wikiPlan.ts,口径见仓库外《Wiki生成改造-需求》定稿 A 组。
import { MODULE_TEST_FILE_PATTERNS } from '../modules/moduleConfig.ts'
import type { DepEdge } from '../shared/types.ts'

/** 规划器版本:切分口径变化时加一,旧规划据此整体过期 */
export const WIKI_PLAN_VERSION = 1

/** 叶子页文件数的参考上限(参考分布,不是硬指标;主指标是证据量,见下) */
export const PLAN_LEAF_SOFT_MAX_FILES = 8

/**
 * 单页证据量预算(估算 token):主角与配角代码合计超过它,切分阶段先尝试拆页,
 * 拆不动的标记 oversized,留给分段通读消化,不静默丢文件
 */
export const PLAN_PAGE_EVIDENCE_TOKEN_CAP = 90_000

/** 粗估:代码平均每 token 的字节数(中英混排代码的经验值,只用于规划期估算) */
export const PLAN_BYTES_PER_TOKEN = 3

/** 跨目录合并的内聚门槛:社区内部引用占其全部引用的比例达到它,才许打破目录边界 */
export const PLAN_CROSS_DIR_MIN_COHESION = 0.5

/** 跨目录合并的规模上限:再大就不像一个功能页,留在各自目录里 */
export const PLAN_CROSS_DIR_MAX_FILES = 12

/** 主题树最深层级(与需求 A2 的「最多约 4 层」一致) */
export const PLAN_TREE_MAX_DEPTH = 4

/** 文件在规划里的分类:决定它当主体、挂靠还是不进页面 */
export type WikiPlanFileKind = 'code' | 'test' | 'style' | 'doc' | 'data' | 'asset'

const STYLE_EXTS = new Set(['.css', '.scss', '.less', '.sass'])
const DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.rst'])
const DATA_EXTS = new Set(['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.env'])
const ASSET_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.icns',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.wav',
  '.mp4',
  '.webm',
  '.pdf'
])
/** 自测判定与 P2 切分共用 MODULE_TEST_FILE_PATTERNS,这里只补它没覆盖的旅程与夹具文件 */
const EXTRA_TEST_PATTERNS: readonly RegExp[] = [/(^|\/)journey-[^/]+$/, /(^|\/)[^/]*fixture[^/]*$/]

function extOf(relPath: string): string {
  const dot = relPath.lastIndexOf('.')
  return dot < 0 ? '' : relPath.slice(dot).toLowerCase()
}

/** 按路径与扩展名分类;认不出的默认按代码处理,宁可多读不可漏掉 */
export function classifyPlanFile(relPath: string): WikiPlanFileKind {
  const ext = extOf(relPath)
  if (MODULE_TEST_FILE_PATTERNS.some((re) => re.test(relPath))) return 'test'
  if (EXTRA_TEST_PATTERNS.some((re) => re.test(relPath))) return 'test'
  if (STYLE_EXTS.has(ext)) return 'style'
  if (DOC_EXTS.has(ext)) return 'doc'
  if (ASSET_EXTS.has(ext)) return 'asset'
  if (DATA_EXTS.has(ext)) return 'data'
  return 'code'
}

/** 规划输入的单文件信息:由关系分析结果与事实缓存装配 */
export interface WikiPlanFileInput {
  relPath: string
  /** 认不出语言时为空串 */
  languageId: string
  sizeBytes: number
  exports: string[]
  functions: string[]
  classes: string[]
  reactComponents: string[]
  /** 被几个项目内文件引用 */
  inCount: number
  /** 引用了几个项目内文件 */
  outCount: number
}

export interface WikiPlanInput {
  projectName: string
  files: WikiPlanFileInput[]
  edges: DepEdge[]
  /** 项目根的文档文件(README 等)相对路径 */
  rootDocs: string[]
  /** 清单文件相对路径(package.json 等);没有为 null */
  manifestPath: string | null
  /** 清单文件里登记的脚本名;用来提名快速开始等根主题 */
  manifestScripts: string[]
}

export type WikiPlanPageKind = 'leaf' | 'overview' | 'root'
export type WikiMemberRole = 'primary' | 'supporting' | 'attached'

export interface WikiPlanMember {
  path: string
  role: WikiMemberRole
}

export interface WikiPlanPage {
  /** 稳定标识:由主题锚点(目录加核心入口符号)生成,与文件集合解耦 */
  id: string
  kind: WikiPlanPageKind
  /** 程序名;模型润名是后续步骤,落盘后锁定 */
  title: string
  /** 主题锚点目录;根主题页为 '' */
  anchorDir: string
  /** 主题锚点符号:页内核心入口文件的首要导出/类/函数名;取不到为 null */
  anchorSymbol: string | null
  /** 所属主题 id;根主题页为 null */
  topicId: string | null
  members: WikiPlanMember[]
  /** 主角与配角代码的估算 token 合计 */
  evidenceTokens: number
  /** 拆页后仍超证据预算:正文阶段靠分段通读消化 */
  oversized: boolean
  /** 切分依据(信号留痕),供切分评审与排障 */
  basis: string[]
}

export interface WikiPlanTopic {
  id: string
  /** 程序名(目录名) */
  title: string
  /** 主题对应的目录;根层为 '' */
  dir: string
  /** 本主题的总览页 id;子项不足 2 个时没有总览页,为 null */
  overviewPageId: string | null
  /** 直接挂在本主题下的叶子页 id */
  pageIds: string[]
  children: WikiPlanTopic[]
}

export interface WikiPlan {
  version: number
  projectName: string
  topics: WikiPlanTopic[]
  /** 根主题页 id(项目概述、快速开始等),按提名顺序 */
  rootPageIds: string[]
  pages: WikiPlanPage[]
  /** 没归进任何页的文件与原因(资源文件等),不静默消失 */
  unassigned: { path: string; reason: string }[]
  stats: {
    files: number
    codeFiles: number
    leafPages: number
    overviewPages: number
    rootPages: number
    oversizedPages: number
  }
}
