// 大纲浮窗的摆放账(纯函数,自测覆盖):位置按「离预览栏右上角多远」记(right/top,px),
// 尺寸 null = 跟着内容自适应;用户拖过、拉过才有数。读回来的旧账先验身,
// 每次上屏都按当前预览栏的大小夹一遍 —— 窗口变小、换了屏,浮窗都不会跑出栏外。
// 宽高另有一条上限「内容尺寸」:刚好露出最长标题全文的宽、刚好放下全部条目的高,再大只会多出空白。

export interface OutlinePlacement {
  /** 浮窗右缘离停靠坞右缘的距离;null = 默认贴右上角 */
  right: number | null
  /** 浮窗上缘离停靠坞上缘的距离;null = 默认贴右上角 */
  top: number | null
  /** 手动拉出来的宽/高;null = 跟着内容自适应 */
  width: number | null
  height: number | null
}

export const DEFAULT_PLACEMENT: OutlinePlacement = {
  right: null,
  top: null,
  width: null,
  height: null
}

/** 按下后挪动够这么多 px 才算开拖;不到就是「点一下」(收起态的圆钮靠它分清点开与拖动) */
export const DRAG_START_PX = 4

export function isDragStarted(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_START_PX
}

/** 松手时离内容宽/高不到这么多 px 也算「拉满了」,吸回自适应 */
export const SNAP_SLACK_PX = 4

/** 当前预览栏能给浮窗的活动范围(由实测几何算出) */
export interface OutlineBounds {
  minRight: number
  maxRight: number
  minTop: number
  maxTop: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  /** 从坞右缘量到栏左缘(减去缝):right + width 不能超过它(也是拉伸时左缘的钉点) */
  reachLeft: number
  /** 从坞上缘量到栏底(减去缝):top + height 不能超过它 */
  reachDown: number
  /** 内容宽:露出最长标题全文所需的宽度(已夹进 minWidth~maxWidth);量不到时 = maxWidth */
  fitWidth: number
  /** 自适应档 CSS 给的宽度上限;内容宽超过它时,吸附只能落成手动的内容宽 */
  autoMaxWidth: number
  /** 内容高:放下全部条目所需的高度(已夹进 minHeight~maxHeight);量不到时 = maxHeight */
  fitHeight: number
  /** 自适应档 CSS 给的高度上限;内容高超过它时,吸附落成手动的内容高 */
  autoMaxHeight: number
}

type Size = { width: number; height: number }

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function positiveOrNull(v: unknown): number | null {
  const n = finiteOrNull(v)
  return n !== null && n > 0 ? n : null
}

/** localStorage 里的旧账验身:缺字段、坏类型一律回默认档对应的 null */
export function parseOutlinePlacement(raw: unknown): OutlinePlacement {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PLACEMENT
  const rec = raw as Record<string, unknown>
  return {
    right: finiteOrNull(rec.right),
    top: finiteOrNull(rec.top),
    width: positiveOrNull(rec.width),
    height: positiveOrNull(rec.height)
  }
}

/**
 * 活动范围:view = 预览栏可视区(不含滚动条),dock = 停靠坞,panel = 浮窗当前大小,
 * gap = 离栏边留的缝,min = 浮窗的最小宽高(CSS 里登记的那一档),
 * natural = 实测内容宽高(null = 没量到,不设上限),autoMax = 自适应档的宽高上限,
 * reserveTop = 浮窗上缘之上要留的高度(展开态悬停时长在上面的拖动条、收起态圆钮的上移量),
 * reserveRight = 右缘之外要留的宽度(收起态圆钮的外移量),不让它们被栏边裁掉;
 * knob = 收起态圆钮的视觉位移(外移 shift、上移 lift),位置上限也外推同样的量,圆钮才贴得到栏左与栏底。
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
}): OutlineBounds {
  const minRight = g.dock.right - g.view.right + g.gap + (g.reserveRight ?? 0)
  const minTop = g.view.top - g.dock.top + g.gap + g.reserveTop
  const roomW = g.view.right - g.view.left - 2 * g.gap
  const roomH = g.view.bottom - g.view.top - 2 * g.gap - g.reserveTop
  const reachLeft = g.dock.right - g.view.left - g.gap
  const reachDown = g.view.bottom - g.dock.top - g.gap
  const maxWidth = Math.max(g.min.width, roomW)
  const maxHeight = Math.max(g.min.height, roomH)
  return {
    minRight,
    maxRight: Math.max(minRight, reachLeft - g.panel.width + (g.knob?.shift ?? 0)),
    minTop,
    maxTop: Math.max(minTop, reachDown - g.panel.height + (g.knob?.lift ?? 0)),
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
 * 按活动范围夹一遍,并把「默认」展开成实数(right/top 一定有值,宽高 null 仍是自适应)。
 * 手动宽高先夹,再按夹好的尺寸算 right/top 的上限 —— 拉伸途中 bounds 还是开拉时量的旧尺寸,
 * 不能拿旧宽度去夹新位置;老版本存下的账(当时右上角钉住)同样按这条规则夹回栏内。
 * 这里不管内容尺寸:拉伸途中宽高要能跟着鼠标走,内容尺寸只在松手和上屏时生效。
 */
export function clampPlacement(
  p: OutlinePlacement,
  b: OutlineBounds
): OutlinePlacement & { right: number; top: number } {
  const width = p.width === null ? null : clamp(p.width, b.minWidth, b.maxWidth)
  const height = p.height === null ? null : clamp(p.height, b.minHeight, b.maxHeight)
  const maxRight = width === null ? b.maxRight : Math.max(b.minRight, b.reachLeft - width)
  const maxTop = height === null ? b.maxTop : Math.max(b.minTop, b.reachDown - height)
  return {
    right: clamp(p.right ?? b.minRight, b.minRight, maxRight),
    top: clamp(p.top ?? b.minTop, b.minTop, maxTop),
    width,
    height
  }
}

/**
 * 收起态的夹边:此时浮窗只剩开关钮那么大的正圆,存下的展开宽高只是「展开时用多大」的偏好,
 * 不能拿来量位置 —— 按展开宽度算,圆钮走到「那块的左缘」就被拦住,到不了栏边。
 * 位置按实测的圆钮尺寸夹(b.maxRight/maxTop 就是按屏上这块算的),宽高原样带回,展开时照旧用。
 */
export function clampCollapsed(
  p: OutlinePlacement,
  b: OutlineBounds
): OutlinePlacement & { right: number; top: number } {
  return {
    ...clampPlacement({ ...p, width: null, height: null }, b),
    width: p.width,
    height: p.height
  }
}

/** 某一维落到内容尺寸时记成什么:自适应档装得下就回自适应(换文档还会跟着内容变),装不下才记手动数 */
function fittedSize(fit: number, autoMax: number): number | null {
  return fit <= autoMax + 0.5 ? null : fit
}

function capAxis(size: number | null, fit: number, autoMax: number): number | null {
  return size === null || size <= fit ? size : fittedSize(fit, autoMax)
}

/**
 * 上屏前的内容尺寸上限:记下的手动宽/高比当前文档的内容宽/高还大(换了标题更短、更少的文档,
 * 栏变小),就收到内容尺寸。右缘、上缘位置不动。
 */
export function capToContent(p: OutlinePlacement, b: OutlineBounds): OutlinePlacement {
  return {
    ...p,
    width: capAxis(p.width, b.fitWidth, b.autoMaxWidth),
    height: capAxis(p.height, b.fitHeight, b.autoMaxHeight)
  }
}

function reachesFit(size: number | null, fit: number): size is number {
  return size !== null && size >= fit - SNAP_SLACK_PX
}

/**
 * 拉伸松手:宽或高拉到(或超过)内容尺寸就吸回内容尺寸,左上角钉住不动(右缘跟着收回来);
 * 比内容尺寸小的那一维照原样保留(长标题走省略号、列表出滚动条)。
 */
export function settleResize(p: OutlinePlacement, b: OutlineBounds): OutlinePlacement {
  const snapWidth = reachesFit(p.width, b.fitWidth)
  const snapHeight = reachesFit(p.height, b.fitHeight)
  const right =
    snapWidth && p.right !== null && p.width !== null ? p.right + p.width - b.fitWidth : p.right
  return {
    ...p,
    right,
    width: snapWidth ? fittedSize(b.fitWidth, b.autoMaxWidth) : p.width,
    height: snapHeight ? fittedSize(b.fitHeight, b.autoMaxHeight) : p.height
  }
}

/**
 * 吸回动画的落点:被吸回自适应(null)的那一维先以内容尺寸的像素值上屏,CSS 才过渡得过去
 * (过渡不了 max-content);没吸的维度照 settled 原样。
 */
export function snapFrame(
  settled: OutlinePlacement,
  last: OutlinePlacement,
  b: OutlineBounds
): OutlinePlacement {
  return {
    ...settled,
    width: settled.width === null && last.width !== null ? b.fitWidth : settled.width,
    height: settled.height === null && last.height !== null ? b.fitHeight : settled.height
  }
}

/** 抓手拖动/方向键挪动:屏幕右移 = right 变小,下移 = top 变大 */
export function movePlacement(
  start: OutlinePlacement & { right: number; top: number },
  dx: number,
  dy: number,
  b: OutlineBounds
): OutlinePlacement {
  return clampPlacement({ ...start, right: start.right - dx, top: start.top + dy }, b)
}

/** 收起态拖动/方向键挪动:夹边跟 clampCollapsed 同一个道理,存的展开宽高原样带回 */
export function moveCollapsed(
  start: OutlinePlacement & { right: number; top: number },
  dx: number,
  dy: number,
  b: OutlineBounds
): OutlinePlacement {
  const moved = movePlacement({ ...start, width: null, height: null }, dx, dy, b)
  return { ...moved, width: start.width, height: start.height }
}

/**
 * 右下角拉手改尺寸:左上角钉住不动 —— 往右拉变宽、往下拉变高,拉不出栏右缘和栏底。
 * from 是开拉那一刻的实测宽高(自适应态也有真尺寸)。某个方向一点没动(比如方向键只按了上下)
 * 就保留那一维原来的账,自适应宽度不会因为只调了高度就被钉死。拉的途中宽度不受内容宽限制,
 * 松手再由 settleResize 吸回。
 */
export function resizePlacement(
  start: OutlinePlacement,
  from: { width: number; height: number },
  dx: number,
  dy: number,
  b: OutlineBounds
): OutlinePlacement {
  const at = clampPlacement(start, b)
  // 左缘离坞右缘的距离 = right + width,拉伸全程不变
  const anchor = at.right + from.width
  const width =
    dx === 0
      ? at.width
      : clamp(from.width + dx, b.minWidth, Math.min(b.maxWidth, anchor - b.minRight))
  const height =
    dy === 0
      ? at.height
      : clamp(from.height + dy, b.minHeight, Math.min(b.maxHeight, b.reachDown - at.top))
  const right = anchor - (width ?? from.width)
  return clampPlacement({ right, top: at.top, width, height }, b)
}
