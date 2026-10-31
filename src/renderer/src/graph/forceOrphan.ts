// 展开容器后,焦点层没有引用关系的节点只受很弱的全局重力,会被中心节点的斥力推到电荷作用上限附近,
// 在画布外圈散成一圈远处的散户。单独给它们一股向原点的拉力,把散户收拢到主体外围。
// 没有展开容器时整层是平铺总览,节点本来就是一圈同级点,这股力反而会把少数有引用的点反推出去,所以不生效。
import type { SimulationNodeDatum } from 'd3-force'

type Positioned = SimulationNodeDatum & { x: number; y: number }

/** 判断依据只有结构性字段,不依赖具体节点类型,便于自测 */
export interface OrphanCandidate {
  /** 直接上级容器;焦点直接子项为 null */
  parent: unknown
  data: { degree: number; isContainer?: boolean }
}

export interface OrphanForce<N extends Positioned> {
  (alpha: number): void
  initialize: (nodes: readonly N[]) => void
}

/** 只拉无引用、非容器、不在容器内的节点;其余节点的速度保持不变 */
export function forceOrphanGravity<N extends Positioned & OrphanCandidate>(
  strength: number,
  isOrphan: (node: N) => boolean
): OrphanForce<N> {
  let nodes: readonly N[] = []
  let active = false
  const force = ((alpha: number): void => {
    if (!active || strength === 0) return
    const k = strength * alpha
    for (const node of nodes) {
      if (!isOrphan(node)) continue
      node.vx = (node.vx ?? 0) - node.x * k
      node.vy = (node.vy ?? 0) - node.y * k
    }
  }) as OrphanForce<N>
  force.initialize = (next) => {
    nodes = next
    active = next.some((node) => node.data.isContainer === true)
  }
  return force
}

export function isOrphanNode(node: OrphanCandidate): boolean {
  return node.parent === null && node.data.isContainer !== true && node.data.degree === 0
}
