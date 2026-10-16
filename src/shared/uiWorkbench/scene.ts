// 场景节点(纯逻辑,无 React / DOM):矩形与直线的联合类型,以及按类型分派的通用操作。
// 命令入口 NodeAction 在这里:add / update / remove 对两种节点一视同仁,撤销与导出只认这一份。
// 通用手势(移动、方向键微调、吸附、框选、点选、复制粘贴)只通过本文件的函数碰节点,
// 不直接读 x/y/width/height——直线没有这些字段,只有两个端点。
import { hitRect, rectOverlapsBox, type Point, type RectBox } from './geometry.ts'
import {
  applyLinePatch,
  cloneLine,
  hitLine,
  lineOverlapsBox,
  lineTranslatePatch,
  type LineNode,
  type LinePatch
} from './line.ts'
import { applyRectPatch, cloneRect, type RectNode, type RectPatch } from './node.ts'

export type SceneNode = RectNode | LineNode
export type NodePatch = RectPatch | LinePatch

export type NodeAction =
  | { type: 'add'; node: SceneNode }
  | { type: 'update'; id: string; patch: NodePatch }
  | { type: 'remove'; id: string }
  /** 调 z 序:toIndex = 移动后在数组里的下标(越大越靠上层),越界钳到两端 */
  | { type: 'reorder'; id: string; toIndex: number }

const LAYER_PATCH_KEYS = ['name', 'visible', 'locked'] as const
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
  return node.type === 'line'
    ? applyLinePatch(node, onlyKeys<LinePatch>(patch, LINE_PATCH_KEYS))
    : applyRectPatch(node, onlyKeys<RectPatch>(patch, RECT_PATCH_KEYS))
}

export function applyNodeAction(nodes: readonly SceneNode[], action: NodeAction): SceneNode[] {
  switch (action.type) {
    case 'add':
      return [...nodes, applyPatch(action.node, {})]
    case 'update':
      return nodes.map((n) => (n.id === action.id ? applyPatch(n, action.patch) : n))
    case 'remove':
      return nodes.filter((n) => n.id !== action.id)
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

/** 轴对齐外接框:矩形取声明的 x/y/宽/高(旋转矩形不展开,与选中描边同口径),直线取两端点包围盒 */
export function nodeBox(node: SceneNode): RectBox {
  if (node.type === 'rect') return { x: node.x, y: node.y, width: node.width, height: node.height }
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

/** 平移补丁:移动手势与方向键微调共用;矩形动 x/y,直线两端点同位移 */
export function translatePatch(node: SceneNode, dx: number, dy: number): NodePatch {
  return node.type === 'rect'
    ? { x: node.x + dx, y: node.y + dy }
    : lineTranslatePatch(node, dx, dy)
}

/** 命中(直线用 lineTolerance:设计单位的点选容差,由调用方按缩放换算) */
export function hitNode(node: SceneNode, p: Point, lineTolerance: number): boolean {
  return node.type === 'rect' ? hitRect(node, p) : hitLine(node, p, lineTolerance)
}

/** 画布上能点中/框中的节点:可见且未锁定(锁定的只能从图层面板选;隐藏的看不见也点不到) */
export function isPickable(node: SceneNode): boolean {
  return node.visible && !node.locked
}

/** 参与渲染与导出的节点:隐藏的不画不导 */
export function visibleNodes(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.filter((n) => n.visible)
}

/** 后画的在上层:倒序找第一个命中的(不可点选的节点跳过) */
export function hitTopmost(
  nodes: readonly SceneNode[],
  p: Point,
  lineTolerance: number
): SceneNode | null {
  for (let i = nodes.length - 1; i >= 0; i--)
    if (isPickable(nodes[i]) && hitNode(nodes[i], p, lineTolerance)) return nodes[i]
  return null
}

/** 框选相交:扫到节点任意部分即中 */
export function nodeOverlapsBox(node: SceneNode, box: RectBox): boolean {
  return node.type === 'rect' ? rectOverlapsBox(node, box) : lineOverlapsBox(node, box)
}

/** 克隆:序号规则同各自的 create*(现有最大 + 1),整体按 offset 平移,源对象不动 */
export function cloneNode(
  source: SceneNode,
  nodes: readonly SceneNode[],
  offset: Point
): SceneNode {
  return source.type === 'rect'
    ? cloneRect(source, nodes, offset)
    : cloneLine(source, nodes, offset)
}

/** 深拷贝(内存剪贴板用):之后源节点再被改动,贴出来的还是复制那一刻的样子 */
export function snapshotNode(node: SceneNode): SceneNode {
  return node.type === 'rect'
    ? {
        ...node,
        radii: [...node.radii] as typeof node.radii,
        stroke: node.stroke && { ...node.stroke }
      }
    : { ...node, stroke: { ...node.stroke } }
}
