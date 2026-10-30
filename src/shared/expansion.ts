// 展开集合与可见图之间的纯逻辑:候选挑选、逐个试展开、超限收回、级联收起、lazy 目录先扫描。
// React 状态在 useGraphExpansion;这里不碰 DOM,便于自测。
import type { DepEdge, ScanDirNode } from './types.ts'
import type { GroupTree } from './hierarchy.ts'
import {
  GRAPH_LEVEL_MAX_NODES,
  buildVisibleGraph,
  isVisibleGraphRejection,
  type VisibleGraphRejection,
  type VisibleNode
} from './visibleGraph.ts'

export type ExpansionRejection = VisibleGraphRejection['reason']

export type ExpandOutcome =
  | { kind: 'expanded'; ids: ReadonlySet<string> }
  | { kind: 'rejected'; reason: ExpansionRejection }
  | { kind: 'ignored' }
  | { kind: 'scanFailed' }

export interface BatchExpandResult {
  ids: ReadonlySet<string>
  rejected: ExpansionRejection | null
}

/** 单个文件夹试展开:能放下返回新集合;放不下返回原因;不是可展开的文件夹返回 ignored */
export function tryExpand(
  tree: GroupTree,
  edges: readonly DepEdge[],
  focus: string,
  expanded: ReadonlySet<string>,
  id: string,
  maxNodes: number = GRAPH_LEVEL_MAX_NODES
): ExpandOutcome {
  if (expanded.has(id) || !tree.has(id) || tree.kindOf(id) !== 'folder') return { kind: 'ignored' }
  const next = new Set(expanded).add(id)
  const graph = buildVisibleGraph(tree, edges, focus, next, maxNodes)
  if (graph === null) return { kind: 'ignored' }
  return isVisibleGraphRejection(graph)
    ? { kind: 'rejected', reason: graph.reason }
    : { kind: 'expanded', ids: next }
}

/** 按顺序逐个试展开,放不下的跳过并记下原因;尽量多展开而不是一批全拒 */
export function expandIds(
  tree: GroupTree,
  edges: readonly DepEdge[],
  focus: string,
  expanded: ReadonlySet<string>,
  ids: readonly string[],
  maxNodes: number = GRAPH_LEVEL_MAX_NODES
): BatchExpandResult {
  let current = expanded
  let rejected: ExpansionRejection | null = null
  for (const id of ids) {
    const outcome = tryExpand(tree, edges, focus, current, id, maxNodes)
    if (outcome.kind === 'expanded') current = outcome.ids
    else if (outcome.kind === 'rejected') rejected = outcome.reason
  }
  return { ids: current, rejected }
}

/** lazy 目录先扫描再展开;扫描失败不展开。扫描成功时树的新数据要等下一次渲染才到 */
export async function expandFolder(
  tree: GroupTree,
  edges: readonly DepEdge[],
  focus: string,
  expanded: ReadonlySet<string>,
  id: string,
  expandLazy: (relPath: string) => Promise<ScanDirNode | null>,
  maxNodes: number = GRAPH_LEVEL_MAX_NODES
): Promise<ExpandOutcome> {
  if (expanded.has(id) || !tree.has(id) || tree.kindOf(id) !== 'folder') return { kind: 'ignored' }
  if (tree.isLazy(id)) {
    const scanned = await expandLazy(id)
    if (!scanned) return { kind: 'scanFailed' }
  }
  return tryExpand(tree, edges, focus, expanded, id, maxNodes)
}

/** 收起某文件夹时连带收掉它内部的所有展开,重新展开不会突然冒出深层容器 */
export function collapseSubtree(
  tree: GroupTree,
  expanded: ReadonlySet<string>,
  id: string
): ReadonlySet<string> {
  const next = new Set<string>()
  for (const candidate of expanded) {
    let current: string | null = candidate
    let inside = false
    while (current !== null) {
      if (current === id) {
        inside = true
        break
      }
      current = tree.parentOf(current)
    }
    if (!inside) next.add(candidate)
  }
  return next
}

/** 「展开两级」的本轮候选:可见、未展开、浅于自动展开深度的文件夹;未扫描的跳过 */
export function expandCandidates(
  nodes: readonly VisibleNode[],
  expanded: ReadonlySet<string>,
  maxDepth: number
): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (node.kind !== 'folder' || node.isContainer || node.lazy) continue
    if (node.depth >= maxDepth || expanded.has(node.id)) continue
    ids.push(node.id)
  }
  return ids
}

/**
 * 树或引用数据更新后,当前展开集合可能超限:从最新展开的开始收回,直到放得下。
 * rejected 只在真的收回时给出原始超限原因,供界面提示。
 */
export function trimExpansion(
  tree: GroupTree,
  edges: readonly DepEdge[],
  focus: string,
  expanded: ReadonlySet<string>,
  maxNodes: number = GRAPH_LEVEL_MAX_NODES
): BatchExpandResult {
  const reasonOf = (ids: ReadonlySet<string>): ExpansionRejection | null => {
    const graph = buildVisibleGraph(tree, edges, focus, ids, maxNodes)
    return graph !== null && isVisibleGraphRejection(graph) ? graph.reason : null
  }
  const original = reasonOf(expanded)
  if (original === null) return { ids: expanded, rejected: null }
  let current = expanded
  for (const id of [...expanded].reverse()) {
    const next = new Set(current)
    next.delete(id)
    current = next
    if (reasonOf(current) === null) return { ids: current, rejected: original }
  }
  return { ids: current, rejected: null }
}
