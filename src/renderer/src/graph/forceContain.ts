// 容器边界:子项在圆内自由受力,这里兜住它们的外溢,并把顶部容器名让出来。
// 约束在力里跑一次(先外层后内层),积分后画之前再夹一次,切向速度也不会把子项甩出边缘。
import type { SimulationNodeDatum } from 'd3-force'
import { GRAPH_CONTAINER, GRAPH_ZOOM } from './graphConfig.ts'
import { farthestCorner, labelBox } from './nodeBox.ts'

export interface ContainNode extends SimulationNodeDatum {
  x: number
  y: number
  r: number
  /** 离焦点的层数:约束按它从外到内排序 */
  depth: number
  /** 直接上级容器;焦点直接子项与外部节点为 null */
  parent: ContainNode | null
  /** 下方标签宽度;0 / 缺省 = 没有下方标签(容器名画在圆内) */
  labelWidth?: number
}

export interface ContainForce<N extends ContainNode> {
  (alpha: number): void
  initialize: (nodes: N[]) => void
}

/** 整盒(圆 + 下方标签)离节点中心的最远距离:按它夹,标签也跟着留在圆里 */
function reachOf(node: ContainNode, labelHeight: number): number {
  const labelWidth = node.labelWidth ?? 0
  if (labelWidth <= 0) return node.r
  return farthestCorner(labelBox(0, 0, node.r, labelWidth, labelHeight))
}

/** 把越界子项夹回父容器、让开顶部容器名,并去掉向外的速度分量;切向速度保留 */
export function clampToContainers<N extends ContainNode>(
  nodes: readonly N[],
  labelHeight = 0
): void {
  for (const node of [...nodes].sort((a, b) => a.depth - b.depth)) {
    const parent = node.parent
    if (!parent) continue
    const limit = Math.max(0, parent.r - reachOf(node, labelHeight) - GRAPH_ZOOM.containMargin)
    // 容器名占顶部一条横带;圆与横带都是凸区域,交替夹两轮就稳
    const nameTop = -parent.r + GRAPH_CONTAINER.labelGap + labelHeight + GRAPH_ZOOM.containerPadding
    for (let pass = 0; pass < 2; pass++) {
      const dx = node.x - parent.x
      const dy = node.y - parent.y
      const dist = Math.hypot(dx, dy)
      if (dist > limit) {
        const ux = dist > 1e-9 ? dx / dist : 0
        const uy = dist > 1e-9 ? dy / dist : 0
        node.x = parent.x + ux * limit
        node.y = parent.y + uy * limit
      }
      if (node.y - parent.y - node.r < nameTop) node.y = parent.y + nameTop + node.r
    }
    const dx = node.x - parent.x
    const dy = node.y - parent.y
    const dist = Math.hypot(dx, dy)
    const ux = dist > 1e-9 ? dx / dist : 0
    const uy = dist > 1e-9 ? dy / dist : 0
    const radial = (node.vx ?? 0) * ux + (node.vy ?? 0) * uy
    if (radial > 0) {
      node.vx = (node.vx ?? 0) - radial * ux
      node.vy = (node.vy ?? 0) - radial * uy
    }
  }
}

export function forceContain<N extends ContainNode>(labelHeight = 0): ContainForce<N> {
  let nodes: N[] = []
  const force = ((_alpha: number): void => clampToContainers(nodes, labelHeight)) as ContainForce<N>
  force.initialize = (next) => {
    nodes = next
  }
  return force
}
