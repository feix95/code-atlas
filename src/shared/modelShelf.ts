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

/** 模态 → 图标档位(2026-09-18,参考 LM Studio 的彩色能力小圆章):界面一行画哪枚描边圆图标全看它。
 *  判定只认 modalityLabel 那句话,label 是唯一事实源,两个函数不打架;认不出一律 other,不硬猜 */
export type ModalityKind = 'vision-audio' | 'vision' | 'audio' | 'text' | 'embed' | 'other'

export function modalityKind(label: string): ModalityKind {
  if (label.startsWith('向量')) return 'embed'
  const vision = label.includes('图像')
  const audio = label.includes('语音')
  if (vision && audio) return 'vision-audio'
  if (vision) return 'vision'
  if (audio) return 'audio'
  if (label === '文本') return 'text'
  return 'other'
}

/** HF API 单条(只挑咱要的字段,其他无视)→ 货架行;烂条目回 null 不进列表 */
export function sanitizeShelfEntry(raw: unknown): ShelfEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'string' || m.id === '') return null
  const ggufObj = typeof m.gguf === 'object' && m.gguf !== null ? (m.gguf as Record<string, unknown>) : null
  const ggufTotal = ggufObj !== null && typeof ggufObj.total === 'number' ? ggufObj.total : null
  return {
    id: m.id,
    modalityLabel: modalityLabel(m),
    ggufTotalBytes: ggufTotal,
    downloads: typeof m.downloads === 'number' ? m.downloads : 0,
    likes: typeof m.likes === 'number' ? m.likes : 0,
    lastModified: typeof m.lastModified === 'string' ? m.lastModified : null
  }
}

export function sanitizeShelfList(raw: unknown): ShelfEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeShelfEntry).filter((e): e is ShelfEntry => e !== null)
}

/** 带得动判定(纯函数):gguf 加载进内存大约要 1.2× 文件大小(RAM 里还要留系统开销),
 *  没有独显也能跑(CPU 慢但能跑),所以只按内存卡「带不动」,显存只用来标注「顺不顺」。
 *  - yes:内存宽裕(文件 ≤ 可用预算)
 *  - tight:贴线(预算的 70% 以上,提醒一句)
 *  - no:超出预算,标灰「你这机器带不动」
 *  预算 = 内存 × 0.7(给系统和其他程序留活路)。内存拿不到(0)时一律 yes(不拦,老实不拦) */
export function judgeRun(fileSizeBytes: number | null, spec: ShelfMachineSpec): RunVerdict {
  if (fileSizeBytes === null || fileSizeBytes <= 0) return 'yes'
  if (spec.ramBytes <= 0) return 'yes'
  const budget = spec.ramBytes * 0.7
  if (fileSizeBytes > budget) return 'no'
  if (fileSizeBytes > budget * 0.7) return 'tight'
  return 'yes'
}

/** 判定的一句话(界面原话);no 是硬拦前的事实陈述,tight 是提醒 */
export function runVerdictLabel(verdict: RunVerdict): string {
  if (verdict === 'no') return '你这机器带不动'
  if (verdict === 'tight') return '贴着极限,可能慢'
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
        : null
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
