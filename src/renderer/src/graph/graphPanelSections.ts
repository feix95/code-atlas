// 节点详情显示哪些区块、按什么顺序显示:全局一档(localStorage,不按项目分),新区块默认显示、排在末尾。
// 只记「隐藏了哪些」与「排成什么顺序」,以后加区块不用迁旧数据;隐藏项写成一个 id 数组。
// 区块种类按内容形态各一张表:文件看引用与所属模块,文件夹看模块构成。
import { useSyncExternalStore } from 'react'
import type { LevelNode } from '../../../shared/graphView.ts'
import { readPref, writePref } from '../../../shared/localPrefs.ts'

export const GRAPH_PANEL_SECTIONS_KEY = 'atlas.graphPanelSections'
export const GRAPH_PANEL_ORDER_KEY = 'atlas.graphPanelSectionOrder'

export type GraphPanelSectionId =
  | 'refs'
  | 'module'
  | 'files'
  | 'tests'
  | 'styles'
  | 'dependsOn'
  | 'usedBy'
  | 'contents'
  | 'composition'

export interface GraphPanelSectionDef {
  id: GraphPanelSectionId
  label: string
  /** 菜单里的分区小标题:同一组画在一条小灰字下面 */
  group: string
}

const FILE_SECTIONS: readonly GraphPanelSectionDef[] = [
  { id: 'refs', label: '引用关系', group: '关系' },
  { id: 'dependsOn', label: '依赖的模块', group: '关系' },
  { id: 'usedBy', label: '被这些模块使用', group: '关系' },
  { id: 'module', label: '所属模块', group: '模块' },
  { id: 'files', label: '模块文件', group: '模块' },
  { id: 'tests', label: '相关自测', group: '模块' },
  { id: 'styles', label: '附挂样式', group: '模块' }
]

// 文件夹只有一档分组:菜单不画小标题,直接平铺两项
const FOLDER_SECTIONS: readonly GraphPanelSectionDef[] = [
  { id: 'contents', label: '文件夹内容', group: '构成' },
  { id: 'composition', label: '模块构成', group: '构成' }
]

export type GraphPanelKind = 'file' | 'folder'

/** 这类节点在「显示项」里有哪些区块(默认顺序) */
export function graphPanelSections(kind: GraphPanelKind): readonly GraphPanelSectionDef[] {
  return kind === 'file' ? FILE_SECTIONS : FOLDER_SECTIONS
}

/** 节点按哪种内容列区块;「收起的项」没有正文,返回 null */
export function graphPanelKindOf(node: LevelNode): GraphPanelKind | null {
  if (node.kind === 'file' || (node.kind === 'external' && node.target === 'file')) return 'file'
  if (node.kind === 'overflow') return null
  return 'folder'
}

/** 两种节点各自的区块顺序(拖过之后按用户的排法) */
export interface GraphPanelSectionOrders {
  readonly file: readonly GraphPanelSectionId[]
  readonly folder: readonly GraphPanelSectionId[]
}

const DEFAULT_ORDERS: GraphPanelSectionOrders = {
  file: FILE_SECTIONS.map((s) => s.id),
  folder: FOLDER_SECTIONS.map((s) => s.id)
}

const EMPTY_HIDDEN: ReadonlySet<GraphPanelSectionId> = new Set()
const ALL_IDS: ReadonlySet<string> = new Set(
  [...FILE_SECTIONS, ...FOLDER_SECTIONS].map((s) => s.id)
)

function isSectionId(v: unknown): v is GraphPanelSectionId {
  return typeof v === 'string' && ALL_IDS.has(v)
}

/** 本地账验身:非数组、未知 id 一律丢掉(旧版本留下的废 id 不会把新区块锁死) */
export function parseHiddenSections(raw: unknown): ReadonlySet<GraphPanelSectionId> {
  if (!Array.isArray(raw)) return EMPTY_HIDDEN
  const ids = raw.filter(isSectionId)
  return ids.length === 0 ? EMPTY_HIDDEN : new Set(ids)
}

let hidden = parseHiddenSections(readPref<unknown>(GRAPH_PANEL_SECTIONS_KEY, null))
const listeners = new Set<() => void>()

function apply(next: ReadonlySet<GraphPanelSectionId>): void {
  hidden = next
  listeners.forEach((fn) => fn())
}

if (typeof window !== 'undefined') {
  // 子窗是同一份 localStorage 的另一个 realm:删键/改账靠 storage 事件回流对齐
  window.addEventListener('storage', (e) => {
    if (e.key === GRAPH_PANEL_SECTIONS_KEY) {
      apply(parseHiddenSections(readPref<unknown>(GRAPH_PANEL_SECTIONS_KEY, null)))
    }
  })
}

export function getHiddenGraphPanelSections(): ReadonlySet<GraphPanelSectionId> {
  return hidden
}

export function subscribeGraphPanelSections(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 唯一写口:翻账 → 落盘 → 喊醒浮窗与停靠两副界面 */
export function setGraphPanelSectionVisible(id: GraphPanelSectionId, visible: boolean): void {
  if (visible === !hidden.has(id)) return
  const next = new Set(hidden)
  if (visible) next.delete(id)
  else next.add(id)
  apply(next)
  writePref(GRAPH_PANEL_SECTIONS_KEY, [...next])
}

/** 一键恢复全部区块(菜单里的「全部显示」) */
export function showAllGraphPanelSections(): void {
  if (hidden.size === 0) return
  apply(EMPTY_HIDDEN)
  writePref(GRAPH_PANEL_SECTIONS_KEY, [])
}

export function useHiddenGraphPanelSections(): ReadonlySet<GraphPanelSectionId> {
  return useSyncExternalStore(subscribeGraphPanelSections, getHiddenGraphPanelSections)
}

/** 本地账验身:认得的 id 去重保留,异类/未知 id 丢掉,缺的按默认顺序补齐(新区块永远有位置) */
function normalizeOrder(
  raw: unknown,
  fallback: readonly GraphPanelSectionId[]
): GraphPanelSectionId[] {
  const allowed = new Set<GraphPanelSectionId>(fallback)
  const seen = new Set<GraphPanelSectionId>()
  const order: GraphPanelSectionId[] = []
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== 'string' || !allowed.has(value as GraphPanelSectionId)) continue
      const id = value as GraphPanelSectionId
      if (seen.has(id)) continue
      seen.add(id)
      order.push(id)
    }
  }
  for (const id of fallback) if (!seen.has(id)) order.push(id)
  return order
}

export function parseSectionOrders(raw: unknown): GraphPanelSectionOrders {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    file: normalizeOrder(source.file, DEFAULT_ORDERS.file),
    folder: normalizeOrder(source.folder, DEFAULT_ORDERS.folder)
  }
}

/**
 * 可见项按菜单拖完的新顺序回填整单:菜单里没列出的项保持自己在整单里的槽位,
 * 可见子序列整体换成新顺序(不同节点可用性不同,不能拿某一节的可见清单覆盖整单)。
 */
export function mergeVisibleOrder(
  full: readonly GraphPanelSectionId[],
  visible: readonly GraphPanelSectionId[],
  nextVisible: readonly GraphPanelSectionId[]
): GraphPanelSectionId[] {
  const visibleSet = new Set(visible)
  let cursor = 0
  return full.map((id) => (visibleSet.has(id) ? (nextVisible[cursor++] ?? id) : id))
}

function sameOrder(a: readonly GraphPanelSectionId[], b: readonly GraphPanelSectionId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

let orders = parseSectionOrders(readPref<unknown>(GRAPH_PANEL_ORDER_KEY, null))
const orderListeners = new Set<() => void>()

function applyOrders(next: GraphPanelSectionOrders): void {
  orders = next
  orderListeners.forEach((fn) => fn())
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === GRAPH_PANEL_ORDER_KEY) {
      applyOrders(parseSectionOrders(readPref<unknown>(GRAPH_PANEL_ORDER_KEY, null)))
    }
  })
}

export function getGraphPanelSectionOrders(): GraphPanelSectionOrders {
  return orders
}

export function subscribeGraphPanelSectionOrders(fn: () => void): () => void {
  orderListeners.add(fn)
  return () => {
    orderListeners.delete(fn)
  }
}

/** 拖动排序的唯一写口:把这一节的可见新顺序并回整单 → 落盘 → 喊醒两副界面 */
export function setGraphPanelSectionOrder(
  kind: GraphPanelKind,
  visible: readonly GraphPanelSectionId[],
  nextVisible: readonly GraphPanelSectionId[]
): GraphPanelSectionOrders {
  const merged = mergeVisibleOrder(orders[kind], visible, nextVisible)
  if (sameOrder(merged, orders[kind])) return orders
  const next: GraphPanelSectionOrders = { ...orders, [kind]: merged }
  applyOrders(next)
  writePref(GRAPH_PANEL_ORDER_KEY, next)
  return next
}

export function useGraphPanelSectionOrders(): GraphPanelSectionOrders {
  return useSyncExternalStore(subscribeGraphPanelSectionOrders, getGraphPanelSectionOrders)
}

/** 默认表按记下的顺序重排;两边 id 集合一致,不怕旧账缺项(解析时已补齐) */
export function orderGraphPanelSections(
  kind: GraphPanelKind,
  orders: GraphPanelSectionOrders
): readonly GraphPanelSectionDef[] {
  const rank = new Map(orders[kind].map((id, index) => [id, index]))
  return [...graphPanelSections(kind)].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
}
