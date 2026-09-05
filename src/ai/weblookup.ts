// 联网查证(可选,默认关):讲解认不出某个软件/品牌时,拿「名字」去免费公开源查资料。
// 只在主进程用 —— 渲染进程不许直接发网络请求,这是本项目的铁律。
// 源(按序兜底):中文维基 → 英文维基(免 Key、结构化摘要)→ DuckDuckGo 免注册 HTML
// 搜索入口(非官方稳定承诺,页面结构可能变、可能限流,"能跑就先用着"的务实方案)。
// 都查不到就返回空串,调用方回退本地推测,绝不报错炸掉。
// 隐私边界:调用方只许传文件夹/文件的名字,绝不传完整本地路径。

/** 单个源的耐心:5 秒,超时就当没查到 —— 联网是锦上添花,不能拖慢讲解 */
export const WEB_LOOKUP_TIMEOUT_MS = 5_000

/** 取网页正文用的传输层:主进程默认给 Chromium 的 net.fetch(自动跟随系统代理) */
export type LookupTransport = (url: string) => Promise<string>

/** 查一次联网的完整战果:资料正文 + 命中了哪个来源(给界面的状态标签记账用) */
export interface WebLookupOutcome {
  material: string
  sources: string[]
}

/**
 * 查询链,按序兜底:中文维基 → 英文维基 → DuckDuckGo 免注册 HTML。
 * 每个源带名字,查到哪个就记哪个,界面上"已联网查询:×××"说的就是它。
 */
const LOOKUP_SOURCES: Array<{ name: string; run: (query: string, fetchText: LookupTransport) => Promise<string> }> = [
  { name: '维基百科(中文)', run: (q, f) => lookupWikipediaLang('zh', q, f) },
  { name: '维基百科(英文)', run: (q, f) => lookupWikipediaLang('en', q, f) },
  { name: 'DuckDuckGo', run: lookupDuckDuckGoHtml }
]

/** 查询结果在内存里按名字缓存:同一个名字这场会话只查一次,不反复耗流量 */
const lookupCache = new Map<string, WebLookupOutcome>()

/** 剥掉摘要里的 HTML 标记和常见实体(维基摘要自带 <span> 这类,DDG 摘要自带 <b>) */
export function stripHtmlTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
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

/** 维基百科条目搜索(单语言):标题 + 纯文本摘要,最多 3 条 */
async function lookupWikipediaLang(lang: string, query: string, fetchText: LookupTransport): Promise<string> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=3` +
    `&srsearch=${encodeURIComponent(query)}`
  const data = JSON.parse(await fetchText(url)) as { query?: { search?: Array<{ title?: string; snippet?: string }> } }
  const hits = data.query?.search ?? []
  const lines = hits
    .map((h) => (h.title ? `${h.title}${h.snippet ? ` —— ${stripHtmlTags(h.snippet)}` : ''}` : ''))
    .filter((line) => line.trim() !== '')
  return lines.length > 0 ? `来自维基百科(${lang})的条目摘要:\n${lines.map((l) => `- ${l}`).join('\n')}` : ''
}

/**
 * DuckDuckGo 免注册 HTML 搜索入口:抓自然结果的标题 + 摘要(广告位的链接带
 * ad_domain 标记,认出来直接跳过,不给模型喂广告)。
 */
async function lookupDuckDuckGoHtml(query: string, fetchText: LookupTransport): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const html = await fetchText(url)
  const anchors = [...html.matchAll(/<a\s+[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/g)]
  const snippets = [...html.matchAll(/<a\s+[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
  const lines: string[] = []
  for (let i = 0; i < anchors.length && lines.length < 4; i++) {
    // 锚点整段里带 ad_domain = 广告位,跳过
    if (anchors[i]?.[0].includes('ad_domain=')) continue
    const title = stripHtmlTags(anchors[i]?.[1] ?? '')
    if (!title) continue
    const snippet = stripHtmlTags(snippets[i]?.[1] ?? '')
    lines.push(snippet ? `${title} —— ${snippet}` : title)
  }
  return lines.length > 0 ? `来自 DuckDuckGo 搜索的结果:\n${lines.map((l) => `- ${l}`).join('\n')}` : ''
}

/**
 * 按名字查公开资料,并把战果记账:资料正文 + 命中的来源名。
 * 维基(中→英)→ DuckDuckGo HTML,全都失败/为空时 material 为空串、来源为空(绝不抛错)。
 * 成功结果按名字缓存;失败不缓存,下次还会再试。
 * fetchText 可注入:主进程传跟随系统代理的 net.fetch 版本,测试可传别的。
 */
export async function webLookupDetailed(query: string, fetchText: LookupTransport = nodeFetchText): Promise<WebLookupOutcome> {
  const key = query.trim()
  if (!key) return { material: '', sources: [] }
  const cached = lookupCache.get(key)
  if (cached) return cached
  let outcome: WebLookupOutcome = { material: '', sources: [] }
  for (const source of LOOKUP_SOURCES) {
    try {
      const material = await source.run(key, fetchText)
      if (material) {
        outcome = { material, sources: [source.name] }
        break
      }
    } catch {
      // 断网/超时/限流/页面改版:这个源认输,换下一个
    }
  }
  if (outcome.material) lookupCache.set(key, outcome)
  return outcome
}

/** 只要资料正文的老入口(讲解信号修正流用):要来源记账时用 webLookupDetailed */
export async function webLookup(query: string, fetchText: LookupTransport = nodeFetchText): Promise<string> {
  return (await webLookupDetailed(query, fetchText)).material
}
