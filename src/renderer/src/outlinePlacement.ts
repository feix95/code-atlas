// 文档大纲浮窗的内容尺寸账(通用摆放几何见 floatPlacement):宽高另有一条上限「内容尺寸」,
// 刚好露出最长标题全文的宽、刚好放下全部条目的高,再大只会多出空白。
// 收起时浮窗只剩圆钮,位置按圆钮的实际大小夹。

import {
  clampPlacement,
  movePlacement,
  type FitBounds,
  type FloatBounds,
  type FloatPlacement
} from './floatPlacement.ts'

type Size = { width: number; height: number }

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 活动范围:view = 预览栏可视区(不含滚动条),dock = 贴在预览面板顶端的停靠坞,
 * panel = 浮窗当前大小,gap = 离面板边留的缝,min = 浮窗的最小宽高(CSS 里登记的那一档),
 * natural = 实测内容宽高(null = 没量到,不设上限),autoMax = 自适应档的宽高上限,
 * reserveTop = 浮窗上缘之上要留的高度(展开态悬停时长在上面的拖动条、收起态圆钮的上移量),
 * reserveRight = 右缘之外要留的宽度(收起态圆钮的外移量),不让它们被面板边裁掉;
 * knob = 收起态圆钮的视觉位移(外移 shift、上移 lift),位置上限也外推同样的量,圆钮才贴得到面板左缘与栏底。
 * 上缘下限取面板顶(页头也在活动范围里);下缘、左缘仍以阅读栏为准。
 */
export function outlineBounds(g: {
  view: Box
  dock: Box
  panel: Size
  gap: number
  min: Size
  natural: { width: number | null; height: number | null }
  autoMax: Size
  reserveTop: number
  reserveRight?: number
  knob?: { shift: number; lift: number }
}): FitBounds {
  const minRight = g.dock.right - g.view.right + g.gap + (g.reserveRight ?? 0)
  const minTop = g.gap + g.reserveTop
  // 没拖过仍落在阅读栏右上角;栏顶随页头高低走,不跟着下限一起上抬
  const defaultTop = g.view.top - g.dock.top + g.gap + g.reserveTop
  const roomW = g.view.right - g.view.left - 2 * g.gap
  const roomH = g.view.bottom - g.dock.top - 2 * g.gap - g.reserveTop
  const reachLeft = g.dock.right - g.view.left - g.gap
  const reachDown = g.view.bottom - g.dock.top - g.gap
  const maxWidth = Math.max(g.min.width, roomW)
  const maxHeight = Math.max(g.min.height, roomH)
  return {
    minRight,
    maxRight: Math.max(minRight, reachLeft - g.panel.width + (g.knob?.shift ?? 0)),
    minTop,
    maxTop: Math.max(minTop, reachDown - g.panel.height + (g.knob?.lift ?? 0)),
    defaultTop,
    minWidth: g.min.width,
    maxWidth,
    minHeight: g.min.height,
    maxHeight,
    reachLeft,
    reachDown,
    fitWidth: fitWithin(g.natural.width, g.min.width, maxWidth),
    autoMaxWidth: g.autoMax.width,
    fitHeight: fitWithin(g.natural.height, g.min.height, maxHeight),
    autoMaxHeight: g.autoMax.height
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

function fitWithin(natural: number | null, lo: number, hi: number): number {
  return natural === null ? hi : clamp(natural, lo, hi)
}

/**
 * 收起态的夹边:此时浮窗只剩开关钮那么大的正圆,存下的展开宽高只是「展开时用多大」的偏好,
 * 不能拿来量位置 —— 按展开宽度算,圆钮走到「那块的左缘」就被拦住,到不了栏边。
 * 位置按实测的圆钮尺寸夹(b.maxRight/maxTop 就是按屏上这块算的),宽高原样带回,展开时照旧用。
 */
export function clampCollapsed(
  p: FloatPlacement,
  b: FloatBounds
): FloatPlacement & { right: number; top: number } {
  return {
    ...clampPlacement({ ...p, width: null, height: null }, b),
    width: p.width,
    height: p.height
  }
}

/** 收起态拖动/方向键挪动:夹边跟 clampCollapsed 同一个道理,存的展开宽高原样带回 */
export function moveCollapsed(
  start: FloatPlacement & { right: number; top: number },
  dx: number,
  dy: number,
  b: FloatBounds
): FloatPlacement {
  const moved = movePlacement({ ...start, width: null, height: null }, dx, dy, b)
  return { ...moved, width: start.width, height: start.height }
}
