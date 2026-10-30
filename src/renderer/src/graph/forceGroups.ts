// 展开容器参与布局时的两处力修正:
// 子项被约束在容器内、始终离父容器很近,若照常互斥就永远消不掉,会把整张图一路推走。
// 所以成对碰撞跳过祖先与后代;容器本身不参与点电荷斥力,它与其他节点的间隔由成对碰撞负责。
import { forceManyBody } from 'd3-force'
import type { ContainNode } from './forceContain.ts'

export interface ContainPairForce<N extends ContainNode> {
  (alpha: number): void
  initialize: (nodes: readonly N[], random: () => number) => void
}

function isAncestor(ancestor: ContainNode, node: ContainNode): boolean {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

/** d3 forceCollide 的成对版本:两圆相交时各推开一半,祖先与后代之间跳过 */
export function forcePairCollide<N extends ContainNode>(padding: number): ContainPairForce<N> {
  let nodes: readonly N[] = []
  const force = ((_alpha: number): void => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        if (isAncestor(a, b) || isAncestor(b, a)) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.hypot(dx, dy)
        const min = a.r + b.r + padding * 2
        if (distance >= min) continue
        const push = (min - distance) / 2
        const ux = distance > 1e-9 ? dx / distance : 1
        const uy = distance > 1e-9 ? dy / distance : 0
        a.x -= ux * push
        a.y -= uy * push
        b.x += ux * push
        b.y += uy * push
      }
    }
  }) as ContainPairForce<N>
  force.initialize = (next) => {
    nodes = next
  }
  return force
}

/** 点电荷斥力,但容器节点不参与:被容器罩住的子项离它太近,互斥只会把容器推成无休止漂移 */
export function forceChargeOutsideContainers<N extends ContainNode>(
  strength: number,
  distanceMax: number,
  isContainer: (node: N) => boolean
): ContainPairForce<N> {
  const inner = forceManyBody<N>().strength(strength).distanceMax(distanceMax)
  const force = ((alpha: number): void => inner(alpha)) as ContainPairForce<N>
  force.initialize = (nodes, random) => {
    inner.initialize(
      nodes.filter((node) => !isContainer(node)),
      random
    )
  }
  return force
}
