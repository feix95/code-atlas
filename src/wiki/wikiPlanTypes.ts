// Wiki 页面规划(主题树切分)的输入与输出形状,以及文件分类口径。
// 规划只做切分与归属,不生成文字;实现见 wikiPlan.ts,口径见仓库外《Wiki生成改造-需求》定稿 A 组。
import { MODULE_TEST_FILE_PATTERNS } from '../modules/moduleConfig.ts'
import type { DepEdge } from '../shared/types.ts'

export { WIKI_PLAN_VERSION } from '../shared/wikiTypes.ts'

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

/** 叶子页主角文件数上限:超过就对该页再切一轮社区(硬线,区别于参考分布的文件数) */
export const PLAN_LEAF_MAX_PRIMARY = 16

/** 叶子页证据量再切目标:约合 8K 上下文下 5 个读取分段;超过先尝试拆页,拆不动才留给 oversized 标记 */
export const PLAN_SPLIT_TOKEN_TARGET = 30_000

/** 功能名成页的候选规模上限:同名标记词横跨多目录的文件超过它就不再像一个功能 */
export const PLAN_FEATURE_MAX_FILES = 40

/** 功能名候选的最少文件数:只有两个文件同名多半是巧合,不成页 */
export const PLAN_FEATURE_MIN_FILES = 3

/** 功能名成页的内聚下限:比纯社区合并放宽,因为公共文件会稀释这类页的引用占比 */
export const PLAN_FEATURE_MIN_COHESION = 0.2

/** 薄页合并线:主角不多于 2 个且证据量低于它的叶子页,并进上级,不单独成页 */
export const PLAN_TINY_PAGE_MAX_PRIMARY = 2
export const PLAN_TINY_PAGE_TOKEN_MAX = 400

/** 功能分片的小片合并线:同功能分片里证据量低于它的, 并进同功能的最大分片 */
export const PLAN_FEATURE_SHARD_TOKEN_MAX = 2500

/** 公共文件(hub)门槛:入度不低于它、且超过有入度文件数的这一比例,才算被到处引用的公共文件 */
export const PLAN_HUB_MIN_IN_DEGREE = 10
export const PLAN_HUB_SHARE = 0.05

/** 旧目录树兜底的最深层级(与需求 A2 的「最多约 4 层」一致) */
export const PLAN_TREE_MAX_DEPTH = 4

/** 主题树最深层级(含章):与 Qoder 一样最多 5 层 */
export const PLAN_THEME_MAX_DEPTH = 5

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
  '.pdf',
  // 运行日志是产物不是源码:只挂靠不做主角,免得进正文与图
  '.log'
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
  /**
   * 跨进程契约:某个文件用到了公共文件导出的成员(通道常量这类)。
   * 没扫描过就缺省,主题亲和只靠引用边和文件名。
   */
  channelUses?: WikiChannelUse[]
}

/** 一个文件用到了某个公共文件的一个导出成员 */
export interface WikiChannelUse {
  file: string
  hub: string
  member: string
}

/** 分组阶段的中间产物:一组将成为一张叶子页 */
export interface DraftGroup {
  primary: string[]
  supporting: string[]
  basis: string[]
  crossDir: boolean
  /** 功能名成页的标记词;有值表示整组属于同一功能 */
  feature?: string
  /** 功能主题键(如 feature:wiki):同功能拆出的多页靠它归到同一主题下 */
  topicKey?: string
  /** 公共文件页:不再切、不吸收孤立文件 */
  hub?: boolean
}

export type WikiPlanPageKind = 'leaf' | 'overview' | 'root'
/** reference 只挂出处:不占证据预算,不参与连线归属,也不算文件的主人 */
export type WikiMemberRole = 'primary' | 'supporting' | 'attached' | 'reference'

/** 主角和配角才算这页的证据;附属与引用都不算 */
export function memberOwnsEvidence(role: WikiMemberRole): boolean {
  return role === 'primary' || role === 'supporting'
}

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
  /** 主题目录覆盖:功能页按功能标记词归主题(如 feature:wiki),不按锚点目录;其余页为 null */
  topicDir: string | null
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
  /** 模型给这页的写作指令;没有就不写,避免空字段进规划 */
  writingPrompt?: string
}

export type WikiTopicKind = 'skeleton' | 'theme' | 'section'

export interface WikiPlanTopic {
  id: string
  /** 程序名;主题树里是章名或主题名,旧目录树兜底仍是目录名 */
  title: string
  /** 主题键;主题树用章/主题 slug,旧目录树兜底仍是目录 */
  dir: string
  /** 骨架章、功能主题或二级子章;旧目录树兜底不填 */
  kind?: WikiTopicKind
  /** 稳定短名,给目录缓存和路径用;旧目录树兜底不填 */
  slug?: string
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
  /** 公共文件(被到处引用的类型表、通道表等):不参与聚类,线索桌不画指向它们的引用线 */
  hubs: string[]
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
