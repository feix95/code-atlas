// 画布坐标换算与节点命中检测(视口指针、双击、右键共用)。
import type { ForceScene, SimNode } from './useForceLayout'
import type { Transform } from './drawGraph'
import { GRAPH_NODE } from './graphConfig'

export function localPoint(
  canvas: HTMLCanvasElement,
  e: { clientX: number; clientY: number }
): [number, number] {
  const rect = canvas.getBoundingClientRect()
  return [e.clientX - rect.left, e.clientY - rect.top]
}

export function hitTest(
  scene: ForceScene | null,
  tf: Transform,
  sx: number,
  sy: number
): SimNode | null {
  if (!scene) return null
  const wx = (sx - tf.x) / tf.k
  const wy = (sy - tf.y) / tf.k
  const slop = GRAPH_NODE.hitSlopPx / tf.k
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const n = scene.nodes[i]
    if (Math.hypot(n.x - wx, n.y - wy) <= n.r + slop) return n
  }
  return null
}
