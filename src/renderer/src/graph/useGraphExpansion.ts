// 图谱的展开状态:持有展开集合,组合 shared/expansion 的纯逻辑。
// 焦点切换由层级访问序号(visit)判定,旧层级的集合直接作废;换层后的第一次展开必须写入状态,
// 所以用 visitRef 判定迟到结果,而不是拿可能与序号脱节的状态做比较。
// lazy 文件夹先按需扫描;可见图超限时自动收回最近的展开并给出状态。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DepEdge, ScanDirNode } from '@shared/types'
import type { GroupTree } from '@shared/hierarchy'
import {
  GRAPH_LEVEL_MAX_NODES,
  buildVisibleGraph,
  isVisibleGraphRejection,
  type VisibleGraph
} from '@shared/visibleGraph'
import {
  collapseSubtree,
  expandCandidates,
  expandFolder,
  expandIds,
  trimExpansion,
  type ExpansionRejection
} from '@shared/expansion'
import { GRAPH_ZOOM } from './graphConfig.ts'
import { zoomDecisions, type ZoomNode } from './semanticZoom.ts'

export type ExpansionNotice =
  { kind: 'rejected'; reason: ExpansionRejection } | { kind: 'scanFailed' }

export interface GraphExpansion {
  /** 当前展开集合下的可见图;焦点不存在时为 null */
  level: VisibleGraph | null
  /** 实际生效的展开集合(已去掉超限时收回的部分) */
  expanded: ReadonlySet<string>
  /** 正在按需扫描的文件夹 id */
  scanningId: string | null
  notice: ExpansionNotice | null
  /** 「展开两级」当前有可展开的文件夹 */
  canExpandAll: boolean
  /** 有已展开的文件夹可以收起 */
  canCollapseAll: boolean
  toggle: (id: string) => void
  /** 「展开两级」:把当前可见、浅于自动展开深度的文件夹一次展开 */
  expandAll: () => void
  collapseAll: () => void
  applyZoom: (nodes: readonly ZoomNode[], scale: number) => void
}

interface ExpansionState {
  visit: number
  ids: ReadonlySet<string>
}

interface ExpansionDeps {
  /** useGraphNav 的层级访问序号:每次换焦点加一 */
  visit: number
  dirRel: string
  tree: GroupTree | null
  edges: readonly DepEdge[]
  expandLazy: (relPath: string) => Promise<ScanDirNode | null>
}

const NONE: ReadonlySet<string> = new Set()

export function useGraphExpansion({
  visit,
  dirRel,
  tree,
  edges,
  expandLazy
}: ExpansionDeps): GraphExpansion {
  const [state, setState] = useState<ExpansionState>({ visit, ids: NONE })
  const [scanning, setScanning] = useState<{ visit: number; id: string } | null>(null)
  const [localNotice, setLocalNotice] = useState<{
    visit: number
    notice: ExpansionNotice
  } | null>(null)

  const active = state.visit === visit ? state.ids : NONE
  const scanningId = scanning?.visit === visit ? scanning.id : null
  const local = localNotice?.visit === visit ? localNotice.notice : null

  // 树或数据更新后可能超限:渲染就用收回后的集合,状态只在下一次操作时跟上
  const resolved = useMemo(() => {
    if (!tree) return { level: null, ids: active, rejection: null as ExpansionRejection | null }
    const graph = buildVisibleGraph(tree, edges, dirRel, active, GRAPH_LEVEL_MAX_NODES)
    if (graph === null) return { level: null, ids: active, rejection: null }
    if (!isVisibleGraphRejection(graph)) return { level: graph, ids: active, rejection: null }
    const trimmed = trimExpansion(tree, edges, dirRel, active, GRAPH_LEVEL_MAX_NODES)
    const next = buildVisibleGraph(tree, edges, dirRel, trimmed.ids, GRAPH_LEVEL_MAX_NODES)
    return {
      level: next !== null && !isVisibleGraphRejection(next) ? next : null,
      ids: trimmed.ids,
      rejection: graph.reason
    }
  }, [tree, edges, dirRel, active])
  const effective = resolved.ids
  const notice =
    local ?? (resolved.rejection ? { kind: 'rejected' as const, reason: resolved.rejection } : null)
  const canExpandAll = useMemo(
    () =>
      resolved.level !== null &&
      expandCandidates(resolved.level.nodes, effective, GRAPH_ZOOM.autoExpandDepth).length > 0,
    [resolved.level, effective]
  )

  const visitRef = useRef(visit)
  useEffect(() => {
    visitRef.current = visit
  }, [visit])

  const commit = useCallback((ids: ReadonlySet<string>, forVisit: number): void => {
    if (visitRef.current !== forVisit) return
    setState({ visit: forVisit, ids })
  }, [])
  const reject = useCallback((reason: ExpansionRejection, forVisit: number): void => {
    setLocalNotice({ visit: forVisit, notice: { kind: 'rejected', reason } })
  }, [])

  const toggle = useCallback(
    (id: string): void => {
      if (!tree || scanningId === id) return
      if (effective.has(id)) {
        commit(collapseSubtree(tree, effective, id), visit)
        setLocalNotice(null)
        return
      }
      if (tree.has(id) && tree.kindOf(id) === 'folder' && tree.isLazy(id)) {
        setScanning({ visit, id })
      }
      void expandFolder(tree, edges, dirRel, effective, id, expandLazy).then((outcome) => {
        setScanning((prev) => (prev?.visit === visit && prev.id === id ? null : prev))
        if (outcome.kind === 'scanFailed') {
          setLocalNotice({ visit, notice: { kind: 'scanFailed' } })
          return
        }
        if (outcome.kind === 'rejected') {
          reject(outcome.reason, visit)
          return
        }
        if (outcome.kind === 'expanded') {
          commit(outcome.ids, visit)
          setLocalNotice(null)
        }
      })
    },
    [tree, edges, dirRel, visit, effective, scanningId, expandLazy, commit, reject]
  )

  const expandAll = useCallback((): void => {
    if (!tree || !resolved.level) return
    const ids = expandCandidates(resolved.level.nodes, effective, GRAPH_ZOOM.autoExpandDepth)
    if (ids.length === 0) return
    const result = expandIds(tree, edges, dirRel, effective, ids, GRAPH_LEVEL_MAX_NODES)
    commit(result.ids, visit)
    if (result.rejected) reject(result.rejected, visit)
    else setLocalNotice(null)
  }, [tree, edges, dirRel, visit, effective, resolved.level, commit, reject])

  const collapseAll = useCallback((): void => {
    if (effective.size > 0) commit(NONE, visit)
    setLocalNotice(null)
  }, [effective, visit, commit])

  const applyZoom = useCallback(
    (nodes: readonly ZoomNode[], scale: number): void => {
      if (!tree) return
      const decisions = zoomDecisions(nodes, scale, effective)
      if (decisions.expand.length === 0 && decisions.collapse.length === 0) return
      let base = effective
      for (const id of decisions.collapse) base = collapseSubtree(tree, base, id)
      // 收起可能让原本要展开的节点被遮住:只展开收起后仍可见的
      const after = buildVisibleGraph(tree, edges, dirRel, base, GRAPH_LEVEL_MAX_NODES)
      const visible =
        after !== null && !isVisibleGraphRejection(after)
          ? new Set(after.nodes.map((node) => node.id))
          : null
      const ids = visible ? decisions.expand.filter((id) => visible.has(id)) : []
      const result = expandIds(tree, edges, dirRel, base, ids, GRAPH_LEVEL_MAX_NODES)
      commit(result.ids, visit)
      if (result.rejected) reject(result.rejected, visit)
      else if (decisions.expand.length > 0) setLocalNotice(null)
    },
    [tree, edges, dirRel, visit, effective, commit, reject]
  )

  return {
    level: resolved.level,
    expanded: effective,
    scanningId,
    notice,
    canExpandAll,
    canCollapseAll: effective.size > 0,
    toggle,
    expandAll,
    collapseAll,
    applyZoom
  }
}
