// 模型货架的公共账(纯函数,自测覆盖):清洗抱抱脸 API 响应 + 「你这机器带不带得动」判定。
// 家规:货架零判断纯事实 —— 大小/时间/模态/下载量全是从 API 原样拉回的数字,咱只负责
// 摆整齐说人话;唯一掺的判断是「带不动」标记,那是保护小白别白下 40GB 的兜底,不评好坏。
// 数据一次拉内存里用,缓存几分钟,不落盘 —— 不给用户电脑留任何货架垃圾。

/** 拉回来的整单(榜单 + 本机家底 + 实际用的源);类型住 shared,preload/渲染层引它不拉运行时依赖 */
export interface ShelfResult {
  entries: ShelfEntry[]
  /** 本机家底(渲染层标「带不动」用) */
  spec: ShelfMachineSpec
  /** 实际用了哪个源(调试/界面小灰字「数据来自镜像」用) */
  source: 'huggingface' | 'mirror'
}

/** 下载进度广播(主进程 → 渲染层,订阅式) */
export interface ModelDownloadProgress {
  repoId: string
  filePath: string
  /** 已落盘字节(含续传的部分) */
  receivedBytes: number
  /** 文件总字节;问不到 Content-Length 时 null */
  totalBytes: number | null
  /** 下载完成的最终路径;未完成 = null */
  finalPath: string | null
  /** 出错人话(重试全失败);null = 正常进行中 */
  error: string | null
  cancelled: boolean
}

/** 货架上的一行(清洗后的最终形态,全是要直接上界面的字段) */
export interface ShelfEntry {
  /** 仓库全名,如 unsloth/Qwen3-4B-Instruct-GGUF */
  id: string
  /** 模态人话标签,如「文本」「文本+图像」 */
  modalityLabel: string
  /** 仓库内 gguf 总字节数(API 的 gguf.total;拿不到 = null,界面老实显示「未知」) */
  ggufTotalBytes: number | null
  downloads: number
  likes: number
  /** ISO 时间字符串(原样) */
  lastModified: string | null
  /** 参数量级灰字(从仓库名解析,如 9B;解析不出 = null,不显示 —— 家规:解析不出不硬猜) */
  paramScale: string | null
  /** 底座模型(tags 里 base_model: 前缀,原样;没标 = null,档案卡整格不显示) */
  baseModel: string | null
  /** 开源协议(tags 里 license: 前缀,原样标识;没标 = null。只摆事实,不判「能不能商用」) */
  license: string | null
}

/** 货架准入(2026-09-18 小葵定):不是文本打底的一律过滤 —— 产品只要文字/工具调用/视觉三样,
 *  语音/向量/视频/分类这些 llama-server 当聊天模型跑不了的,不上架。
 *  白名单 = 任务标签直接命中;HF 大量 GGUF 量化仓不标 pipeline_tag(榜单 60 条里 44 条没标),
 *  tags 里有 conversational(带聊天模板)或白名单任务标签的也算文本打底,别把能跑的误杀。
 *  (模型能力章 2026-09-18 小葵裁定撤下:API 没有工具/思考的标准字段,tags 覆盖率太低,
 *   拿不到准数据就不显示;准入过滤不受影响照常把门) */
const CHAT_TASK_TAGS = ['text-generation', 'text2text-generation', 'translation', 'image-text-to-text']

export function isChatCapable(entry: { pipeline_tag?: unknown; tags?: unknown }): boolean {
  const pipeline = typeof entry.pipeline_tag === 'string' ? entry.pipeline_tag : ''
  const tagList = Array.isArray(entry.tags) ? entry.tags.filter((t): t is string => typeof t === 'string') : []
  if (CHAT_TASK_TAGS.includes(pipeline)) return true
  return tagList.includes('conversational') || CHAT_TASK_TAGS.some((t) => tagList.includes(t))
}

/** 参数量级(纯函数):从仓库名里解析最大的 N B —— Ornith-1.5-9B → 9B,Qwen3.8-27B → 27B,
 *  MoE 乘数也认:8x7B = 8 个 7B 专家 = 56B 总参。前后必须断词:4bit(位宽)、9BGGUF(粘连)都不算;
 *  名字里没写参数(GLM-4.5 这类)老实回 null,不硬猜 —— 家规:解析不出不显示 */
export function parseParamScale(name: string): string | null {
  let max = 0
  for (const m of name.matchAll(/(?<![a-z0-9])(\d+(?:\.\d+)?)b(?![a-z0-9])/gi)) {
    const v = Number.parseFloat(m[1])
    if (Number.isFinite(v) && v > max) max = v
  }
  // 8x7B 的乘积也算一份;x 前面的数字不会跟单独 B 重复计(7B 的 7 前面是 x,被断词挡住)
  for (const m of name.matchAll(/(?<![a-z0-9])(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)b(?![a-z0-9])/gi)) {
    const v = Number.parseFloat(m[1]) * Number.parseFloat(m[2])
    if (Number.isFinite(v) && v > max) max = v
  }
  if (max <= 0) return null
  return `${Number.isInteger(max) ? max : max.toFixed(1)}B`
}

/** 本机家底(判定带不带得动用) */
export interface ShelfMachineSpec {
  ramBytes: number
  /** 独显显存字节;认不出 = null(不影响判定,内存也兜得住,只是可能慢) */
  vramBytes: number | null
}

export type RunVerdict = 'yes' | 'tight' | 'no'

/** 模态人话映射:pipeline_tag / tags 里的模态线索 → 一两个字的标签。
 *  认不出就老实回「其他」,不硬猜 */
export function modalityLabel(entry: { pipeline_tag?: unknown; tags?: unknown }): string {
  const tagList = Array.isArray(entry.tags) ? entry.tags.filter((t): t is string => typeof t === 'string') : []
  const pipeline = typeof entry.pipeline_tag === 'string' ? entry.pipeline_tag : ''
  const has = (s: string): boolean => pipeline === s || tagList.includes(s)
  // 多模态组合优先:图文/音文混着来的,标签说全
  const vision = has('image-text-to-text') || tagList.some((t) => t.includes('vision') || t === 'multimodal')
  const audio = has('audio-text-to-text') || tagList.some((t) => t.startsWith('audio'))
  if (vision && audio) return '文本+图像+语音'
  if (vision) return '文本+图像'
  if (audio) return '文本+语音'
  if (has('text-generation')) return '文本'
  if (has('text2text-generation') || has('translation')) return '文本'
  if (has('feature-extraction')) return '向量(不适合聊天)'
  return '其他'
}

/** HF API 单条(只挑咱要的字段,其他无视)→ 货架行;烂条目或不是文本打底的回 null 不进列表 */
export function sanitizeShelfEntry(raw: unknown): ShelfEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'string' || m.id === '') return null
  // 准入过滤(2026-09-18 小葵定):不是文本打底的直接不进货架,列表里根本见不着
  if (!isChatCapable(m)) return null
  const ggufObj = typeof m.gguf === 'object' && m.gguf !== null ? (m.gguf as Record<string, unknown>) : null
  const ggufTotal = ggufObj !== null && typeof ggufObj.total === 'number' ? ggufObj.total : null
  // 档案字段(tags 里捞事实,一次性洗好,渲染层拿来就用)
  const tagList = Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string') : []
  let baseModel: string | null = null
  let license: string | null = null
  for (const t of tagList) {
    if (baseModel === null && t.startsWith('base_model:')) baseModel = t.slice('base_model:'.length) || null
    if (license === null && t.startsWith('license:')) license = t.slice('license:'.length) || null
  }
  return {
    id: m.id,
    modalityLabel: modalityLabel(m),
    ggufTotalBytes: ggufTotal,
    downloads: typeof m.downloads === 'number' ? m.downloads : 0,
    likes: typeof m.likes === 'number' ? m.likes : 0,
    lastModified: typeof m.lastModified === 'string' ? m.lastModified : null,
    paramScale: parseParamScale(m.id),
    baseModel,
    license
  }
}

export function sanitizeShelfList(raw: unknown): ShelfEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeShelfEntry).filter((e): e is ShelfEntry => e !== null)
}

/** 拉货/下载的双源域名:主源直连,备源国内镜像;API 与 resolve 路径同构,只换域名。
 *  货架拉取(ai/modelShelf)和断点续传下载(ai/modelDownload)共用这一份 */
export const HF_HOSTS = ['https://huggingface.co', 'https://hf-mirror.com'] as const

/** 直连 HF 的耐心(毫秒):连不上别拖累界面,短超时快换镜像 */
export const HF_API_TIMEOUT_MS = 8_000
/** 镜像兜底的耐心(毫秒):都走到镜像了多等一会,别再折腾用户 */
export const HF_MIRROR_TIMEOUT_MS = 15_000

/** 「带得动」判定的三杆秤(四面判定面共用,调系数只许动这里):
 *  显存杆:模型 + 上下文缓存 ≤ 显存 × 0.9 → 整个进显卡;
 *  内存宽裕杆:≤ 内存 × 0.5 → 装得下;
 *  内存上限杆:≤ 内存 × 0.7 → 塞得下但系统会挤,再往上就是装不下(给系统留活路)。 */
export const MODEL_FIT_VRAM_RATIO = 0.9
export const MODEL_FIT_RAM_OK_RATIO = 0.5
export const MODEL_FIT_RAM_MAX_RATIO = 0.7
/** 「接近预算」的贴线宽度:占到预算这几成就亮 tight 提醒 */
export const MODEL_FIT_TIGHT_EDGE = 0.7

/** 带得动判定(纯函数):gguf 加载进内存大约要 1.2× 文件大小(RAM 里还要留系统开销),
 *  没有独显也能跑(CPU 慢但能跑),所以只按内存卡「带不动」,显存只用来标注「顺不顺」。
 *  - yes:内存宽裕(文件 ≤ 可用预算)
 *  - tight:贴线(预算的 70% 以上,提醒一句)
 *  - no:超出预算,标「超出内存预算」
 *  预算 = 内存 × MODEL_FIT_RAM_MAX_RATIO(给系统和其他程序留活路)。
 *  内存拿不到(0)时一律 yes(不拦,老实不拦) */
export function judgeRun(fileSizeBytes: number | null, spec: ShelfMachineSpec): RunVerdict {
  if (fileSizeBytes === null || fileSizeBytes <= 0) return 'yes'
  if (spec.ramBytes <= 0) return 'yes'
  const budget = spec.ramBytes * MODEL_FIT_RAM_MAX_RATIO
  if (fileSizeBytes > budget) return 'no'
  if (fileSizeBytes > budget * MODEL_FIT_TIGHT_EDGE) return 'tight'
  return 'yes'
}

/** 判定的两个词(界面原话,2026-09-18 小葵拍板走专业简短风);no 是硬拦前的事实陈述,tight 是提醒 */
export function runVerdictLabel(verdict: RunVerdict): string {
  if (verdict === 'no') return '超出内存预算'
  if (verdict === 'tight') return '接近内存预算'
  return ''
}

/** 货架筛选与排序(纯函数) */
export interface ShelfQuery {
  /** 大小上限(字节);null = 不筛 */
  maxBytes: number | null
  /** 排序键:downloads(热门↔冷门)/ lastModified(最新↔最旧) */
  sortBy: 'downloads' | 'lastModified'
  desc: boolean
}

export function applyShelfQuery(entries: ShelfEntry[], q: ShelfQuery): ShelfEntry[] {
  const filtered = q.maxBytes === null ? entries : entries.filter((e) => e.ggufTotalBytes === null || e.ggufTotalBytes <= q.maxBytes!)
  const sorted = [...filtered].sort((a, b) => {
    const av = q.sortBy === 'downloads' ? a.downloads : a.lastModified ? Date.parse(a.lastModified) : 0
    const bv = q.sortBy === 'downloads' ? b.downloads : b.lastModified ? Date.parse(b.lastModified) : 0
    return q.desc ? bv - av : av - bv
  })
  return sorted
}

/** 仓库内一个 gguf 文件(tree 接口拉回来的) */
export interface RepoFile {
  path: string
  sizeBytes: number | null
  /** 量化等级灰字(从文件名解析的技术翻译,如 Q8_0 → 几乎无损;认不出 = null 不显示) */
  quantNote: string | null
}

/** 量化档位 → 灰字注(技术翻译,不是评测:只说压缩档位的事实含义,帮小白对号入座,
 *  不评哪个「更好」;认不出回 null,不硬猜 —— 与「带不动」同一分寸)。
 *  IQ3 归「智力开始掉」档(IQ 系列比同级 Q 更小,IQ4 单独一档「再小一号」) */
const QUANT_NOTE_TABLE: Array<[RegExp, string]> = [
  [/^(?:bf|fp|f)16$/i, '全精度,质量不打折'],
  [/^iq4/i, '再小一号,质量略降'],
  [/^q8/i, '几乎无损'],
  [/^q6/i, '接近无损'],
  [/^q5/i, '损失很小'],
  [/^q4/i, '大小和质量平衡的主流选择'],
  [/^iq3/i, '体积小不少,智力开始掉'],
  [/^q3/i, '体积小不少,智力开始掉'],
  [/^iq[12]/i, '体积很小,智力损失明显'],
  [/^q[12]/i, '体积很小,智力损失明显']
]

/** 从文件名解析量化标记 → 灰字注:Q4_K_M / IQ2_XXS / Q8_0 / F16 这类独立 token,
 *  前后必须是分隔符或首尾(Qwen2.5 的 Qw、9B 的 B 都不吃);认不出档位也回 null */
export function parseQuantNote(fileName: string): string | null {
  const m = fileName.match(/(?:^|[^a-z0-9])(i?q\d(?:_[a-z0-9]+)*|(?:bf|fp|f)16)(?![a-z0-9])/i)
  if (!m) return null
  for (const [re, note] of QUANT_NOTE_TABLE) {
    if (re.test(m[1])) return note
  }
  return null
}

export function sanitizeRepoFiles(raw: unknown): RepoFile[] {
  if (!Array.isArray(raw)) return []
  const out: RepoFile[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const m = item as Record<string, unknown>
    if (typeof m.path !== 'string' || !m.path.toLowerCase().endsWith('.gguf')) continue
    out.push({
      path: m.path,
      sizeBytes: typeof m.size === 'number' ? m.size : typeof (m.lfs as Record<string, unknown> | undefined)?.size === 'number'
        ? ((m.lfs as Record<string, unknown>).size as number)
        : null,
      quantNote: parseQuantNote(m.path)
    })
  }
  return out
}

/** 字节数 → 人话大小(GB 一档就够,货架上的都是几 GB 到几十 GB 的大家伙);拿不到老实说「未知」 */
export function formatGgufSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '未知'
  const gb = bytes / 1024 ** 3
  return gb >= 10 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`
}

/** 下载量 → 人话:12817609 → 「1281.8万」,1234 → 「1234」;界面不甩生数字 */
export function formatDownloads(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)} 亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`
  return String(n)
}

/** 更新时间 → 人话:几天前 / 几个月前 / 几年前;解析不了老实说「未知」 */
export function formatRelativeDays(iso: string | null): string {
  if (!iso) return '未知'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '未知'
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return '今天'
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}
