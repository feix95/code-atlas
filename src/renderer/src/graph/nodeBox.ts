// 节点占位盒:圆本身 + 圆下方一行标签。容器内装箱与圈外防挤共用同一份几何,
// 两处各算一套的话,标签宽度或绘制方式一变就会对不上。
import { GRAPH_LABEL } from './graphConfig.ts'

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** 标签宽度传 0 表示没有下方标签(容器名画在圆内) */
export function labelBox(
  x: number,
  y: number,
  radius: number,
  labelWidth: number,
  labelHeight: number
): Box {
  const halfWidth = Math.max(radius, labelWidth / 2)
  const bottom = y + radius + (labelWidth > 0 ? GRAPH_LABEL.gap + labelHeight : 0)
  return { left: x - halfWidth, right: x + halfWidth, top: y - radius, bottom }
}

/** 两盒各向外扩 gap 后是否仍然相交 */
export function boxesOverlap(a: Box, b: Box, gap: number): boolean {
  return (
    a.left - gap < b.right &&
    a.right + gap > b.left &&
    a.top - gap < b.bottom &&
    a.bottom + gap > b.top
  )
}

/** 盒子四角离原点的最远距离:整盒装进以原点为圆心的圆所需的最小半径 */
export function farthestCorner(box: Box): number {
  return Math.max(
    Math.hypot(box.left, box.top),
    Math.hypot(box.right, box.top),
    Math.hypot(box.left, box.bottom),
    Math.hypot(box.right, box.bottom)
  )
}
