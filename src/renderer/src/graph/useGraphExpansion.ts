// 图谱的展开状态:持有展开集合,组合 shared/expansion 的纯逻辑。
// 焦点切换由层级访问序号(visit)判定,旧层级的集合直接作废;换层后的第一次展开必须写入状态,
// 所以用 visitRef 判定迟到结果,而不是拿可能与序号脱节的状态做比较。
// lazy 文件夹先按需扫描;原地展开放不下时由可见图给出结构摘要,不再拒绝。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DepEdge, ScanDirNode } from '@shared/types'
import type { GroupTree } from '@shared/hierarchy'
import { buildVisibleGraph, type VisibleGraph } from '@shared/visibleGraph'
import { collapseSubtree, expandCandidates, expandFolder, expandIds } from '@shared/expansion'
import { GRAPH_ZOOM } from './graphConfig.ts'

export interface GraphExpansion {
  /** 当前展开集合下的可见图;焦点不存在时为 null */
  level: VisibleGraph | null
  /** 实际生效的展开集合 */
  expanded: ReadonlySet<string>
  /** 正在按需扫描的文件夹 id */
  scanningId: string | null
  /** 展开未扫描目录时扫描失败 */
  scanFailed: boolean
  /** 「展开两级」当前有可展开的文件夹 */
  canExpandAll: boolean
  /** 有已展开的文件夹可以收起 */
  canCollapseAll: boolean
  toggle: (id: string) => void
  /** 「展开两级」:把当前可见、浅于自动展开深度的文件夹一次展开 */
  expandAll: () => void
  collapseAll: () => void
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
  const [failedVisit, setFailedVisit] = useState<number | null>(null)

  const active = state.visit === visit ? state.ids : NONE
  const scanningId = scanning?.visit === visit ? scanning.id : null
  const scanFailed = failedVisit === visit

  const level = useMemo(
    () => (tree ? buildVisibleGraph(tree, edges, dirRel, active) : null),
    [tree, edges, dirRel, active]
  )
  const canExpandAll = useMemo(
    () =>
      level !== null &&
      expandCandidates(level.nodes, active, GRAPH_ZOOM.autoExpandDepth).length > 0,
    [level, active]
  )

  const visitRef = useRef(visit)
  useEffect(() => {
    visitRef.current = visit
  }, [visit])

  const commit = useCallback((ids: ReadonlySet<string>, forVisit: number): void => {
    if (visitRef.current !== forVisit) return
    setState({ visit: forVisit, ids })
  }, [])

  const toggle = useCallback(
    (id: string): void => {
      if (!tree || scanningId === id) return
      if (active.has(id)) {
        commit(collapseSubtree(tree, active, id), visit)
        setFailedVisit(null)
        return
      }
      if (tree.has(id) && tree.kindOf(id) === 'folder' && tree.isLazy(id)) {
        setScanning({ visit, id })
      }
      void expandFolder(tree, active, id, expandLazy).then((outcome) => {
        setScanning((prev) => (prev?.visit === visit && prev.id === id ? null : prev))
        if (outcome.kind === 'scanFailed') {
          setFailedVisit(visit)
          return
        }
        if (outcome.kind === 'expanded') {
          commit(outcome.ids, visit)
          setFailedVisit(null)
        }
      })
    },
    [tree, visit, active, scanningId, expandLazy, commit]
  )

  const expandAll = useCallback((): void => {
    if (!tree || !level) return
    const ids = expandCandidates(level.nodes, active, GRAPH_ZOOM.autoExpandDepth)
    if (ids.length === 0) return
    commit(expandIds(tree, active, ids), visit)
    setFailedVisit(null)
  }, [tree, level, active, visit, commit])

  const collapseAll = useCallback((): void => {
    if (active.size > 0) commit(NONE, visit)
    setFailedVisit(null)
  }, [active, visit, commit])

  return {
    level,
    expanded: active,
    scanningId,
    scanFailed,
    canExpandAll,
    canCollapseAll: active.size > 0,
    toggle,
    expandAll,
    collapseAll
  }
}
