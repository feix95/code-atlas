// 容器布局:容器半径由子项半径推算,约束力把展开容器的直接子项留在容器内。
// 约束在力里跑一次(先外层后内层),积分后画之前再夹一次,切向速度也不会把子项甩出边缘。
import type { SimulationNodeDatum } from 'd3-force'
import { GRAPH_NODE, GRAPH_ZOOM } from './graphConfig.ts'

export interface ContainNode extends SimulationNodeDatum {
  x: number
  y: number
  r: number
  /** 离焦点的层数:约束按它从外到内排序 */
  depth: number
  /** 直接上级容器;焦点直接子项与外部节点为 null */
  parent: ContainNode | null
}

export interface ContainForce<N extends ContainNode> {
  (alpha: number): void
  initialize: (nodes: N[]) => void
}

/** 容器半径 = sqrt(Σ(子半径 + padding)²) × packFactor;空容器保底一个文件夹半径 */
export function containerRadius(children: readonly { r: number }[]): number {
  let sum = 0
  for (const child of children) sum += (child.r + GRAPH_ZOOM.containerPadding) ** 2
  return Math.max(GRAPH_NODE.folderRadiusMin, Math.sqrt(sum) * GRAPH_ZOOM.packFactor)
}

/** 把越界子项的位置夹回父容器,并去掉向外的速度分量;切向速度保留 */
export function clampToContainers<N extends ContainNode>(nodes: readonly N[]): void {
  for (const node of [...nodes].sort((a, b) => a.depth - b.depth)) {
    const parent = node.parent
    if (!parent) continue
    const dx = node.x - parent.x
    const dy = node.y - parent.y
    const dist = Math.hypot(dx, dy)
    const limit = Math.max(0, parent.r - node.r - GRAPH_ZOOM.containMargin)
    if (dist <= limit) continue
    const ux = dist > 1e-9 ? dx / dist : 0
    const uy = dist > 1e-9 ? dy / dist : 0
    node.x = parent.x + ux * limit
    node.y = parent.y + uy * limit
    const radial = (node.vx ?? 0) * ux + (node.vy ?? 0) * uy
    if (radial > 0) {
      node.vx = (node.vx ?? 0) - radial * ux
      node.vy = (node.vy ?? 0) - radial * uy
    }
  }
}

export function forceContain<N extends ContainNode>(): ContainForce<N> {
  let nodes: N[] = []
  const force = ((_alpha: number): void => clampToContainers(nodes)) as ContainForce<N>
  force.initialize = (next) => {
    nodes = next
  }
  return force
}
