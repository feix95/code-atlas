// ── 第一百一十四锤:选区的几何账(纯函数,自测覆盖)──
// 选中一段代码之后,界面上要落三样东西:首标记、末标记、左缘竖线。
// 位置全从「选区每一行的矩形」算出来 —— 这里只管算,不碰 DOM,也不碰 React。
// (浮钮已随折行版退役,buttonX/buttonY 字段保留,免得拆几何账的形状。)

/** 只取用得到的四个边(DOMPoint/DOMRect 结构上都满足它) */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface SelectionGeometry {
  /** 包围盒右上角(浮钮时代的锚点;浮钮退役后字段保留,几何账形状不动) */
  buttonX: number
  buttonY: number
  /** 首标记:第一行的左侧,垂直居中于那一行 */
  startX: number
  startY: number
  /** 末标记:最后一行的右侧 */
  endX: number
  endY: number
  /** 左缘竖线:从第一行顶贯到最后一行底 */
  barLeft: number
  barTop: number
  barHeight: number
}

/**
 * 选区的每一行矩形 → 三样东西的落点(纯函数,自测覆盖)。
 * rects 是 range.getClientRects() 的产物:一行一个,顺序就是文档顺序。
 * 一行都没有(选了个空)时回 null,让调用方清场。
 *
 * 首尾标记各认自己那一行(末标记要看最后一行的右边,不是包围盒的右边);
 * 左缘竖线认所有行矩形的最左缘 —— 折行后首行常从行中起选,取第一行左缘
 * 会把竖线画进正文中间;取最小左缘,竖线才永远贴着选区真正的左边界。
 */
export function selectionGeometry(rects: Rect[]): SelectionGeometry | null {
  const first = rects[0]
  const last = rects[rects.length - 1]
  if (!first || !last) return null
  return {
    buttonX: Math.max(...rects.map((r) => r.right)),
    buttonY: Math.min(...rects.map((r) => r.top)),
    startX: first.left,
    startY: (first.top + first.bottom) / 2,
    endX: last.right,
    endY: (last.top + last.bottom) / 2,
    barLeft: Math.min(...rects.map((r) => r.left)),
    barTop: first.top,
    barHeight: Math.max(last.bottom - first.top, 2)
  }
}

/**
 * 引用菜单项上写什么(纯函数,自测覆盖;当年是浮钮文案,浮钮退役后归右键菜单):
 * 额度满了说额度,选得太长就照实说会截断 —— Ctrl+A 全选整个文件太容易了,不说清就等于骗人。
 */
export function refButtonLabel(input: {
  canAddRef: boolean
  refLimit: number
  charCap: number
  startLine: number
  endLine: number
  charCount: number
}): string {
  if (!input.canAddRef) return `最多引用 ${input.refLimit} 段`
  const range = `第 ${input.startLine}-${input.endLine} 行`
  if (input.charCount > input.charCap)
    return `引用到对话(${range} · 太长,只带前 ${input.charCap} 字)`
  return `引用到对话(${range})`
}
