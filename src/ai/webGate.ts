// 联网件的三道闸与正文剥壳:搜索词安检、内网闸、HTML 转文本。全是纯函数(自测可测)。

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

/**
 * 内网闸(纯函数,自测覆盖):只放行公网 http(s) 地址 —— localhost、内网 IPv4 段、
 * 本地链路地址、常见内网域名后缀一律拒收。抓正文前过这道门,别让模型被网页
 * 诱导着去探测用户机器的内网。注意它只认地址字面量:域名(哪怕解析进内网)放行 ——
 * 就算真被引到内网,抓回来的也只是「给模型看的资料」而非可执行的东西,危害封顶。
 */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  if (
    host === '' ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    return false
  // IPv6 字面量:WHATWG URL 的 hostname 保留方括号([::1]),剥掉再认;只放行全球单播的开头,环回/内网/链路本地全拒
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (bare.includes(':'))
    return !(
      bare === '::1' ||
      bare.startsWith('fc') ||
      bare.startsWith('fd') ||
      bare.startsWith('fe80')
    )
  const seg = bare.split('.').map((p) => Number.parseInt(p, 10))
  if (seg.length === 4 && seg.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const a = seg[0] ?? -1
    const b = seg[1] ?? -1
    const private4 =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    if (private4) return false
  }
  return true
}

/**
 * 搜索词安检(纯函数,自测覆盖):模型递来的 query 只收「给人搜东西用的短词」。
 * 换行压成空格;空词、超长(>200 字)、盘符、反斜杠、以斜杠开头的一律拒收(null)——
 * 本地路径、代码这类私密信息绝不发往网上,这是 web_search 的隐私红线。
 */
export function sanitizeWebQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const q = raw.replaceAll(/\s+/g, ' ').trim()
  if (q === '' || q.length > 200) return null
  if (/[a-zA-Z]:[\\/]/.test(q) || q.includes('\\') || q.startsWith('/')) return null
  return q
}

/** HTML 转可读正文:剥掉 script/style/head 整块,再交给 stripHtmlTags 剥标签和实体、压平空白 */
export function htmlToText(html: string): string {
  const noBlocks = html.replace(/<(script|style|noscript|head)\b[\s\S]*?<\/\1>/gi, ' ')
  return stripHtmlTags(noBlocks)
}

/** web_search 抓正文的家数与每家字数:摘要清单为主(优先看标题),正文只抓第一条垫底 —— 上下文偏小,别让大段网页正文挤掉有效资料 */
export const WEB_SEARCH_PAGE_COUNT = 1
export const WEB_PAGE_TEXT_MAX_CHARS = 700

/** web_fetch 单页正文上限:够看 README 关键段,又不把对话锅撑满 */
export const WEB_FETCH_MAX_CHARS = 6000

/** 单页响应体积上限:5MB,超了直接放弃 —— 别让一个巨型页面把主进程内存撑爆 */
export const WEB_FETCH_MAX_BYTES = 5 * 1024 * 1024
export const WEB_FETCH_URL_MAX_CHARS = 2000

/**
 * GitHub 文件页改成 raw 原文:blob 页是仓库外壳,模型要看的是 README/源码本身。
 * 对不上这个形状就原样返回,让后面的内网闸决定放不放行。
 */
export function rewriteGithubBlobUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return raw
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'github.com') return raw
  const parts = parsed.pathname.split('/').filter((p) => p !== '')
  if (parts.length < 5 || parts[2] !== 'blob') return raw
  const owner = parts[0] ?? ''
  const repo = parts[1] ?? ''
  const ref = parts[3] ?? ''
  const path = parts.slice(4).join('/')
  if (owner === '' || repo === '' || ref === '' || path === '') return raw
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`
}

/** web_fetch 的地址安检:只收公网 http(s),GitHub blob 先改成 raw,超长拒收。 */
export function sanitizeWebFetchUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > WEB_FETCH_URL_MAX_CHARS) return null
  const rewritten = rewriteGithubBlobUrl(trimmed)
  return isPublicHttpUrl(rewritten) ? rewritten : null
}

/** 单条摘要的字数上限:8 条结果各留一截,把版面留给「有哪些来源」而不是一家独占 */
export const WEB_HIT_SNIPPET_MAX_CHARS = 600
