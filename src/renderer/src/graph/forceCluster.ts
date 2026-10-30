// 聚类力(d3-force 自定义力):把同模块的可见节点拉向该模块可见成员的质心,
// 让模块轮廓收得紧、少盖住别的节点。归属取不到(未归类)的节点不受力。
import type { SimulationNodeDatum } from 'd3-force'

type Positioned = SimulationNodeDatum & { x: number; y: number }

export interface ClusterForce<N extends Positioned> {
  (alpha: number): void
  initialize: (nodes: N[]) => void
  strength: (value: number) => ClusterForce<N>
}

export function forceCluster<N extends Positioned>(
  clusterOf: (node: N) => string | null,
  initialStrength: number
): ClusterForce<N> {
  let nodes: N[] = []
  let strength = initialStrength
  const force = ((alpha: number): void => {
    if (strength === 0) return
    const sums = new Map<string, { x: number; y: number; n: number }>()
    for (const node of nodes) {
      const key = clusterOf(node)
      if (key === null) continue
      const sum = sums.get(key) ?? { x: 0, y: 0, n: 0 }
      sum.x += node.x
      sum.y += node.y
      sum.n++
      sums.set(key, sum)
    }
    const k = strength * alpha
    for (const node of nodes) {
      const key = clusterOf(node)
      const sum = key === null ? undefined : sums.get(key)
      if (!sum || sum.n < 2) continue
      node.vx = (node.vx ?? 0) + (sum.x / sum.n - node.x) * k
      node.vy = (node.vy ?? 0) + (sum.y / sum.n - node.y) * k
    }
  }) as ClusterForce<N>
  force.initialize = (next) => {
    nodes = next
  }
  force.strength = (value) => {
    strength = value
    return force
  }
  return force
}
