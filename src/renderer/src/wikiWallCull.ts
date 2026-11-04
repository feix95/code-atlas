// 线索桌近景的视口裁剪:纯函数。近景一屏只看得见十几张卡,却要挂几百张卡、几百条线;
// 只挂「视口四周各多留一屏」范围里的,拖动平移时边上早已备好,不会露出空白。
// 裁剪只管画哪些:看全部、卡片位置、线两端、岛的范围照旧用全部卡算。
import type { WallRect } from '../../shared/wikiWallNotes.ts'
import type { WallView } from './wikiWallViewport.ts'

export type { WallRect }

/** 每边多留几屏:平移时边上提前备好 */
export const WALL_CULL_OVERSCAN = 1
/** 视口外的余量剩不到这么多屏就重算(回滞:小幅来回拖不反复挂卸) */
export const WALL_CULL_KEEP = 0.5
/** 放大后备好的范围比该有的大出这么多倍,才收窄重算 */
const WALL_CULL_SHRINK = 2

/** 视口在板面坐标里的范围 */
export function wallViewRect(view: WallView, width: number, height: number): WallRect {
  return { x: -view.x / view.z, y: -view.y / view.z, w: width / view.z, h: height / view.z }
}

/** 四周各扩出 k 倍宽高 */
export function expandWallRect(r: WallRect, k: number): WallRect {
  return { x: r.x - r.w * k, y: r.y - r.h * k, w: r.w * (1 + 2 * k), h: r.h * (1 + 2 * k) }
}

export function wallRectsTouch(a: WallRect, b: WallRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

function contains(outer: WallRect, inner: WallRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

/**
 * 下一份裁剪范围。视口连同 KEEP 余量仍在旧范围里、旧范围也没大出太多,就原样返回旧的
 * (同一个对象,调用方据此跳过重画);否则以视口为中心、四周各扩 OVERSCAN 屏重来
 */
export function nextWallCullRect(prev: WallRect | null, viewRect: WallRect): WallRect {
  if (
    prev !== null &&
    contains(prev, expandWallRect(viewRect, WALL_CULL_KEEP)) &&
    prev.w <= viewRect.w * (1 + 2 * WALL_CULL_OVERSCAN) * WALL_CULL_SHRINK
  )
    return prev
  return expandWallRect(viewRect, WALL_CULL_OVERSCAN)
}

/** 线绳是否碰到范围:二次曲线总在起点、控制点、终点围成的框里,框碰到就画(宁多勿漏) */
export function wallLineTouches(
  line: { x1: number; y1: number; x2: number; y2: number; cx: number; cy: number },
  r: WallRect
): boolean {
  const x = Math.min(line.x1, line.x2, line.cx)
  const y = Math.min(line.y1, line.y2, line.cy)
  const box = {
    x,
    y,
    w: Math.max(line.x1, line.x2, line.cx) - x,
    h: Math.max(line.y1, line.y2, line.cy) - y
  }
  return wallRectsTouch(box, r)
}
