// 场景节点(纯逻辑,无 React / DOM):矩形、直线、画板的联合类型,以及按类型分派的通用操作。
// 命令入口 NodeAction 在这里:add / update / remove / reorder 对各类节点一视同仁,撤销与导出只认这一份。
// 通用手势(移动、方向键微调、吸附、框选、点选、复制粘贴)只通过本文件的函数碰节点,
// 不直接读 x/y/width/height——直线没有这些字段,只有两个端点。
// 层级(画板与后代)的集合运算在 tree.ts;这里的 remove 会连后代一起删,update/add 会校验 parentId。
import { applyFramePatch, type FrameNode, type FramePatch } from './frame.ts'
import { hitRect, rectOverlapsBox, type Point, type RectBox } from './geometry.ts'
import {
  applyLinePatch,
  hitLine,
  lineOverlapsBox,
  lineTranslatePatch,
  type LineNode,
  type LinePatch
} from './line.ts'
import { applyRectPatch, type RectNode, type RectPatch } from './node.ts'
import {
  cloneNodes,
  hiddenIds,
  lockedIds,
  subtreeIds,
  topLevelFrameIds,
  treeOrder,
  validParentId
} from './tree.ts'

export type SceneNode = RectNode | LineNode | FrameNode
export type NodePatch = RectPatch | LinePatch | FramePatch

export type NodeAction =
  | { type: 'add'; node: SceneNode }
  | { type: 'update'; id: string; patch: NodePatch }
  /** 删除节点,画板连同全部后代一起删 */
  | { type: 'remove'; id: string }
  /** 调 z 序:toIndex = 移动后在数组里的下标(越大越靠上层),越界钳到两端 */
  | { type: 'reorder'; id: string; toIndex: number }

const LAYER_PATCH_KEYS = ['name', 'visible', 'locked', 'parentId'] as const
const RECT_PATCH_KEYS: readonly (keyof RectPatch)[] = [
  ...LAYER_PATCH_KEYS,
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'radii',
  'fill',
  'stroke',
  'styleId'
]
const LINE_PATCH_KEYS: readonly (keyof LinePatch)[] = [
  ...LAYER_PATCH_KEYS,
  'x1',
  'y1',
  'x2',
  'y2',
  'stroke',
  'cap',
  'styleId'
]

/** 只留下属于该节点类型的补丁字段:对矩形打直线补丁(反之亦然)不会把外来字段混进节点 */
function onlyKeys<T extends object>(patch: object, keys: readonly (keyof T)[]): T {
  return Object.fromEntries(
    Object.entries(patch).filter(([k]) => (keys as readonly string[]).includes(k))
  ) as T
}

/** 补丁按节点自身类型落地;补丁类型与节点类型对不上(如把 x 补丁打到直线上)时,多余字段被忽略 */
function applyPatch(node: SceneNode, patch: NodePatch): SceneNode {
  if (node.type === 'line') return applyLinePatch(node, onlyKeys<LinePatch>(patch, LINE_PATCH_KEYS))
  if (node.type === 'frame') return applyFramePatch(node, patch as FramePatch)
  return applyRectPatch(node, onlyKeys<RectPatch>(patch, RECT_PATCH_KEYS))
}

export function applyNodeAction(nodes: readonly SceneNode[], action: NodeAction): SceneNode[] {
  switch (action.type) {
    case 'add': {
      const node = applyPatch(action.node, {})
      const parentId = validParentId(nodes, node.id, node.parentId)
      return [...nodes, { ...node, parentId }]
    }
    case 'update':
      return nodes.map((n) => {
        if (n.id !== action.id) return n
        const next = applyPatch(n, action.patch)
        return 'parentId' in action.patch
          ? { ...next, parentId: validParentId(nodes, n.id, next.parentId) }
          : next
      })
    case 'remove': {
      const removed = new Set(subtreeIds(nodes, action.id))
      return nodes.filter((n) => !removed.has(n.id))
    }
    case 'reorder':
      return reorderNode(nodes, action.id, action.toIndex)
  }
}

function reorderNode(nodes: readonly SceneNode[], id: string, toIndex: number): SceneNode[] {
  const from = nodes.findIndex((n) => n.id === id)
  if (from < 0) return [...nodes]
  const rest = nodes.filter((n) => n.id !== id)
  const to = Math.min(rest.length, Math.max(0, Math.round(toIndex)))
  return [...rest.slice(0, to), nodes[from], ...rest.slice(to)]
}

/** 轴对齐外接框:矩形/画板取声明的 x/y/宽/高(旋转矩形不展开,与选中描边同口径),直线取两端点包围盒 */
export function nodeBox(node: SceneNode): RectBox {
  if (node.type !== 'line') return { x: node.x, y: node.y, width: node.width, height: node.height }
  return {
    x: Math.min(node.x1, node.x2),
    y: Math.min(node.y1, node.y2),
    width: Math.abs(node.x2 - node.x1),
    height: Math.abs(node.y2 - node.y1)
  }
}

/** 一组节点的联合外接框(整组移动当「被拖矩形」进吸附) */
export function unionBox(nodes: readonly SceneNode[]): RectBox {
  const boxes = nodes.map(nodeBox)
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y
  }
}

/** 页面上全部可见内容的外接框(适配窗口用);页面是空的返回 null */
export function contentBox(nodes: readonly SceneNode[]): RectBox | null {
  const shown = visibleNodes(nodes)
  return shown.length === 0 ? null : unionBox(shown)
}

/** 平移补丁:移动手势与方向键微调共用;矩形/画板动 x/y,直线两端点同位移 */
export function translatePatch(node: SceneNode, dx: number, dy: number): NodePatch {
  return node.type === 'line'
    ? lineTranslatePatch(node, dx, dy)
    : { x: node.x + dx, y: node.y + dy }
}

/** 命中(直线用 lineTolerance:设计单位的点选容差,由调用方按缩放换算) */
export function hitNode(node: SceneNode, p: Point, lineTolerance: number): boolean {
  return node.type === 'line' ? hitLine(node, p, lineTolerance) : hitRect(node, p)
}

/** 节点自身可见且未锁定(不看祖先;带层级的判断用 pickableNodes) */
export function isPickable(node: SceneNode): boolean {
  return node.visible && !node.locked
}

/** 画布上能点中/框中的节点:自己和祖先都可见、都没锁定(锁定、隐藏向后代继承) */
export function pickableNodes(nodes: readonly SceneNode[]): SceneNode[] {
  const hidden = hiddenIds(nodes)
  const locked = lockedIds(nodes)
  return nodes.filter((n) => !hidden.has(n.id) && !locked.has(n.id))
}

/** 参与渲染与导出的节点:隐藏的(含被隐藏的画板的后代)不画不导 */
export function visibleNodes(nodes: readonly SceneNode[]): SceneNode[] {
  const hidden = hiddenIds(nodes)
  return nodes.filter((n) => !hidden.has(n.id))
}

/** 树序里最上层的命中节点(同级后画的在上,后代在容器之上)。
 *  顶层画板的底面点不中(它是「桌面上的纸」,点里面是框选;选它靠名签),嵌套的画板与其他节点照常命中 */
export function hitTopmost(
  nodes: readonly SceneNode[],
  p: Point,
  lineTolerance: number
): SceneNode | null {
  const pickable = new Set(pickableNodes(nodes).map((n) => n.id))
  const topFrames = topLevelFrameIds(nodes)
  const ordered = treeOrder(nodes)
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i]
    if (!pickable.has(node.id) || topFrames.has(node.id)) continue
    if (hitNode(node, p, lineTolerance)) return node
  }
  return null
}

/** 框选相交:扫到节点任意部分即中 */
export function nodeOverlapsBox(node: SceneNode, box: RectBox): boolean {
  return node.type === 'line' ? lineOverlapsBox(node, box) : rectOverlapsBox(node, box)
}

/** 克隆单个节点:序号规则同各自的 create*(现有最大 + 1),整体按 offset 平移,源对象不动 */
export function cloneNode(
  source: SceneNode,
  nodes: readonly SceneNode[],
  offset: Point
): SceneNode {
  return cloneNodes([source], nodes, offset)[0]
}

/** 深拷贝(内存剪贴板用):之后源节点再被改动,贴出来的还是复制那一刻的样子 */
export function snapshotNode(node: SceneNode): SceneNode {
  return node.type === 'line'
    ? { ...node, stroke: { ...node.stroke } }
    : {
        ...node,
        radii: [...node.radii] as typeof node.radii,
        stroke: node.stroke && { ...node.stroke }
      }
}
