// 页面里的对象树(纯逻辑,无 React / DOM):节点仍存成一维数组(数组顺序 = 同级 z 序,越靠后越在上层),
// 层级只靠 parentId 表达;画板(frame)是唯一的容器。绘制与命中按「树序」走:同级按数组顺序,后代紧跟在容器后面。
// 坐标一律是页面坐标,所以挪动、复制容器时后代要一起处理,这里提供对应的集合运算。
// 只 import 类型自 scene.ts,避免与 scene.ts 循环依赖。
import { cloneFrame, type FrameNode } from './frame.ts'
import { hitRect, type Point } from './geometry.ts'
import { cloneLine } from './line.ts'
import { cloneRect } from './node.ts'
import type { SceneNode } from './scene.ts'

/** 节点所属容器的 key:parentId 指向存在的画板才算;悬空/指向非画板的一律当作直接在页面上(null) */
function parentKey(node: SceneNode, frameIds: ReadonlySet<string>): string | null {
  return node.parentId !== null && frameIds.has(node.parentId) ? node.parentId : null
}

function frameIdSet(nodes: readonly SceneNode[]): Set<string> {
  return new Set(nodes.filter((n) => n.type === 'frame').map((n) => n.id))
}

function groupByParent(nodes: readonly SceneNode[]): Map<string | null, SceneNode[]> {
  const frameIds = frameIdSet(nodes)
  const groups = new Map<string | null, SceneNode[]>()
  for (const node of nodes) {
    const key = parentKey(node, frameIds)
    groups.set(key, [...(groups.get(key) ?? []), node])
  }
  return groups
}

/** 顶层画板(直接在页面上的画板)的 id 集合 */
export function topLevelFrameIds(nodes: readonly SceneNode[]): Set<string> {
  const frameIds = frameIdSet(nodes)
  return new Set(
    nodes.filter((n) => n.type === 'frame' && parentKey(n, frameIds) === null).map((n) => n.id)
  )
}

/** 某容器(null = 页面)的直接子节点,按数组顺序(靠后在上层) */
export function childrenOf(nodes: readonly SceneNode[], parentId: string | null): SceneNode[] {
  return groupByParent(nodes).get(parentId) ?? []
}

/** 树序:同级按数组顺序,每个画板的后代紧跟其后。绘制与命中(倒序找最上层)都按这个序 */
export function treeOrder(nodes: readonly SceneNode[]): SceneNode[] {
  const groups = groupByParent(nodes)
  const out: SceneNode[] = []
  const walk = (parentId: string | null): void => {
    for (const node of groups.get(parentId) ?? []) {
      out.push(node)
      if (node.type === 'frame') walk(node.id)
    }
  }
  walk(null)
  return out
}

/** 自己加全部后代的 id(广度遍历) */
export function subtreeIds(nodes: readonly SceneNode[], rootId: string): string[] {
  const groups = groupByParent(nodes)
  const ids: string[] = []
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    ids.push(id)
    queue.push(...(groups.get(id) ?? []).map((n) => n.id))
  }
  return ids
}

/** 若干根节点连同它们的全部后代,按数组顺序返回(去重) */
export function withDescendants(
  nodes: readonly SceneNode[],
  rootIds: Iterable<string>
): SceneNode[] {
  const keep = new Set<string>()
  for (const id of rootIds) for (const sub of subtreeIds(nodes, id)) keep.add(sub)
  return nodes.filter((n) => keep.has(n.id))
}

/** 选集里的「根」:父级不在选集里的那些(整组移动、复制时只对根算外接框与落点) */
export function selectionRoots(
  nodes: readonly SceneNode[],
  selectedIds: readonly string[]
): SceneNode[] {
  const selected = new Set(selectedIds)
  const frameIds = frameIdSet(nodes)
  return nodes.filter((n) => {
    if (!selected.has(n.id)) return false
    const parent = parentKey(n, frameIds)
    return parent === null || !selected.has(parent)
  })
}

/** 整组移动/缩放的对象:选集的根(排除自己或祖先被锁定的)+ 它们的全部后代 */
export function movableSelection(
  nodes: readonly SceneNode[],
  selectedIds: readonly string[]
): { roots: SceneNode[]; all: SceneNode[] } {
  const locked = lockedIds(nodes)
  const roots = selectionRoots(nodes, selectedIds).filter((n) => !locked.has(n.id))
  return {
    roots,
    all: withDescendants(
      nodes,
      roots.map((n) => n.id)
    )
  }
}

/** 自己或任一祖先满足 own 的节点 id 集合(隐藏、锁定都向后代继承,Figma 同款) */
function inheritedIds(nodes: readonly SceneNode[], own: (n: SceneNode) => boolean): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const memo = new Map<string, boolean>()
  const has = (node: SceneNode): boolean => {
    const cached = memo.get(node.id)
    if (cached !== undefined) return cached
    memo.set(node.id, false) // 万一有环,先占位防无限递归
    const parent = node.parentId === null ? undefined : byId.get(node.parentId)
    const result = own(node) || (parent !== undefined && has(parent))
    memo.set(node.id, result)
    return result
  }
  return new Set(nodes.filter(has).map((n) => n.id))
}

export function hiddenIds(nodes: readonly SceneNode[]): Set<string> {
  return inheritedIds(nodes, (n) => !n.visible)
}

export function lockedIds(nodes: readonly SceneNode[]): Set<string> {
  return inheritedIds(nodes, (n) => n.locked)
}

/** 自己或最近的祖先画板;都没有返回 null */
export function nearestFrame(nodes: readonly SceneNode[], id: string): FrameNode | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  let cur = byId.get(id)
  while (cur && !seen.has(cur.id)) {
    if (cur.type === 'frame') return cur
    seen.add(cur.id)
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId)
  }
  return null
}

/** 「当前操作的画板」:选中对象所在的画板;没选中则取第一个可见的顶层画板;页面上没有画板返回 null */
export function contextFrame(
  nodes: readonly SceneNode[],
  selectedIds: readonly string[]
): FrameNode | null {
  for (const id of selectedIds) {
    const frame = nearestFrame(nodes, id)
    if (frame) return frame
  }
  const hidden = hiddenIds(nodes)
  const first = nodes.find((n) => n.type === 'frame' && n.parentId === null && !hidden.has(n.id))
  return first?.type === 'frame' ? first : null
}

function centerOf(node: SceneNode): Point {
  if (node.type === 'line') return { x: (node.x1 + node.x2) / 2, y: (node.y1 + node.y2) / 2 }
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}

/** 点落在哪个画板里:取最上层(树序最靠后)、可见、不在 exclude 里的画板 */
export function frameAt(
  nodes: readonly SceneNode[],
  point: Point,
  exclude: ReadonlySet<string> = new Set()
): FrameNode | null {
  const hidden = hiddenIds(nodes)
  const ordered = treeOrder(nodes)
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i]
    if (node.type !== 'frame' || exclude.has(node.id) || hidden.has(node.id)) continue
    if (hitRect(node, point)) return node
  }
  return null
}

/** 落点归属:把 parentId 约束成「存在的画板、不是自己、不在自己的子树里」,否则回到页面(null) */
export function validParentId(
  nodes: readonly SceneNode[],
  id: string,
  parentId: string | null
): string | null {
  if (parentId === null) return null
  const isFrame = nodes.some((n) => n.id === parentId && n.type === 'frame')
  return isFrame && !subtreeIds(nodes, id).includes(parentId) ? parentId : null
}

/** 松手后的重新归属:每个选集根按自己的中心点落在哪个画板里重新认爹(排除自己的子树),
 *  只返回父级真的变了的那些 */
export function reparentPatches(
  nodes: readonly SceneNode[],
  rootIds: readonly string[]
): { id: string; parentId: string | null }[] {
  const frameIds = frameIdSet(nodes)
  const patches: { id: string; parentId: string | null }[] = []
  for (const root of nodes.filter((n) => rootIds.includes(n.id))) {
    const subtree = new Set(subtreeIds(nodes, root.id))
    const parentId = frameAt(nodes, centerOf(root), subtree)?.id ?? null
    if (parentId !== parentKey(root, frameIds)) patches.push({ id: root.id, parentId })
  }
  return patches
}

/** 同级内调序:把 id 挪到「同级(不含自己)的第 position 位」,返回 reorder 动作用的数组下标;
 *  position 越界钳到两端;同级没有别人时原位不动 */
export function siblingReorderIndex(
  nodes: readonly SceneNode[],
  id: string,
  position: number
): number {
  const self = nodes.find((n) => n.id === id)
  const rest = nodes.filter((n) => n.id !== id)
  if (!self) return nodes.length
  const frameIds = frameIdSet(nodes)
  const key = parentKey(self, frameIds)
  const siblings = rest.filter((n) => parentKey(n, frameIds) === key)
  if (siblings.length === 0) return nodes.indexOf(self)
  const clamped = Math.min(siblings.length, Math.max(0, Math.round(position)))
  if (clamped < siblings.length) return rest.indexOf(siblings[clamped])
  return rest.indexOf(siblings[siblings.length - 1]) + 1
}

/** 克隆一批节点(调用方传入「根 + 全部后代」的平铺列表):每个都按各自类型重编 id,整体平移 offset;
 *  被一起克隆的父子关系重新接到新 id 上,父级不在这批里的保持原 parentId */
export function cloneNodes(
  sources: readonly SceneNode[],
  existing: readonly SceneNode[],
  offset: Point
): SceneNode[] {
  const made: SceneNode[] = []
  const idMap = new Map<string, string>()
  for (const src of sources) {
    const pool = [...existing, ...made]
    const copy =
      src.type === 'line'
        ? cloneLine(src, pool, offset)
        : src.type === 'frame'
          ? cloneFrame(src, pool, offset)
          : cloneRect(src, pool, offset)
    idMap.set(src.id, copy.id)
    made.push(copy)
  }
  return made.map((n, i) => {
    const parent = sources[i].parentId
    return { ...n, parentId: parent !== null && idMap.has(parent) ? idMap.get(parent)! : parent }
  })
}

/** 克隆若干棵树(sources = 根 + 全部后代的自包含列表):按树序克隆(父先于子,逐个 add 时父级已在),
 *  返回全部副本与其中「根副本」的 id(整体选中它们) */
export function cloneTrees(
  sources: readonly SceneNode[],
  rootIds: readonly string[],
  existing: readonly SceneNode[],
  offset: Point
): { made: SceneNode[]; rootIds: string[] } {
  const ordered = treeOrder(sources)
  const made = cloneNodes(ordered, existing, offset)
  const roots = new Set(rootIds)
  return {
    made,
    rootIds: made.filter((_, i) => roots.has(ordered[i].id)).map((n) => n.id)
  }
}
