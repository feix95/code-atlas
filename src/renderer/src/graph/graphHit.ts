// 画布坐标换算、节点命中检测与拖拽抓取偏移(视口指针、双击、右键共用)。
import type { ForceScene, SimNode } from './useForceLayout'
import type { Transform } from './drawGraph'
import { GRAPH_NODE } from './graphConfig.ts'

export function localPoint(
  canvas: HTMLCanvasElement,
  e: { clientX: number; clientY: number }
): [number, number] {
  const rect = canvas.getBoundingClientRect()
  return [e.clientX - rect.left, e.clientY - rect.top]
}

/** 容器是背景不是节点:圆圈空白处的悬停按空白处理,不高亮、不出详情、也不切悬停看法 */
export function hoverNodeOf<T extends { data: { isContainer?: boolean } }>(
  node: T | null
): T | null {
  return node !== null && node.data.isContainer !== true ? node : null
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

/** 按下点相对圆心的世界坐标偏移 */
export interface GrabOffset {
  dx: number
  dy: number
}

export function grabOffsetAt(node: { x: number; y: number }, wx: number, wy: number): GrabOffset {
  return { dx: wx - node.x, dy: wy - node.y }
}

/** 拖拽时圆心该在的位置:保持抓取偏移,点圆的边缘也按边缘跟随,不跳到指针下 */
export function dragCenterAt(grab: GrabOffset, wx: number, wy: number): { x: number; y: number } {
  return { x: wx - grab.dx, y: wy - grab.dy }
}

/** 平移手势:空白处左键(blank)、按住空格的左键(space)、右键(right) */
export type PanGesture = 'blank' | 'space' | 'right'

/** 按下时该不该直接平移:右键,或按住空格时的左键。其余组合照常命中节点 */
export function panGestureAt(
  button: number,
  spaceHeld: boolean
): Exclude<PanGesture, 'blank'> | null {
  if (button === 2) return 'right'
  if (button === 0 && spaceHeld) return 'space'
  return null
}
