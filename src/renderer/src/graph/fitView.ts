// 「适应画布」的几何:算出让全部节点可见的变换,并判断首次布局稳定后要不要自动适应一次。
// 纯函数,不依赖 DOM。
import type { Transform } from './drawGraph'
import type { ForceScene } from './useForceLayout'
import type { ViewportSize } from './useGraphViewport'
import { GRAPH_VIEW } from './graphConfig.ts'

export function clampScale(k: number): number {
  return Math.max(GRAPH_VIEW.minScale, Math.min(GRAPH_VIEW.maxScale, k))
}

export function fitTransform(scene: ForceScene | null, size: ViewportSize): Transform | null {
  if (!scene || scene.nodes.length === 0 || size.w === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const n of scene.nodes) {
    x0 = Math.min(x0, n.x - n.r)
    y0 = Math.min(y0, n.y - n.r)
    x1 = Math.max(x1, n.x + n.r)
    y1 = Math.max(y1, n.y + n.r)
  }
  const pad = GRAPH_VIEW.fitPaddingPx
  const k = clampScale(
    Math.min(
      (size.w - pad * 2) / (x1 - x0 || 1),
      (size.h - pad * 2) / (y1 - y0 || 1),
      GRAPH_VIEW.fitMaxScale
    )
  )
  return { k, x: size.w / 2 - ((x0 + x1) / 2) * k, y: size.h / 2 - ((y0 + y1) / 2) * k }
}

function isOutside(scene: ForceScene, tf: Transform, size: ViewportSize): boolean {
  return scene.nodes.some((n) => {
    const sx = n.x * tf.k + tf.x
    const sy = n.y * tf.k + tf.y
    return sx < 0 || sy < 0 || sx > size.w || sy > size.h
  })
}

/** 节点出界要缩小;整体只占画布一小块(适应后能放大 autoFitGrowRatio 倍以上)也要放大 */
export function shouldAutoFit(scene: ForceScene, tf: Transform, size: ViewportSize): boolean {
  if (isOutside(scene, tf, size)) return true
  const next = fitTransform(scene, size)
  return next !== null && next.k >= tf.k * GRAPH_VIEW.autoFitGrowRatio
}
