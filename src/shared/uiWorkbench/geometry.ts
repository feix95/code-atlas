// 设计坐标下的几何纯计算:旋转矩形的坐标换算、命中、拖框、圆角与旋转手势换算。
// 坐标系:画板左上角为原点,x 向右、y 向下;角度顺时针为正(atan2 在 y 向下坐标系里天然顺时针递增)。
import { maxCornerRadius, type CornerIndex, type EdgeName, type RectNode } from './node.ts'

export interface Point {
  x: number
  y: number
}

export type RectBox = Pick<RectNode, 'x' | 'y' | 'width' | 'height'>
type Shape = RectBox & Pick<RectNode, 'rotation'>

const DEG = Math.PI / 180

export function rectCenter(r: RectBox): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

export function rotatePoint(p: Point, deg: number): Point {
  const cos = Math.cos(deg * DEG)
  const sin = Math.sin(deg * DEG)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/** 设计点 → 矩形自身坐标(未旋转的框内坐标,原点为框左上角) */
export function toLocal(r: Shape, p: Point): Point {
  const c = rectCenter(r)
  const q = rotatePoint({ x: p.x - c.x, y: p.y - c.y }, -r.rotation)
  return { x: q.x + r.width / 2, y: q.y + r.height / 2 }
}

/** 矩形自身坐标 → 设计点 */
export function toWorld(r: Shape, local: Point): Point {
  const c = rectCenter(r)
  const q = rotatePoint({ x: local.x - r.width / 2, y: local.y - r.height / 2 }, r.rotation)
  return { x: q.x + c.x, y: q.y + c.y }
}

/** 四角的框内坐标,顺序 左上 右上 右下 左下 */
export function cornerLocal(r: RectBox, corner: CornerIndex): Point {
  return {
    x: corner === 1 || corner === 2 ? r.width : 0,
    y: corner === 2 || corner === 3 ? r.height : 0
  }
}

/** 角朝框内的方向(单位轴向):左上 (+,+)、右上 (−,+)、右下 (−,−)、左下 (+,−) */
function inwardSign(corner: CornerIndex): Point {
  return { x: corner === 1 || corner === 2 ? -1 : 1, y: corner === 2 || corner === 3 ? -1 : 1 }
}

export function hitRect(r: Shape, p: Point): boolean {
  const q = toLocal(r, p)
  return q.x >= 0 && q.y >= 0 && q.x <= r.width && q.y <= r.height
}

/** 框选相交判定(SAT 分离轴):选框(轴对齐)扫到矩形任意部分即中,旋转矩形同样适用;
 *  只比较四对投影轴(选框两根 + 矩形自身两根),任一根上投影不相交即未命中 */
export function rectOverlapsBox(r: Shape, box: RectBox): boolean {
  const rad = r.rotation * DEG
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: Math.cos(rad), y: Math.sin(rad) },
    { x: -Math.sin(rad), y: Math.cos(rad) }
  ]
  const corners = [0, 1, 2, 3].map((c) => toWorld(r, cornerLocal(r, c as CornerIndex)))
  const boxCorners: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height }
  ]
  const project = (axis: Point, pts: Point[]): [number, number] => {
    let lo = Infinity
    let hi = -Infinity
    for (const p of pts) {
      const d = p.x * axis.x + p.y * axis.y
      if (d < lo) lo = d
      if (d > hi) hi = d
    }
    return [lo, hi]
  }
  return axes.every((axis) => {
    const [aLo, aHi] = project(axis, corners)
    const [bLo, bHi] = project(axis, boxCorners)
    return aLo <= bHi && bLo <= aHi
  })
}

/** 拖框:Shift 正方形,Alt 从中心向外;结果取整、边长至少 1 */
export function rectFromDrag(
  start: Point,
  end: Point,
  mods: { isSquare: boolean; isFromCenter: boolean }
): RectBox {
  let dx = end.x - start.x
  let dy = end.y - start.y
  if (mods.isSquare) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * side
    dy = Math.sign(dy || 1) * side
  }
  const w = mods.isFromCenter ? Math.abs(dx) * 2 : Math.abs(dx)
  const h = mods.isFromCenter ? Math.abs(dy) * 2 : Math.abs(dy)
  const x = mods.isFromCenter ? start.x - Math.abs(dx) : Math.min(start.x, start.x + dx)
  const y = mods.isFromCenter ? start.y - Math.abs(dy) : Math.min(start.y, start.y + dy)
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h))
  }
}

/** 圆角手柄的框内位置:落在圆角圆心(距角 r),至少内缩 minInset,至多到短边一半 */
export function radiusHandleLocal(
  r: RectBox,
  corner: CornerIndex,
  radius: number,
  minInset: number
): Point {
  const inset = Math.min(Math.max(radius, minInset), Math.min(r.width, r.height) / 2)
  const c = cornerLocal(r, corner)
  const s = inwardSign(corner)
  return { x: c.x + s.x * inset, y: c.y + s.y * inset }
}

/** 拖圆角手柄:指针在框内沿该角对角线向内的投影 = 半径,钳到 [0, 短边一半] */
export function radiusFromLocal(r: RectBox, corner: CornerIndex, local: Point): number {
  const c = cornerLocal(r, corner)
  const s = inwardSign(corner)
  const along = ((local.x - c.x) * s.x + (local.y - c.y) * s.y) / 2
  return Math.min(maxCornerRadius(r.width, r.height), Math.max(0, Math.round(along)))
}

/** 对角的序号:左上↔右下、右上↔左下 */
const OPPOSITE_CORNER: readonly CornerIndex[] = [2, 3, 0, 1]

/** 角缩放:对角色点当锚点(世界坐标不动),指针落在本地坐标里定新宽高;
 *  拖过锚点即向另一侧翻转。旋转矩形沿自身轴缩放;isProportional 按原宽高比统一缩放;
 *  结果取整、边长至少 1 */
export function resizeRect(
  r: Shape,
  corner: CornerIndex,
  local: Point,
  isProportional = false
): Shape {
  const fixed = cornerLocal(r, OPPOSITE_CORNER[corner])
  let w = Math.abs(local.x - fixed.x)
  let h = Math.abs(local.y - fixed.y)
  if (isProportional) {
    const scale = Math.max(w / r.width, h / r.height)
    w = r.width * scale
    h = r.height * scale
  }
  const width = Math.max(1, Math.round(w))
  const height = Math.max(1, Math.round(h))
  const fixedWorld = toWorld(r, fixed)
  const ghost = { ...r, width, height }
  const anchor = cornerLocal(ghost, OPPOSITE_CORNER[corner])
  // fixedWorld = 新中心 + rotate(锚点本地坐标 - 半边长);反解新中心即得 x/y
  const off = rotatePoint({ x: anchor.x - width / 2, y: anchor.y - height / 2 }, r.rotation)
  return {
    ...ghost,
    x: Math.round(fixedWorld.x - off.x - width / 2),
    y: Math.round(fixedWorld.y - off.y - height / 2)
  }
}

/** 边中点拖拽(单边缩放,PS/Figma 变换框同款):只动被拖那条边,对边中点当锚(世界坐标不动),
 *  旋转矩形沿自身法线量距;拖过对边按镜像尺寸继续(不翻转);snapStep>0 时边长吸网格;
 *  结果取整、边长至少 1 */
export function resizeRectEdge(r: Shape, edge: EdgeName, local: Point, snapStep = 0): Shape {
  const horizontal = edge === 'left' || edge === 'right'
  // 被拖边到对边的距离 = 新边长;左边/上边以对边为原点反量
  let size = horizontal
    ? Math.abs(local.x - (edge === 'left' ? r.width : 0))
    : Math.abs(local.y - (edge === 'top' ? r.height : 0))
  if (snapStep > 0) size = snapValue(size, snapStep)
  const width = horizontal ? Math.max(1, Math.round(size)) : r.width
  const height = horizontal ? r.height : Math.max(1, Math.round(size))
  // 对边中点在世界坐标里钉死:新框沿法线方向从锚点反向铺开
  const anchorLocal: Point = {
    x: edge === 'right' ? 0 : edge === 'left' ? r.width : r.width / 2,
    y: edge === 'bottom' ? 0 : edge === 'top' ? r.height : r.height / 2
  }
  const anchorGhost: Point = {
    x: edge === 'right' ? 0 : edge === 'left' ? width : width / 2,
    y: edge === 'bottom' ? 0 : edge === 'top' ? height : height / 2
  }
  const fixedWorld = toWorld(r, anchorLocal)
  const off = rotatePoint(
    { x: anchorGhost.x - width / 2, y: anchorGhost.y - height / 2 },
    r.rotation
  )
  return {
    ...r,
    width,
    height,
    x: Math.round(fixedWorld.x - off.x - width / 2),
    y: Math.round(fixedWorld.y - off.y - height / 2)
  }
}

/** 从 center 指向 p 的角度(度,顺时针为正) */
export function angleDeg(center: Point, p: Point): number {
  return Math.atan2(p.y - center.y, p.x - center.x) / DEG
}

export function snapAngle(deg: number, step: number): number {
  return Math.round(deg / step) * step
}

/** 通用数值吸附:取到最近的 step 倍数(角度之外的数值也用同一套 Shift=吸附 约定) */
export function snapValue(v: number, step: number): number {
  return Math.round(v / step) * step
}
