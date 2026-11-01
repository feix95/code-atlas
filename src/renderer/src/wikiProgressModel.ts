// Wiki 进度页的纯数据层:按图谱装配待生成页清单、把记账与实时事件合成行状态。
// 不碰 DOM 也不碰 IPC,组件只负责画,hook 只负责取数。
import type { DepGraphResult, ModuleInfo, ScanResult } from '../../shared/types'
import type { WikiLanguageSummary, WikiPageProgress, WikiPageSource } from '../../shared/wikiTypes'
import { groupScatteredFiles } from '../../shared/wikiGroups.ts'
import { collectRelPaths } from './scanTreeTools.ts'
import { moduleDisplayName } from './graph/moduleOverlay.ts'

const EMPTY_PAGES: WikiPageSource[] = []

type NodeFacts = Map<string, DepGraphResult['nodes'][number]>

function fileSource(path: string, nodes: NodeFacts): WikiPageSource['files'][number] {
  const node = nodes.get(path)
  return node === undefined
    ? { path }
    : { path, language: node.languageId, inCount: node.inCount, outCount: node.outCount }
}

function modulePage(
  module: ModuleInfo,
  graph: DepGraphResult,
  nodes: NodeFacts,
  displayNameOf: (id: string) => string | null
): WikiPageSource {
  const links = graph.modules?.links ?? []
  return {
    pageId: module.id,
    kind: 'module',
    name: moduleDisplayName(module),
    files: module.files.map((path) => fileSource(path, nodes)),
    attachedFiles: module.attached,
    folders: module.folders,
    dependsOn: links
      .filter((link) => link.from === module.id)
      .map((link) => ({ moduleId: link.to, name: displayNameOf(link.to), weight: link.weight })),
    usedBy: links
      .filter((link) => link.to === module.id)
      .map((link) => ({ moduleId: link.from, name: displayNameOf(link.from), weight: link.weight }))
  }
}

function groupPages(files: readonly string[], nodes: NodeFacts): WikiPageSource[] {
  return groupScatteredFiles(files).map((group) => ({
    pageId: group.id,
    kind: 'group' as const,
    name: group.name,
    files: group.files.map((path) => fileSource(path, nodes)),
    attachedFiles: [],
    folders: [
      ...new Set(group.files.map((file) => file.slice(0, Math.max(file.lastIndexOf('/'), 0))))
    ],
    dependsOn: [],
    usedBy: []
  }))
}

/**
 * 待生成的页清单:模块按图谱既定的「文件数降序、id 升序」排在前面,
 * 散件组固定四类排在最后 —— 与生成顺序一致,进度表不会跳着走。
 * 图谱还没算出来时返回空清单,由调用方先拉关系分析。
 */
export function assembleWikiPages(
  result: ScanResult | null,
  graph: DepGraphResult | null
): WikiPageSource[] {
  if (result === null || graph === null) return EMPTY_PAGES
  const modules = graph.modules?.modules ?? []
  const byId = new Map(modules.map((module) => [module.id, module]))
  const nodes: NodeFacts = new Map(graph.nodes.map((node) => [node.relPath, node]))
  const displayNameOf = (id: string): string | null => {
    const module = byId.get(id)
    return module ? moduleDisplayName(module) : null
  }
  const files = collectRelPaths(result.tree)
  const scattered = files.filter((file) => graph.modules?.fileToModule[file] === undefined)
  return [
    ...modules.map((module) => modulePage(module, graph, nodes, displayNameOf)),
    ...groupPages(scattered, nodes)
  ]
}

export type WikiRowStatus =
  'pending' | 'queued' | 'running' | 'done' | 'stale' | 'missing' | 'failed' | 'cancelled'

export interface WikiProgressRow {
  pageId: string
  kind: 'module' | 'group'
  /** 记账里有 AI 名称就用它,否则回退程序名 */
  name: string
  status: WikiRowStatus
  /** 本轮直接命中缓存、没有重新请求 */
  cached: boolean
  file: string | null
  generatedAt: string | null
  model: string | null
  error: string | null
  truncated: boolean
}

const ROW_ORDER: Record<WikiRowStatus, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  cancelled: 3,
  stale: 4,
  missing: 5,
  pending: 6,
  done: 7
}

function statusOfEvent(event: WikiPageProgress): WikiRowStatus {
  if (event.status === 'skipped') return 'done'
  return event.status
}

function rowFromEvent(pageId: string, event: WikiPageProgress): WikiProgressRow {
  const status = statusOfEvent(event)
  return {
    pageId,
    kind: event.kind,
    name: event.name,
    status,
    cached: event.status === 'skipped',
    file: event.file ?? null,
    generatedAt: null,
    model: null,
    error: event.error ?? null,
    truncated: false
  }
}

/**
 * 记账快照 + 本轮实时事件 → 表行。事件优先(本轮刚发生的事实),
 * 没有事件的页看记账;两边都没有的是还没生成。
 * 记账里有、但当前图谱已经切不出对应模块的旧页也保留 —— 用户要看得见它们才能决定重生成或清理。
 */
export function mergeWikiRows(
  pages: readonly WikiPageSource[],
  language: WikiLanguageSummary | null,
  events: Readonly<Record<string, WikiPageProgress>>
): WikiProgressRow[] {
  const records = new Map((language?.pages ?? []).map((page) => [page.pageId, page]))
  const rows: WikiProgressRow[] = []
  const seen = new Set<string>()
  for (const page of pages) {
    seen.add(page.pageId)
    const event = events[page.pageId]
    const record = records.get(page.pageId)
    if (event) {
      rows.push({ ...rowFromEvent(page.pageId, event), name: record?.name || event.name })
      continue
    }
    if (record) {
      rows.push({
        pageId: page.pageId,
        kind: record.kind,
        name: record.name || page.name,
        status: record.status,
        cached: false,
        file: record.file,
        generatedAt: record.generatedAt,
        model: record.model,
        error: null,
        truncated: record.truncated
      })
      continue
    }
    rows.push({
      pageId: page.pageId,
      kind: page.kind,
      name: page.name,
      status: 'pending',
      cached: false,
      file: null,
      generatedAt: null,
      model: null,
      error: null,
      truncated: false
    })
  }
  for (const record of language?.pages ?? []) {
    if (seen.has(record.pageId)) continue
    rows.push({
      pageId: record.pageId,
      kind: record.kind,
      name: record.name,
      status: record.status,
      cached: false,
      file: record.file,
      generatedAt: record.generatedAt,
      model: record.model,
      error: null,
      truncated: record.truncated
    })
  }
  // 稳定排序:异常的、在跑的排前面,已完成沉底;同档保持装配顺序
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => ROW_ORDER[a.row.status] - ROW_ORDER[b.row.status] || a.index - b.index)
    .map(({ row }) => row)
}

/** 进度事件的登记键:同一项目可以先后生成多种语言,两边进度不许串 */
export function wikiEventKey(language: string, pageId: string): string {
  return `${language}\u0000${pageId}`
}

/** 取出某个语种的实时事件,键还原成页 id 交给 mergeWikiRows */
export function eventsForLanguage(
  events: Readonly<Record<string, WikiPageProgress>>,
  language: string
): Record<string, WikiPageProgress> {
  const prefix = `${language}\u0000`
  const out: Record<string, WikiPageProgress> = {}
  for (const [key, event] of Object.entries(events)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = event
  }
  return out
}

export interface WikiRowCounts {
  total: number
  done: number
  cached: number
  stale: number
  missing: number
  failed: number
  cancelled: number
  pending: number
  running: number
}

export function countWikiRows(rows: readonly WikiProgressRow[]): WikiRowCounts {
  const counts: WikiRowCounts = {
    total: rows.length,
    done: 0,
    cached: 0,
    stale: 0,
    missing: 0,
    failed: 0,
    cancelled: 0,
    pending: 0,
    running: 0
  }
  for (const row of rows) {
    if (row.cached) counts.cached += 1
    switch (row.status) {
      case 'done':
        counts.done += 1
        break
      case 'stale':
        counts.stale += 1
        break
      case 'missing':
        counts.missing += 1
        break
      case 'failed':
        counts.failed += 1
        break
      case 'cancelled':
        counts.cancelled += 1
        break
      case 'running':
        counts.running += 1
        break
      default:
        counts.pending += 1
    }
  }
  return counts
}

/** 重试清单:失败与中途取消的页都算没写完;过期与文件缺失的页走「重新生成」 */
export function retryPageIds(rows: readonly WikiProgressRow[]): string[] {
  return rows
    .filter((row) => row.status === 'failed' || row.status === 'cancelled')
    .map((row) => row.pageId)
}

export function regeneratePageIds(rows: readonly WikiProgressRow[]): string[] {
  return rows
    .filter((row) => row.status === 'stale' || row.status === 'missing')
    .map((row) => row.pageId)
}

export interface WikiRunPlan {
  total: number
  /** 已生成且文件还在的篇目:开跑后会按内容哈希跳过 */
  cached: number
  /** 需要真正请求模型的篇目 */
  toGenerate: number
}

/** 生成确认弹窗的口径:记账里完成的算缓存,其余(未生成/过期/缺失/失败/取消)都要重跑 */
export function planWikiRows(rows: readonly WikiProgressRow[]): WikiRunPlan {
  const cached = rows.filter((row) => row.status === 'done').length
  return { total: rows.length, cached, toGenerate: rows.length - cached }
}

export function pickWikiPage(
  pages: readonly WikiPageSource[],
  ids: readonly string[]
): WikiPageSource[] {
  const wanted = new Set(ids)
  return pages.filter((page) => wanted.has(page.pageId))
}
