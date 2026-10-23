// 联网查的源队列(2026-09-17 产品定序):Tavily(用户自己填了 Key 才启用)→ DuckDuckGo
// 免注册 HTML(免 Key,但非官方承诺,页面结构可能变)→ 中文维基 → 英文维基 ——
// 真搜索引擎优先,百科垫底。Tavily 是官方 API 合同(免费档每月 1000 次),Key 存用户配置文件,
// 绝不写进代码。都查不到就返回空清单,调用方回退本地推测,绝不报错炸掉。
// 隐私边界:调用方只许传文件夹/文件的名字,绝不传完整本地路径。
import {
  parseTavilyUsage,
  tavilyVerdictFromStatus,
  type TavilyProbeResult
} from '../shared/tavily.ts'
import { stripHtmlTags } from './webGate.ts'

/** 单个源的耐心:5 秒,超时就当没查到 —— 联网是锦上添花,不能拖慢讲解 */
export const WEB_LOOKUP_TIMEOUT_MS = 5_000

/** 取网页正文用的传输层:主进程默认给 Chromium 的 net.fetch(自动跟随系统代理) */
export type LookupTransport = (url: string) => Promise<string>

/** POST 传输(Tavily 这类带 JSON body 和认证头的源用):主进程给 net.fetch 版,测试可注入假的 */
export type LookupPostTransport = (
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
) => Promise<string>

/** GET 传输(Tavily 用量查询这类只带认证头的读请求用):主进程给 net.fetch 版,测试可注入假的 */
export type LookupGetTransport = (url: string, headers: Record<string, string>) => Promise<string>

/** 一轮联网搜索的全部家当:两条传输(可注入)+ 可选的 Tavily Key */
export interface WebSearchTransports {
  fetchText?: LookupTransport
  postJson?: LookupPostTransport
  /** Tavily 的 Key:填了 Tavily 排队首,空着整条免费链 */
  tavilyKey?: string
}

/** 单条搜索结果:标题、纯文本摘要、真实链接、来自哪个源、发布时间(源给了才填) */
export interface WebSearchHit {
  title: string
  snippet: string
  url: string
  source: string
  published?: string
}

/** Node 版默认传输:直连。断网/被墙就拿不到,主进程实际用的是跟随系统代理的 net.fetch */
export const nodeFetchText: LookupTransport = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1' },
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * 带状态码的传输层报错:普通搜索链只关心「这个源认输,换下一个」,状态码无所谓;
 * 但 Key 体检要按状态码分档说人话(401 = Key 不对,432 = 额度用完),所以错误得把码带上。
 */
export class HttpStatusError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`HTTP ${status}`)
    this.name = 'HttpStatusError'
    this.status = status
  }
}

/** Node 版默认 POST 传输(自测用):直连发 JSON,主进程实际用 net.fetch 版(跟随系统代理) */
export const nodePostJsonTransport: LookupPostTransport = async (url, body, headers) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new HttpStatusError(res.status)
  return res.text()
}

/** Node 版默认 GET 传输(自测用):直连,主进程实际用 net.fetch 版(跟随系统代理) */
export const nodeGetTransport: LookupGetTransport = async (url, headers) => {
  const res = await fetch(url, {
    headers: {
      ...headers,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1'
    },
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new HttpStatusError(res.status)
  return res.text()
}

// ── Tavily 源(2026-09-17 产品裁定接进队首):官方 API,免费档每月 1000 次,Key 用户自备 ──

/** Tavily 搜索的官方入口(写死,不跟别的源混) */
export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

/** 每次搜索要几条结果:官方默认 10 条太多,8 条能把官方页、社区帖、评测都摆上桌还不算浪费响应体积 */
export const TAVILY_MAX_RESULTS = 8

/** Tavily 每条结果的内容段数:3 段是官方上限,同一页里最相关的几段都带上,比只给一句摘要够用 */
export const TAVILY_CHUNKS_PER_SOURCE = 3

/**
 * Tavily 响应洗成搜索命中(纯函数,自测覆盖):results[].{title,url,content} 一条条验,
 * 缺标题/缺链接的跳过;HTML 标记剥干净;坏 JSON / 缺 results 数组 = 空清单,让兜底链接着走
 */
export function parseTavilyResults(raw: string): WebSearchHit[] {
  let data: { results?: unknown }
  try {
    data = JSON.parse(raw) as { results?: unknown }
  } catch {
    return []
  }
  const rows = Array.isArray(data.results) ? data.results : []
  const hits: WebSearchHit[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const title = typeof r.title === 'string' ? stripHtmlTags(r.title) : ''
    const url = typeof r.url === 'string' ? r.url.trim() : ''
    const snippet = typeof r.content === 'string' ? stripHtmlTags(r.content) : ''
    const published = typeof r.published_date === 'string' ? r.published_date.trim() : ''
    if (title === '' || url === '') continue
    hits.push({
      title,
      snippet,
      url,
      source: 'Tavily',
      ...(published !== '' ? { published } : {})
    })
  }
  return hits
}

/** Tavily 搜索:POST + Bearer 认证头(Key 不进 URL,免得进日志);网络层报错原样抛,兜底链自己接 */
async function searchTavilyHits(
  query: string,
  postJson: LookupPostTransport,
  apiKey: string
): Promise<WebSearchHit[]> {
  const raw = await postJson(
    TAVILY_SEARCH_URL,
    {
      query,
      search_depth: 'basic',
      chunks_per_source: TAVILY_CHUNKS_PER_SOURCE,
      max_results: TAVILY_MAX_RESULTS,
      // 需要「最新评价/价格」时,发布日期是判断新鲜度的硬证据;源没给就空着
      include_published_date: true
    },
    { Authorization: `Bearer ${apiKey}` }
  )
  return parseTavilyResults(raw)
}

// ── Key 体检(2026-09-17 产品裁定):设置里点「测一下」,真打一次官方接口验货 ──
// 2026-09-17 二次改造(小葵提议):从实搜一次改打 /usage —— 零搜索额度成本,
// 200 本身就证明 Key 有效,还白送本月用量;真搜索通不通,平时聊天调 web_search 立见分晓。

/** Tavily 用量查询的官方入口:GET,同一个 Key 挂 Bearer 头,回话带计划限额和已用 */
export const TAVILY_USAGE_URL = 'https://api.tavily.com/usage'

/**
 * 拿 Key 查一次官方用量,把战果翻成结论(纯逻辑,自测注入假传输)。
 * Key 只走认证头,不进 URL;结论只回给界面看,不落盘。
 * 200 + 回话形状对 = 能用,附带用量细账;200 但形状不像(劫持门户页/改版)= 看不懂,不吹能用;
 * 4xx/5xx 按官方文档分档说人话(401 Key 不认、432/433 额度用完、429 太频繁)。
 */
export async function probeTavilyKey(
  key: string,
  getJson: LookupGetTransport = nodeGetTransport
): Promise<TavilyProbeResult> {
  try {
    const raw = await getJson(TAVILY_USAGE_URL, { Authorization: `Bearer ${key}` })
    const usage = parseTavilyUsage(raw)
    return usage ? { verdict: 'ok', status: 200, usage } : { verdict: 'other', status: 200 }
  } catch (err) {
    if (err instanceof HttpStatusError)
      return { verdict: tavilyVerdictFromStatus(err.status), status: err.status }
    // 超时/断网/DNS 不通/代理失败:不是 Key 的问题,老实说「没连上」
    return { verdict: 'unreachable' }
  }
}

/**
 * 维基命中的相关性把关(纯函数,自测覆盖):维基搜索是字面检索,操作性/组合
 * 问题常配回一堆弱关联条目(问「永结无间 卸载残留」给你 WhatsApp 和糖果传奇),
 * 而按序兜底的链条一看「有结果」就收工,真正能答的真搜索引擎轮不到。把关
 * 规则:查询按空格切段(≥2 字才算数),任何一段在任一命中的标题或摘要里出现
 * 才算相关 —— 一段都对不上就当没查到,让后面的源接手。
 * 只把关维基,不过问 DDG:DDG 是真搜索引擎,自带错别字纠错和相关性排序
 * (搜「永结无间」会自动纠正成「永劫无间」,结果字面可能不含原词),程序再
 * 拿原词对账反而会把好结果误杀。
 */
export function wikiHitsRelevant(query: string, hits: WebSearchHit[]): boolean {
  if (hits.length === 0) return false
  const segments = query
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
  if (segments.length === 0) return true // 没有可对账的段(比如光一个字),不把关
  const hay = hits.map((h) => `${h.title} ${h.snippet}`.toLowerCase()).join('\n')
  return segments.some((seg) => hay.includes(seg))
}

/** 维基百科条目搜索(单语言):最多 3 条,链接按条目名拼出官方地址;弱关联垃圾过不了相关性把关 */
async function searchWikipediaHits(
  lang: string,
  query: string,
  fetchText: LookupTransport
): Promise<WebSearchHit[]> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=3` +
    `&srsearch=${encodeURIComponent(query)}`
  const data = JSON.parse(await fetchText(url)) as {
    query?: { search?: Array<{ title?: string; snippet?: string }> }
  }
  const hits = data.query?.search ?? []
  const out: WebSearchHit[] = []
  for (const h of hits) {
    const title = (h.title ?? '').trim()
    if (title === '') continue
    out.push({
      title,
      snippet: stripHtmlTags(h.snippet ?? ''),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`,
      // 界面上的来源标签说人话:给全称「维基百科(英文)」,不露 en 这类缩写
      source: lang === 'zh' ? '维基百科(中文)' : '维基百科(英文)'
    })
  }
  return wikiHitsRelevant(query, out) ? out : []
}

/** DuckDuckGo 的跳转壳链接里剥出真实地址(//duckduckgo.com/l/?uddg=<编码后的真链接>),剥不出就当无效 */
function ddgRealUrl(href: string): string {
  let value = href.trim()
  if (value.startsWith('//')) value = `https:${value}`
  try {
    const u = new URL(value)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.searchParams.get('uddg') ?? u.toString()
  } catch {
    return ''
  }
}

/** DuckDuckGo 免注册 HTML 搜索:抓自然结果的标题/摘要/真实链接,广告位(ad_domain)直接跳过 */
async function searchDuckDuckGoHits(
  query: string,
  fetchText: LookupTransport
): Promise<WebSearchHit[]> {
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)
  const anchors = [...html.matchAll(/<a\s+([^>]*class="result__a"[^>]*)>([\s\S]*?)<\/a>/g)]
  const snippets = [...html.matchAll(/<a\s+[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
  const hits: WebSearchHit[] = []
  for (let i = 0; i < anchors.length && hits.length < 6; i++) {
    // 锚点属性里带 ad_domain = 广告位,跳过,不给模型喂广告
    if ((anchors[i]?.[1] ?? '').includes('ad_domain=')) continue
    const title = stripHtmlTags(anchors[i]?.[2] ?? '')
    if (title === '') continue
    const href = /href="([^"]*)"/.exec(anchors[i]?.[1] ?? '')?.[1] ?? ''
    const url = ddgRealUrl(href)
    if (url === '') continue
    hits.push({ title, snippet: stripHtmlTags(snippets[i]?.[1] ?? ''), url, source: 'DuckDuckGo' })
  }
  return hits
}

/**
 * 取材料的查询链,按序兜底:Tavily(有 Key)→ DuckDuckGo → 中文维基 → 英文维基。
 * 每个源带名字,查到哪个就记哪个,界面上"已联网查询:×××"说的就是它。
 */
function buildSourceChain(
  query: string,
  opts: WebSearchTransports
): Array<{ name: string; run: () => Promise<WebSearchHit[]> }> {
  const fetchText = opts.fetchText ?? nodeFetchText
  const postJson = opts.postJson ?? nodePostJsonTransport
  const chain: Array<{ name: string; run: () => Promise<WebSearchHit[]> }> = []
  if (opts.tavilyKey && opts.tavilyKey.trim() !== '') {
    const key = opts.tavilyKey.trim()
    chain.push({ name: 'Tavily', run: () => searchTavilyHits(query, postJson, key) })
  }
  chain.push(
    { name: 'DuckDuckGo', run: () => searchDuckDuckGoHits(query, fetchText) },
    { name: '维基百科(中文)', run: () => searchWikipediaHits('zh', query, fetchText) },
    { name: '维基百科(英文)', run: () => searchWikipediaHits('en', query, fetchText) }
  )
  return chain
}

/**
 * 搜索器,按序兜底(2026-09-17 产品定序):Tavily(填了 Key 才启用)→ DuckDuckGo →
 * 维基中文 → 维基英文 —— 真搜索引擎优先(操作题、新鲜事、概念全能接),百科垫底
 * (维基的干净摘要只在前面全灭时兜)。全都失败/为空返回 []
 */
export async function webSearch(
  query: string,
  opts: WebSearchTransports = {}
): Promise<WebSearchHit[]> {
  for (const source of buildSourceChain(query, opts)) {
    try {
      const hits = await source.run()
      if (hits.length > 0) return hits
    } catch {
      // 断网/超时/限流/页面改版:这个源认输,换下一个
    }
  }
  return []
}
