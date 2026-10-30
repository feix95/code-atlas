// 浮窗摆放账的通用几何(纯函数,自测覆盖):位置按「离宿主右上角多远」记(right/top,px),
// 尺寸 null = 用 CSS 给的默认宽高;用户拖过、拉过才有数。读回来的旧账先验身,
// 每次上屏都按当前宿主的大小夹一遍 —— 窗口变小、换了屏,浮窗都不会跑出宿主外。
// 大纲浮窗与图谱节点详情浮窗共用这一套;内容尺寸吸附、收起态这些各自留在自己的模块里。

export interface FloatPlacement {
  /** 浮窗右缘离宿主右缘的距离;null = 用 CSS 的默认落点 */
  right: number | null
  /** 浮窗上缘离宿主上缘的距离;null = 用 CSS 的默认落点 */
  top: number | null
  /** 手动拉出来的宽/高;null = 用 CSS 的默认宽高 */
  width: number | null
  height: number | null
}

export const DEFAULT_PLACEMENT: FloatPlacement = {
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

/** 当前宿主能给浮窗的活动范围(由实测几何算出) */
export interface FloatBounds {
  minRight: number
  maxRight: number
  /** 上缘下限:宿主让出的顶边(顶栏、拖动条之类),浮窗不压上去 */
  minTop: number
  maxTop: number
  /** top 没记过时的落点:默认贴宿主右上角,也压回活动范围内 */
  defaultTop: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  /** 从宿主右缘量到左缘(减去缝):right + width 不能超过它(也是拉伸时左缘的钉点) */
  reachLeft: number
  /** 从宿主上缘量到底边(减去缝):top + height 不能超过它 */
  reachDown: number
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function positiveOrNull(v: unknown): number | null {
  const n = finiteOrNull(v)
  return n !== null && n > 0 ? n : null
}

/** localStorage 里的旧账验身:缺字段、坏类型一律回默认档对应的 null */
export function parseFloatPlacement(raw: unknown): FloatPlacement {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PLACEMENT
  const rec = raw as Record<string, unknown>
  return {
    right: finiteOrNull(rec.right),
    top: finiteOrNull(rec.top),
    width: positiveOrNull(rec.width),
    height: positiveOrNull(rec.height)
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

/**
 * 按活动范围夹一遍,并把「默认」展开成实数(right/top 一定有值,宽高 null 仍是默认档)。
 * 手动宽高先夹,再按夹好的尺寸算 right/top 的上限 —— 拉伸途中 bounds 还是开拉时量的旧尺寸,
 * 不能拿旧宽度去夹新位置;老版本存下的账同样按这条规则夹回范围内。
 * 这里不管内容尺寸:拉伸途中宽高要能跟着鼠标走,内容尺寸只在松手和上屏时生效。
 */
export function clampPlacement(
  p: FloatPlacement,
  b: FloatBounds
): FloatPlacement & { right: number; top: number } {
  const width = p.width === null ? null : clamp(p.width, b.minWidth, b.maxWidth)
  const height = p.height === null ? null : clamp(p.height, b.minHeight, b.maxHeight)
  const maxRight = width === null ? b.maxRight : Math.max(b.minRight, b.reachLeft - width)
  const maxTop = height === null ? b.maxTop : Math.max(b.minTop, b.reachDown - height)
  return {
    right: clamp(p.right ?? b.minRight, b.minRight, maxRight),
    top: clamp(p.top ?? b.defaultTop, b.minTop, maxTop),
    width,
    height
  }
}

/** 抓手拖动/方向键挪动:屏幕右移 = right 变小,下移 = top 变大 */
export function movePlacement(
  start: FloatPlacement & { right: number; top: number },
  dx: number,
  dy: number,
  b: FloatBounds
): FloatPlacement & { right: number; top: number } {
  return clampPlacement({ ...start, right: start.right - dx, top: start.top + dy }, b)
}

/**
 * 右下角拉手改尺寸:左上角钉住不动 —— 往右拉变宽、往下拉变高,拉不出宿主右缘和底边。
 * from 是开拉那一刻的实测宽高(默认档也有真尺寸)。某个方向一点没动(比如方向键只按了上下)
 * 就保留那一维原来的账,默认宽高不会因为只调了另一维就被钉死。
 */
export function resizePlacement(
  start: FloatPlacement,
  from: { width: number; height: number },
  dx: number,
  dy: number,
  b: FloatBounds
): FloatPlacement {
  const at = clampPlacement(start, b)
  // 左缘离宿主右缘的距离 = right + width,拉伸全程不变
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

/** 两套活动范围是否一致(0.5px 内算一样;Infinity 减自己是 NaN,先比全等) */
export function sameFloatBounds(a: FloatBounds | null, b: FloatBounds | null): boolean {
  if (a === null || b === null) return a === b
  return (Object.keys(a) as Array<keyof FloatBounds>).every(
    (k) => a[k] === b[k] || Math.abs(a[k] - b[k]) < 0.5
  )
}

// 内容尺寸账:浮窗大过内容只会多出空白。宽高各自记一个「内容尺寸」(fit)与「自适应档上限」(autoMax),
// 拉大松手吸回内容尺寸;自适应档装得下就回自适应,装不下才记成手动数。大纲与图谱详情共用。

/** 松手时离内容宽/高不到这么多 px 也算「拉满了」,吸回内容尺寸 */
export const SNAP_SLACK_PX = 4

export interface FitBounds extends FloatBounds {
  /** 内容宽:露出内容全文所需的宽度(已夹进 minWidth~maxWidth) */
  fitWidth: number
  /** 自适应档 CSS 给的宽度上限;内容宽超过它时,吸附只能落成手动的内容宽 */
  autoMaxWidth: number
  /** 内容高:放下全部内容所需的高度(已夹进 minHeight~maxHeight) */
  fitHeight: number
  /** 自适应档 CSS 给的高度上限;内容高超过它时,吸附落成手动的内容高 */
  autoMaxHeight: number
}

/** 某一维落到内容尺寸时记成什么:自适应档装得下就回自适应(内容变了还会跟着变),装不下才记手动数 */
function fittedSize(fit: number, autoMax: number): number | null {
  return fit <= autoMax + 0.5 ? null : fit
}

function capAxis(size: number | null, fit: number, autoMax: number): number | null {
  return size === null || size <= fit ? size : fittedSize(fit, autoMax)
}

/**
 * 上屏前的内容尺寸上限:记下的手动宽/高比当前内容还大(换了内容、栏变小),
 * 就收到内容尺寸。右缘、上缘位置不动。
 */
export function capToContent(p: FloatPlacement, b: FitBounds): FloatPlacement {
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
 * 比内容尺寸小的那一维照原样保留(长内容走省略号、列表出滚动条)。
 */
export function settleResize(p: FloatPlacement, b: FitBounds): FloatPlacement {
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
  settled: FloatPlacement,
  last: FloatPlacement,
  b: FitBounds
): FloatPlacement {
  return {
    ...settled,
    width: settled.width === null && last.width !== null ? b.fitWidth : settled.width,
    height: settled.height === null && last.height !== null ? b.fitHeight : settled.height
  }
}
