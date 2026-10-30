// 关系图谱的可见图:焦点直接子项 + 已展开容器的子项。
// 展开的文件夹仍是节点(容器),子项紧随其后;边归并见 visibleEdges.ts。
// 可见非外部节点超过上限时返回可区分的原因。纯函数,不碰 DOM。
import type { DepEdge } from './types.ts'
import type { GroupTree } from './hierarchy.ts'
import { aggregate, computeDegrees, resolvePairs } from './visibleEdges.ts'

/** 屏幕上同时可见的非外部节点上限 */
export const GRAPH_LEVEL_MAX_NODES = 150

/** overflow 节点 id 的后缀:含冒号,Windows 文件名不可能出现,不会与 relPath 撞车 */
export const OVERFLOW_ID_SUFFIX = '::overflow'

export type LevelNodeKind = 'folder' | 'file' | 'external' | 'overflow'

export interface LevelNode {
  /** relPath;overflow 节点为 `${groupId}${OVERFLOW_ID_SUFFIX}` */
  id: string
  kind: LevelNodeKind
  /** 标签文字:取路径最后一段(外部节点的完整路径即 id) */
  label: string
  /** 归并后相连边的权重之和 */
  degree: number
  /** 文件夹:已扫描的后代文件数;其余为 0 */
  descendantFiles: number
  /** 文件夹尚未扫描(扫描器 lazy 目录) */
  lazy?: boolean
  /** 外部节点指向的是文件还是目录 */
  target?: 'file' | 'folder'
  /** overflow 节点收纳的子项数 */
  hiddenCount?: number
}

export interface LevelEdge {
  from: string
  to: string
  /** 归并进这条边的原始引用条数 */
  weight: number
}

export interface LevelGraph {
  dirRel: string
  /** 当前目录本身尚未扫描:界面应先扫描再展示 */
  lazy: boolean
  nodes: LevelNode[]
  edges: LevelEdge[]
}

export interface VisibleNode extends LevelNode {
  /** 直接所在的已展开容器;焦点的直接子项没有 */
  parentId?: string
  /** 已展开的文件夹:绘制为圆形容器,自身也是节点 */
  isContainer?: boolean
  /** 离焦点的层数:焦点直接子项为 1,外部节点为 0 */
  depth: number
}

export interface VisibleGraph extends LevelGraph {
  nodes: VisibleNode[]
}

export interface VisibleGraphRejection {
  /** total = 多个展开叠加后超限;folder = 某个文件夹自身子项超限,再展开也放不下 */
  reason: 'total' | 'folder'
  /** 按展开集合计算出的可见非外部节点数(各组 overflow 收口后) */
  count: number
  limit: number
}

export function isVisibleGraphRejection(
  value: VisibleGraph | VisibleGraphRejection
): value is VisibleGraphRejection {
  return 'reason' in value
}

export interface VisibleEntry {
  parentId: string | null
  depth: number
  isContainer: boolean
}

function collectVisible(
  tree: GroupTree,
  focus: string,
  expanded: ReadonlySet<string>
): Map<string, VisibleEntry> {
  const visible = new Map<string, VisibleEntry>()
  const walk = (groupId: string, depth: number, parentId: string | null): void => {
    for (const id of tree.children(groupId)) {
      const isContainer = tree.kindOf(id) === 'folder' && expanded.has(id)
      visible.set(id, { parentId, depth, isContainer })
      if (isContainer) walk(id, depth + 1, id)
    }
  }
  walk(focus, 1, null)
  return visible
}

function makeNode(tree: GroupTree, id: string, entry: VisibleEntry): VisibleNode {
  const kind = tree.kindOf(id)
  return {
    id,
    kind,
    label: tree.labelOf(id),
    degree: 0,
    descendantFiles: kind === 'folder' ? tree.descendantFiles(id) : 0,
    depth: entry.depth,
    ...(entry.parentId !== null ? { parentId: entry.parentId } : {}),
    ...(entry.isContainer ? { isContainer: true } : {}),
    ...(kind === 'folder' && tree.isLazy(id) ? { lazy: true } : {})
  }
}

/** 每个分组(焦点与各展开容器)的直接子项,保持先序 */
function groupChildren(
  visible: ReadonlyMap<string, VisibleEntry>,
  focus: string
): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const [id, entry] of visible) {
    const groupId = entry.parentId ?? focus
    const list = groups.get(groupId)
    if (list) list.push(id)
    else groups.set(groupId, [id])
  }
  return groups
}

interface GroupOverflow {
  overflowId: string
  hidden: Set<string>
}

/** 超限时按度数(并列保持原顺序)保留前 max-1 个,其余收进本组的 overflow 节点 */
function planGroup(
  groupId: string,
  childIds: readonly string[],
  nodesById: ReadonlyMap<string, VisibleNode>,
  max: number
): GroupOverflow | null {
  if (childIds.length <= max) return null
  const ranked = childIds
    .map((id, index) => ({ id, index, degree: nodesById.get(id)?.degree ?? 0 }))
    .sort((a, b) => b.degree - a.degree || a.index - b.index)
  const keep = new Set(ranked.slice(0, max - 1).map((r) => r.id))
  return {
    overflowId: groupId + OVERFLOW_ID_SUFFIX,
    hidden: new Set(childIds.filter((id) => !keep.has(id)))
  }
}

interface OverflowPlans {
  byGroup: Map<string, GroupOverflow>
  directHidden: Map<string, string>
}

function planOverflows(
  focus: string,
  visible: ReadonlyMap<string, VisibleEntry>,
  groups: ReadonlyMap<string, string[]>,
  nodesById: ReadonlyMap<string, VisibleNode>,
  max: number
): OverflowPlans {
  const byGroup = new Map<string, GroupOverflow>()
  const directHidden = new Map<string, string>()
  const isHidden = (id: string): boolean => {
    let current: string | null = id
    while (current) {
      if (directHidden.has(current)) return true
      current = visible.get(current)?.parentId ?? null
    }
    return false
  }
  const apply = (groupId: string): void => {
    const plan = planGroup(groupId, groups.get(groupId) ?? [], nodesById, max)
    if (!plan) return
    byGroup.set(groupId, plan)
    for (const id of plan.hidden) directHidden.set(id, plan.overflowId)
  }
  apply(focus)
  for (const [id, entry] of visible) {
    if (!entry.isContainer || isHidden(id)) continue
    apply(id)
  }
  return { byGroup, directHidden }
}

/** 被收进 overflow 节点的 id 查到所在 overflow;其余返回 null */
function overflowResolver(
  visible: ReadonlyMap<string, VisibleEntry>,
  focus: string,
  directHidden: ReadonlyMap<string, string>
): (id: string) => string | null {
  const memo = new Map<string, string | null>()
  const resolve = (id: string): string | null => {
    const direct = directHidden.get(id)
    if (direct) return direct
    if (memo.has(id)) return memo.get(id) ?? null
    const parentId = visible.get(id)?.parentId ?? null
    const inherited = parentId && parentId !== focus ? resolve(parentId) : null
    memo.set(id, inherited)
    return inherited
  }
  return resolve
}

function overflowNode(plan: GroupOverflow, depth: number, parentId: string | null): VisibleNode {
  return {
    id: plan.overflowId,
    kind: 'overflow',
    label: `其余 ${plan.hidden.size} 项`,
    degree: 0,
    descendantFiles: 0,
    hiddenCount: plan.hidden.size,
    depth,
    ...(parentId !== null ? { parentId } : {})
  }
}

function emitNodes(
  groupId: string,
  depth: number,
  parentId: string | null,
  groups: ReadonlyMap<string, string[]>,
  nodesById: ReadonlyMap<string, VisibleNode>,
  plans: ReadonlyMap<string, GroupOverflow>,
  directHidden: ReadonlyMap<string, string>
): VisibleNode[] {
  const out: VisibleNode[] = []
  for (const id of groups.get(groupId) ?? []) {
    if (directHidden.has(id)) continue
    const node = nodesById.get(id)
    if (!node) continue
    out.push(node)
    if (node.isContainer) {
      out.push(...emitNodes(id, node.depth, id, groups, nodesById, plans, directHidden))
    }
  }
  const plan = plans.get(groupId)
  if (plan) out.push(overflowNode(plan, depth + 1, parentId))
  return out
}

/**
 * 计算焦点 focus 的可见图;焦点不存在或不是文件夹时返回 null。
 * 引用端点不在扫描树里(关系分析比扫描树新)的边直接跳过,不凭空造节点。
 */
export function buildVisibleGraph(
  tree: GroupTree,
  depEdges: readonly DepEdge[],
  focus: string,
  expanded: ReadonlySet<string>,
  maxNodes: number = GRAPH_LEVEL_MAX_NODES
): VisibleGraph | VisibleGraphRejection | null {
  if (!tree.has(focus) || tree.kindOf(focus) !== 'folder') return null
  const visible = collectVisible(tree, focus, expanded)
  const nodesById = new Map<string, VisibleNode>()
  for (const [id, entry] of visible) nodesById.set(id, makeNode(tree, id, entry))
  const { pairs, externals } = resolvePairs(tree, depEdges, focus, visible)
  computeDegrees([...nodesById.values()], aggregate(pairs))

  const groups = groupChildren(visible, focus)
  const plans = planOverflows(focus, visible, groups, nodesById, maxNodes)
  const overflowFor = overflowResolver(visible, focus, plans.directHidden)
  const visibleNodes = emitNodes(
    focus,
    0,
    null,
    groups,
    nodesById,
    plans.byGroup,
    plans.directHidden
  )
  const remapped = pairs.map(([from, to]): [string, string] => [
    overflowFor(from) ?? from,
    overflowFor(to) ?? to
  ])
  const nodes = [...visibleNodes, ...externals]
  const edges = aggregate(remapped)
  computeDegrees(nodes, edges)

  if (visibleNodes.length > maxNodes) {
    const folderFull = [...plans.byGroup.keys()].some((groupId) => groupId !== focus)
    return { reason: folderFull ? 'folder' : 'total', count: visibleNodes.length, limit: maxNodes }
  }
  return { dirRel: focus, lazy: tree.isLazy(focus), nodes, edges }
}
