// 关系图谱的可见图:焦点直接子项 + 已展开容器的子项。
// 展开的文件夹仍是节点(容器),子项紧随其后;边归并见 visibleEdges.ts。
// 焦点页直接子项全量呈现;原地展开只用预览额度,放不下时给结构摘要与「其余 N 项」入口。纯函数,不碰 DOM。
import type { DepEdge } from './types.ts'
import type { GroupTree } from './hierarchy.ts'
import { aggregate, computeDegrees, resolvePairs } from './visibleEdges.ts'

/** 原地展开追加的预览节点额度;焦点页直接子项不计入 */
export const GRAPH_PREVIEW_NODES = 150

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
  /** overflow 节点所属的文件夹:进入焦点页时用它 */
  groupId?: string
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
  groupId: string
  hidden: Set<string>
}

/**
 * 结构摘要的保留顺序:子文件夹保持原序在前;文件按与组外节点的引用条数排,
 * 组内文件互引对结构没有贡献,只在最后按总引用数做次级排序。
 */
function rankGroupChildren(
  childIds: readonly string[],
  nodesById: ReadonlyMap<string, VisibleNode>,
  pairs: ReadonlyArray<[string, string]>
): string[] {
  const files = new Set(childIds.filter((id) => nodesById.get(id)?.kind === 'file'))
  const contribution = new Map<string, number>()
  for (const [from, to] of pairs) {
    if (files.has(from) && files.has(to)) continue
    if (files.has(from)) contribution.set(from, (contribution.get(from) ?? 0) + 1)
    if (files.has(to)) contribution.set(to, (contribution.get(to) ?? 0) + 1)
  }
  const totalDegree = (id: string): number => nodesById.get(id)?.degree ?? 0
  const rankedFiles = childIds
    .map((id, index) => ({ id, index }))
    .filter(({ id }) => files.has(id))
    .sort(
      (a, b) =>
        (contribution.get(b.id) ?? 0) - (contribution.get(a.id) ?? 0) ||
        totalDegree(b.id) - totalDegree(a.id) ||
        a.index - b.index
    )
    .map(({ id }) => id)
  return [...childIds.filter((id) => nodesById.get(id)?.kind === 'folder'), ...rankedFiles]
}

/**
 * 预览额度按展开顺序分配:先展开的组先取,新组只能用剩余额度,已有组不重算。
 * 放得下就全展开;放不下时按结构摘要保留,其余收进本组的「其余 N 项」入口。
 * 焦点组不参与分配:进入文件夹后直接子项必须全量呈现。
 */
function planOverflows(
  expanded: ReadonlySet<string>,
  visible: ReadonlyMap<string, VisibleEntry>,
  groups: ReadonlyMap<string, string[]>,
  nodesById: ReadonlyMap<string, VisibleNode>,
  pairs: ReadonlyArray<[string, string]>,
  previewBudget: number
): Map<string, GroupOverflow> {
  const plans = new Map<string, GroupOverflow>()
  const hidden = new Set<string>()
  const isHidden = (id: string): boolean => {
    let current: string | null = id
    while (current) {
      if (hidden.has(current)) return true
      current = visible.get(current)?.parentId ?? null
    }
    return false
  }
  let remaining = previewBudget
  for (const groupId of expanded) {
    if (!visible.get(groupId)?.isContainer || isHidden(groupId)) continue
    const childIds = groups.get(groupId) ?? []
    if (childIds.length === 0) continue
    const keepCount = Math.min(childIds.length, remaining)
    remaining -= keepCount
    if (keepCount === childIds.length) continue
    const keep = new Set(rankGroupChildren(childIds, nodesById, pairs).slice(0, keepCount))
    for (const id of childIds) if (!keep.has(id)) hidden.add(id)
    plans.set(groupId, {
      overflowId: groupId + OVERFLOW_ID_SUFFIX,
      groupId,
      hidden: new Set(childIds.filter((id) => !keep.has(id)))
    })
  }
  return plans
}

function directHiddenIds(plans: ReadonlyMap<string, GroupOverflow>): Map<string, string> {
  const direct = new Map<string, string>()
  for (const plan of plans.values()) {
    for (const id of plan.hidden) direct.set(id, plan.overflowId)
  }
  return direct
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
    groupId: plan.groupId,
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
  previewBudget: number = GRAPH_PREVIEW_NODES
): VisibleGraph | null {
  if (!tree.has(focus) || tree.kindOf(focus) !== 'folder') return null
  const visible = collectVisible(tree, focus, expanded)
  const nodesById = new Map<string, VisibleNode>()
  for (const [id, entry] of visible) nodesById.set(id, makeNode(tree, id, entry))
  const { pairs, externals } = resolvePairs(tree, depEdges, focus, visible)
  computeDegrees([...nodesById.values()], aggregate(pairs))

  const groups = groupChildren(visible, focus)
  const plans = planOverflows(expanded, visible, groups, nodesById, pairs, previewBudget)
  const directHidden = directHiddenIds(plans)
  const overflowFor = overflowResolver(visible, focus, directHidden)
  const visibleNodes = emitNodes(focus, 0, null, groups, nodesById, plans, directHidden)
  const remapped = pairs.map(([from, to]): [string, string] => [
    overflowFor(from) ?? from,
    overflowFor(to) ?? to
  ])
  const nodes = [...visibleNodes, ...externals]
  const edges = aggregate(remapped)
  computeDegrees(nodes, edges)
  return { dirRel: focus, lazy: tree.isLazy(focus), nodes, edges }
}
