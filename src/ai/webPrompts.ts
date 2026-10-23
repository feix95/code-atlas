// 联网查证的问题端:挑搜索词、命中对账、把程序真做过的动作收敛成状态表 ——
// 全是纯函数,不发请求。
import type { ChatContextAttachment, WebLookupMeta } from '../shared/types.ts'

const WEB_INTENT_SRC = '联网|搜索|搜搜|搜一下|查查|查一下|上网|网上|百度|谷歌|帮我|search'
const WEB_FILLER_SRC = '你能去|他们|应该有|开源仓库|是怎么做的吗|是怎么做的|怎么做的|去看看|看看'
const WEB_PUNCT_SRC = '[\\s,。？?！!，、；;：:·""\'\'“”‘’（）()]+'
const LATIN_TOKEN_SRC = '[A-Za-z][A-Za-z0-9._+-]*'

/** 中英文粘在一起时切开,避免「搜搜opencode他们」变成一个词 */
function splitLatinAndCjk(text: string): string {
  return text
    .replace(/([A-Za-z0-9.+_-])([\u4e00-\u9fff])/g, '$1 $2')
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9.+_-])/g, '$1 $2')
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokens) {
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
  }
  return out
}

function emptyQueries(): string[] {
  return []
}

function withQueries(meta: Omit<WebLookupMeta, 'queries'>, queries: string[] = []): WebLookupMeta {
  return { ...meta, queries }
}

/**
 * 从口语问题里抽出能拿去搜的短词:英文专名、仓库名;提到 GitHub 就补上 github。
 * 抽不出时回空数组,调用方再走附件名或削完套话的中文残留。
 */
export function extractWebQueryTokens(question: string): string[] {
  const split = splitLatinAndCjk(question)
  const wantGithub = /github/i.test(question)
  const cleaned = split
    .replace(new RegExp(WEB_INTENT_SRC, 'gi'), ' ')
    .replace(new RegExp(WEB_FILLER_SRC, 'g'), ' ')
    .replace(new RegExp(WEB_PUNCT_SRC, 'g'), ' ')
  const tokens = uniqueTokens(
    (cleaned.match(new RegExp(LATIN_TOKEN_SRC, 'g')) ?? []).filter((t) => t.length >= 2)
  )
  if (wantGithub && !tokens.some((t) => t.toLowerCase() === 'github')) tokens.push('github')
  return tokens
}

/** 口语整句收成更短的搜索词;已经是短词或抽不出时回空串,调用方不要拿去重搜。 */
export function shortenWebQuery(query: string): string {
  const short = extractWebQueryTokens(query).join(' ').trim().slice(0, 60)
  if (short === '' || short.toLowerCase() === query.trim().toLowerCase()) return ''
  return short
}

/** 命中标题/摘要里有没有查询里的英文专名;没有专名时有结果就算对得上。 */
export function hitsMatchWebQuery(
  query: string,
  hits: ReadonlyArray<{ title: string; snippet: string }>
): boolean {
  const keys = extractWebQueryTokens(query)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3)
  if (keys.length === 0) return hits.length > 0
  const hay = hits.map((h) => `${h.title} ${h.snippet}`.toLowerCase()).join('\n')
  return keys.some((key) => hay.includes(key))
}

/**
 * 第一轮结果对不上专名时,换更短的词再搜;已经对得上或抽不出更短词就回 null。
 */
export function pickRetryQuery(
  query: string,
  hits: ReadonlyArray<{ title: string; snippet: string }>
): string | null {
  if (hitsMatchWebQuery(query, hits)) return null
  const short = shortenWebQuery(query)
  return short === '' ? null : short
}

/** 普通对话才由程序预搜;翻文件开着时交给 web_search,避免把结果贴进用户消息。 */
export function shouldPreSearchWeb(
  requested: boolean,
  enabled: boolean,
  agentOn: boolean
): boolean {
  return requested && enabled && !agentOn
}

/**
 * 联网查询用哪个词去查:问题里能抽出英文专名就用短词;
 * 抽不出时再拿选中对象的名字;再没有就剥掉意图词剩中文主体(封顶 60 字)。
 */
export function pickWebLookupQuery(
  question: string,
  attachment: ChatContextAttachment | null
): string {
  const tokens = extractWebQueryTokens(question)
  if (tokens.length > 0) return tokens.join(' ').slice(0, 60)
  const name = attachment && attachment.targetType !== 'none' ? attachment.name.trim() : ''
  if (name) return name
  return splitLatinAndCjk(question)
    .replace(new RegExp(WEB_INTENT_SRC, 'gi'), ' ')
    .replace(new RegExp(WEB_FILLER_SRC, 'g'), ' ')
    .replace(new RegExp(WEB_PUNCT_SRC, 'g'), ' ')
    .trim()
    .slice(0, 60)
    .trim()
}

/**
 * 把程序真实执行过的联网动作收敛成状态状态表:
 * material = 空串表示查完了但没有可用资料;有内容才是 completed。
 * 模型的自述不参与记账。
 */
export function resolveWebLookupMeta(
  requested: boolean,
  enabled: boolean,
  outcome:
    | { kind: 'skipped' }
    | { kind: 'attempted'; material: string; sources: string[]; queries?: string[] }
    | { kind: 'error' }
): WebLookupMeta {
  if (!requested)
    return withQueries(
      { requested: false, enabled, attempted: false, state: 'not_requested', sources: [] },
      emptyQueries()
    )
  if (!enabled)
    return withQueries(
      { requested: true, enabled: false, attempted: false, state: 'disabled', sources: [] },
      emptyQueries()
    )
  if (outcome.kind === 'skipped')
    return withQueries(
      { requested: true, enabled: true, attempted: false, state: 'failed', sources: [] },
      emptyQueries()
    )
  if (outcome.kind === 'error')
    return withQueries(
      { requested: true, enabled: true, attempted: true, state: 'failed', sources: [] },
      emptyQueries()
    )
  const queries = outcome.queries ?? emptyQueries()
  if (outcome.material === '')
    return withQueries(
      { requested: true, enabled: true, attempted: true, state: 'empty', sources: [] },
      queries
    )
  return withQueries(
    {
      requested: true,
      enabled: true,
      attempted: true,
      state: 'completed',
      sources: outcome.sources
    },
    queries
  )
}

/** 翻文件收工时,用本场真正搜过的词和来源覆盖预搜账(预搜在翻文件时不会跑)。 */
export function finalizeAgentWebLookup(
  base: WebLookupMeta,
  queries: string[],
  sources: string[]
): WebLookupMeta {
  const uniqQueries = uniqueTokens(queries.map((q) => q.trim()).filter((q) => q !== ''))
  if (uniqQueries.length === 0) {
    if (base.requested && base.enabled) {
      return withQueries(
        { requested: true, enabled: true, attempted: false, state: 'empty', sources: [] },
        emptyQueries()
      )
    }
    return withQueries(base, base.queries ?? emptyQueries())
  }
  const uniqSources = uniqueTokens(sources.filter((s) => s !== ''))
  return withQueries(
    {
      requested: true,
      enabled: true,
      attempted: true,
      state: uniqSources.length > 0 ? 'completed' : 'empty',
      sources: uniqSources
    },
    uniqQueries
  )
}

/**
 * 追问里有没有点名叫联网/搜索:这类词命中且开关开着,才把联网资料塞进这一轮。
 * 词表放得宽(搜搜/查一下/网上都算),误触发顶多多查一次,不伤功能。
 */
export function hasSearchIntent(question: string): boolean {
  return /联网|搜索|搜搜|搜一下|查查|查一下|上网|网上|百度|谷歌|search|github/i.test(question)
}
