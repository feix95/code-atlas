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

/** 指针所在的展开容器里最靠内的那个;不在任何容器里返回 null。嵌套容器必然在小半径里,取半径最小的 */
export function containerAt(
  scene: ForceScene | null,
  tf: Transform,
  sx: number,
  sy: number
): SimNode | null {
  if (!scene) return null
  const wx = (sx - tf.x) / tf.k
  const wy = (sy - tf.y) / tf.k
  const slop = GRAPH_NODE.hitSlopPx / tf.k
  let inner: SimNode | null = null
  for (const n of scene.nodes) {
    if (!n.data.isContainer) continue
    if (Math.hypot(n.x - wx, n.y - wy) > n.r + slop) continue
    if (!inner || n.r < inner.r) inner = n
  }
  return inner
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
  const hits = (n: SimNode): boolean => Math.hypot(n.x - wx, n.y - wy) <= n.r + slop
  // 容器是一个大圆,先子项后容器:点在容器内空白处才算命中容器本身
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const n = scene.nodes[i]
    if (!n.data.isContainer && hits(n)) return n
  }
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const n = scene.nodes[i]
    if (n.data.isContainer && hits(n)) return n
  }
  return null
}
