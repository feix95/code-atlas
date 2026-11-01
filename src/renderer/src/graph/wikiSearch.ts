// 图谱搜索的纯逻辑:规范化查询词,按「标签 → 名称 → 简介 → 路径」的优先级给页排序。
// 只查当前语种的 Wiki 与程序名,不读 Markdown 正文,也不发请求。
import type { WikiPageSource, WikiPanelPage } from '@shared/wikiTypes'

/** 虚词:去掉后为空等于没搜(如「UI 相关」按 UI 查) */
export const SEARCH_FILLER_WORDS = ['相关', '有关', '部分', '模块', '的'] as const

/** 下拉一次最多列出的结果数 */
export const SEARCH_RESULTS_MAX = 12

export type SearchMatch = 'tag' | 'name' | 'summary' | 'path'

export interface WikiSearchHit {
  pageId: string
  kind: 'module' | 'group'
  name: string
  match: SearchMatch
  /** 命中的原文:标签、名称、简介或路径 */
  matched: string
  /** 页成员(含附挂文件),按路径去重 */
  files: string[]
}

/** 交给画布的高亮集合:命中页的成员文件与模块 id */
export interface SearchFocus {
  files: ReadonlySet<string>
  modules: ReadonlySet<string>
}

export interface WikiSearchPage {
  source: WikiPageSource
  /** 当前语种的记账页;没有记录为 null */
  page: WikiPanelPage | null
}

const FULL_WIDTH_MIN = 0xff01
const FULL_WIDTH_MAX = 0xff5e
const FULL_WIDTH_OFFSET = 0xfee0
const IDEOGRAPHIC_SPACE = 0x3000

const MATCH_RANK: Record<SearchMatch, number> = { tag: 0, name: 1, summary: 2, path: 3 }

function toHalfWidth(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= FULL_WIDTH_MIN && code <= FULL_WIDTH_MAX) {
      out += String.fromCharCode(code - FULL_WIDTH_OFFSET)
    } else if (code === IDEOGRAPHIC_SPACE) {
      out += ' '
    } else {
      out += ch
    }
  }
  return out
}

export function normalizeSearchText(text: string): string {
  let normalized = toHalfWidth(text).trim().toLowerCase()
  for (const word of SEARCH_FILLER_WORDS) normalized = normalized.split(word).join('')
  return normalized.trim()
}

function pageFiles(source: WikiPageSource): string[] {
  return [...new Set([...source.files.map((file) => file.path), ...source.attachedFiles])]
}

function displayNameOf(entry: WikiSearchPage): string {
  const page = entry.page
  if (page === null || page.status === 'none') return entry.source.name
  return page.name || entry.source.name
}

function matchOf(
  entry: WikiSearchPage,
  query: string
): Pick<WikiSearchHit, 'match' | 'matched'> | null {
  const page = entry.page
  if (page !== null && page.status !== 'none') {
    const tag = page.tags.find((item) => normalizeSearchText(item) === query)
    if (tag !== undefined) return { match: 'tag', matched: tag }
  }
  const name = displayNameOf(entry)
  if (normalizeSearchText(name).includes(query)) return { match: 'name', matched: name }
  if (page !== null && page.status !== 'none') {
    if (normalizeSearchText(page.summary).includes(query)) {
      return { match: 'summary', matched: page.summary }
    }
  }
  const file = pageFiles(entry.source).find((path) => normalizeSearchText(path).includes(query))
  return file === undefined ? null : { match: 'path', matched: file }
}

/**
 * 查询词已规范化;空串返回空数组。同一页按最高优先级的字段命中,
 * 命中档相同时文件多的排前面,再按名称。
 */
export function searchWikiPages(
  query: string,
  entries: readonly WikiSearchPage[]
): WikiSearchHit[] {
  if (query === '') return []
  const hits: WikiSearchHit[] = []
  for (const entry of entries) {
    const match = matchOf(entry, query)
    if (match === null) continue
    hits.push({
      pageId: entry.source.pageId,
      kind: entry.source.kind,
      name: displayNameOf(entry),
      match: match.match,
      matched: match.matched,
      files: pageFiles(entry.source)
    })
  }
  return hits.sort(
    (a, b) =>
      MATCH_RANK[a.match] - MATCH_RANK[b.match] ||
      b.files.length - a.files.length ||
      a.name.localeCompare(b.name)
  )
}

export function focusOfHits(hits: readonly WikiSearchHit[]): SearchFocus {
  const files = new Set<string>()
  const modules = new Set<string>()
  for (const hit of hits) {
    for (const file of hit.files) files.add(file)
    if (hit.kind === 'module') modules.add(hit.pageId)
  }
  return { files, modules }
}

/** 文件夹下命中的文件数;根目录用空串 */
export function countSearchFilesUnder(files: ReadonlySet<string>, folder: string): number {
  if (folder === '') return files.size
  const prefix = `${folder}/`
  let count = 0
  for (const file of files) if (file.startsWith(prefix)) count += 1
  return count
}

/** 定位到命中页时优先打开层级最浅的文件,同层按路径定序 */
export function pickLocateFile(files: readonly string[]): string | null {
  let best: string | null = null
  let bestDepth = Number.POSITIVE_INFINITY
  for (const file of files) {
    const depth = file.split('/').length
    if (depth < bestDepth || (depth === bestDepth && best !== null && file < best)) {
      best = file
      bestDepth = depth
    }
  }
  return best
}
