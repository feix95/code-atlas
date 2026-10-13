// 多选整体缩放(纯逻辑,无 React / DOM):PS / Figma 的变换框。
// 多个对象的联合外接框当作一个整体:拖 8 个手柄之一得到新的联合框,
// 每个对象按「旧联合框 → 新联合框」的仿射映射(位置与尺寸等比例换算)落位。
// 约定:Shift = 等比;Alt = 以中心为锚(对称缩放);缩到极限只会收成 MIN_SIZE,不翻转。
// 圆角半径、描边宽度不随缩放变(留给各自属性);旋转矩形按声明框缩放,旋转角保持不变。
import type { Point, RectBox } from './geometry.ts'
import type { NodePatch, SceneNode } from './scene.ts'

/** 一个手柄:dx/dy 为它在联合框上的方向(-1 左/上,1 右/下,0 = 该轴不动) */
export interface ScaleHandle {
  id: string
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
}

export const SCALE_HANDLES: readonly ScaleHandle[] = [
  { id: 'nw', dx: -1, dy: -1 },
  { id: 'n', dx: 0, dy: -1 },
  { id: 'ne', dx: 1, dy: -1 },
  { id: 'e', dx: 1, dy: 0 },
  { id: 'se', dx: 1, dy: 1 },
  { id: 's', dx: 0, dy: 1 },
  { id: 'sw', dx: -1, dy: 1 },
  { id: 'w', dx: -1, dy: 0 }
]

export interface ScaleOptions {
  isProportional: boolean
  isFromCenter: boolean
}

/** 联合框缩到最小的边长(设计单位) */
export const MIN_SCALE_SIZE = 1

/** 指针位置对应的该轴缩放倍率;dir = 0 或尺寸为 0 时该轴不缩 */
function rawFactor(
  start: number,
  size: number,
  dir: number,
  pointer: number,
  isCenter: boolean
): number {
  if (dir === 0 || size === 0) return 1
  const edge = dir > 0 ? pointer - start : start + size - pointer
  return isCenter ? (2 * dir * (pointer - (start + size / 2))) / size : edge / size
}

/** 把一条轴的倍率落成 {start, size}:锚点(对边或中心)钉死 */
function applyFactor(
  start: number,
  size: number,
  dir: number,
  factor: number,
  isCenter: boolean
): { start: number; size: number } {
  const next = size * factor
  if (isCenter || dir === 0) return { start: start + (size - next) / 2, size: next }
  return { start: dir > 0 ? start : start + size - next, size: next }
}

/** 拖手柄 → 新的联合框 */
export function scaleBoxByHandle(
  box: RectBox,
  handle: ScaleHandle,
  pointer: Point,
  opts: ScaleOptions
): RectBox {
  let fx = rawFactor(box.x, box.width, handle.dx, pointer.x, opts.isFromCenter)
  let fy = rawFactor(box.y, box.height, handle.dy, pointer.y, opts.isFromCenter)
  if (opts.isProportional) {
    // 角柄取变化大的那轴;边柄只有一轴在动,另一轴跟着同倍率(绕自身中线)
    const f = handle.dx !== 0 && handle.dy !== 0 ? Math.max(fx, fy) : handle.dx !== 0 ? fx : fy
    fx = f
    fy = f
  }
  const minX = box.width > 0 ? MIN_SCALE_SIZE / box.width : 1
  const minY = box.height > 0 ? MIN_SCALE_SIZE / box.height : 1
  if (opts.isProportional) {
    const f = Math.max(fx, minX, minY)
    fx = f
    fy = f
  } else {
    fx = Math.max(fx, minX)
    fy = Math.max(fy, minY)
  }
  const x = applyFactor(box.x, box.width, handle.dx, fx, opts.isFromCenter)
  const y = applyFactor(box.y, box.height, handle.dy, fy, opts.isFromCenter)
  return { x: x.start, y: y.start, width: x.size, height: y.size }
}

/** 单个对象随联合框 from → to 变换的补丁:位置按映射,矩形尺寸按倍率,直线两端点各自映射 */
export function scaleNodePatch(node: SceneNode, from: RectBox, to: RectBox): NodePatch {
  const fx = from.width > 0 ? to.width / from.width : 1
  const fy = from.height > 0 ? to.height / from.height : 1
  const mapX = (v: number): number => to.x + (v - from.x) * fx
  const mapY = (v: number): number => to.y + (v - from.y) * fy
  if (node.type === 'rect') {
    return {
      x: mapX(node.x),
      y: mapY(node.y),
      width: node.width * fx,
      height: node.height * fy
    }
  }
  return { x1: mapX(node.x1), y1: mapY(node.y1), x2: mapX(node.x2), y2: mapY(node.y2) }
}
