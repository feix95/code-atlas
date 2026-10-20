/** 原文 / 译文滚动对齐的纯数学(自测见 scripts/selftest-scrollalign.mts)。
 *
 * 不碰 DOM:调用方把块在视口里的矩形量好递进来,这里只算「参考线落在哪一块、块内几分之几」
 * 和「另一栏要把同一块同一比例挪到参考线,需要滚多少」。
 */

export interface BlockRect {
  /** 块号(原文译文共用) */
  index: number
  /** 块顶在视口里的 y */
  top: number
  /** 块高(px) */
  height: number
}

export interface ScrollAnchor {
  index: number
  /** 参考线在块内的纵向比例,0 = 块顶,1 = 块底 */
  fraction: number
}

function fractionOf(rect: BlockRect, y: number): number {
  if (rect.height <= 0) return 0
  const f = (y - rect.top) / rect.height
  return Math.max(0, Math.min(1, f))
}

/** 参考线落在哪一块:落在块与块的缝里,取纵向最近的一块,比例夹到端点 */
export function anchorAt(rects: readonly BlockRect[], y: number): ScrollAnchor | null {
  if (rects.length === 0) return null
  let best: BlockRect | null = null
  let bestGap = Number.POSITIVE_INFINITY
  for (const rect of rects) {
    const bottom = rect.top + rect.height
    const gap = y < rect.top ? rect.top - y : y > bottom ? y - bottom : 0
    if (gap < bestGap) {
      bestGap = gap
      best = rect
      if (gap === 0) break
    }
  }
  if (best === null) return null
  return { index: best.index, fraction: fractionOf(best, y) }
}

/** 视口顶兜底:取第一块底边越过顶线的块;顶线在所有块上方取第一块,下方取最后一块 */
export function topAnchor(rects: readonly BlockRect[], viewportTop: number): ScrollAnchor | null {
  if (rects.length === 0) return null
  const first = rects[0]
  if (viewportTop < first.top) return { index: first.index, fraction: 0 }
  for (const rect of rects) {
    if (rect.top + rect.height > viewportTop) {
      return { index: rect.index, fraction: fractionOf(rect, viewportTop) }
    }
  }
  const last = rects[rects.length - 1]
  return { index: last.index, fraction: 1 }
}

/** 让另一栏的同一块、同一比例落到参考线 refY,相对它当前 scrollTop 的增量 */
export function alignDelta(input: {
  fraction: number
  peerTop: number
  peerHeight: number
  refY: number
}): number {
  return input.peerTop + input.fraction * input.peerHeight - input.refY
}

/** 滚动位置夹到容器的可滚范围 */
export function clampScroll(top: number, max: number): number {
  return Math.max(0, Math.min(top, Math.max(0, max)))
}
