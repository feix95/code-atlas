// 间距吸附与间距标注(纯逻辑,无 React / DOM):PS / Figma 智能参考线里的「等间距」。
// 画板上已有对象之间的空隙(两个对象同一轴向相邻、中间没有别的东西挡着)是参考间距;
// 拖动中的盒子向任一相邻对象靠拢时,间距接近某个参考间距就吸成相等,或在左右(上下)邻居之间居中。
// 对齐吸附(snap.ts)优先:调用方把对齐已经吸上的轴锁住,这里只处理没吸上的轴。
// 阈值是设计单位,调用方负责 /zoom。
import type { SnapBox } from './snap.ts'

/** 一段间距标注:h = 水平线段(y 固定),v = 竖直线段(x 固定);value 是设计单位的间距 */
export interface GapMark {
  axis: 'h' | 'v'
  x1: number
  y1: number
  x2: number
  y2: number
  value: number
}

type Axis = 'x' | 'y'
interface Span {
  start: number
  end: number
}
interface Gap {
  value: number
  mark: GapMark
}

/** 参考间距只在对象不多时计算(三重循环),超出就放弃间距吸附,不卡手势 */
const MAX_BOXES = 120
const VALUE_EPS = 0.01

const spanOf = (b: SnapBox, axis: Axis): Span =>
  axis === 'x' ? { start: b.x, end: b.x + b.width } : { start: b.y, end: b.y + b.height }
const crossOf = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x')

/** 两段区间有重叠;零长区间(直线的退化边)落在另一段内部也算 */
function overlaps(a: Span, b: Span): boolean {
  if (Math.max(a.start, b.start) < Math.min(a.end, b.end)) return true
  if (a.start === a.end) return a.start > b.start && a.start < b.end
  if (b.start === b.end) return b.start > a.start && b.start < a.end
  return false
}

function crossRange(a: SnapBox, b: SnapBox, axis: Axis): Span {
  const ca = spanOf(a, crossOf(axis))
  const cb = spanOf(b, crossOf(axis))
  return { start: Math.max(ca.start, cb.start), end: Math.min(ca.end, cb.end) }
}

function makeMark(axis: Axis, from: number, to: number, cross: Span): GapMark {
  const mid = (cross.start + cross.end) / 2
  return axis === 'x'
    ? { axis: 'h', x1: from, y1: mid, x2: to, y2: mid, value: to - from }
    : { axis: 'v', x1: mid, y1: from, x2: mid, y2: to, value: to - from }
}

/** 一条轴上所有「空隙」:前者终点到后者起点、交叉轴有重叠、且空隙里没有第三者挡住 */
function emptyGaps(boxes: readonly SnapBox[], axis: Axis): Gap[] {
  const gaps: Gap[] = []
  for (const a of boxes) {
    for (const b of boxes) {
      if (a === b) continue
      const from = spanOf(a, axis).end
      const to = spanOf(b, axis).start
      if (to - from <= 0) continue
      if (!overlaps(spanOf(a, crossOf(axis)), spanOf(b, crossOf(axis)))) continue
      const cross = crossRange(a, b, axis)
      const isBlocked = boxes.some((c) => {
        if (c === a || c === b) return false
        const s = spanOf(c, axis)
        return s.start < to && s.end > from && overlaps(spanOf(c, crossOf(axis)), cross)
      })
      if (!isBlocked) gaps.push({ value: to - from, mark: makeMark(axis, from, to, cross) })
    }
  }
  return gaps
}

interface AxisSnap {
  delta: number
  /** 吸上的参考间距(居中吸附没有参考值) */
  value: number | null
  refs: readonly Gap[]
}

/** 单轴间距吸附:候选 = 贴着前邻居留参考间距 / 贴着后邻居留参考间距 / 前后邻居正中间,取最近且在阈值内的 */
function snapAxis(
  dragged: SnapBox,
  others: readonly SnapBox[],
  axis: Axis,
  threshold: number
): AxisSnap | null {
  const me = spanOf(dragged, axis)
  const size = me.end - me.start
  const near = others.filter((o) =>
    overlaps(spanOf(o, crossOf(axis)), spanOf(dragged, crossOf(axis)))
  )
  let before: Span | null = null
  let after: Span | null = null
  for (const o of near) {
    const s = spanOf(o, axis)
    if (s.end <= me.start && (!before || s.end > before.end)) before = s
    if (s.start >= me.end && (!after || s.start < after.start)) after = s
  }
  const refs = emptyGaps(others, axis)
  let best: AxisSnap | null = null
  const consider = (delta: number, value: number | null): void => {
    if (Math.abs(delta) > threshold || (best && Math.abs(delta) >= Math.abs(best.delta))) return
    best = {
      delta,
      value,
      refs: value === null ? [] : refs.filter((g) => Math.abs(g.value - value) < VALUE_EPS)
    }
  }
  for (const g of refs) {
    if (before) consider(before.end + g.value - me.start, g.value)
    if (after) consider(after.start - g.value - size - me.start, g.value)
  }
  if (before && after && after.start - before.end >= size) {
    consider((before.end + after.start - size) / 2 - me.start, null)
  }
  return best
}

export interface SpacingSnap {
  x: number
  y: number
  isSnapped: { x: boolean; y: boolean }
  /** 吸上的那个参考间距在画板上的所有出处(让用户看到「和这几段一样」) */
  refMarks: GapMark[]
}

/** 间距吸附:locked 标出已被对齐吸附占用的轴(不再动);x 先吸,y 按吸后的 x 再算 */
export function snapSpacing(
  dragged: SnapBox,
  others: readonly SnapBox[],
  threshold: number,
  locked: { x: boolean; y: boolean }
): SpacingSnap {
  const result: SpacingSnap = {
    x: dragged.x,
    y: dragged.y,
    isSnapped: { x: false, y: false },
    refMarks: []
  }
  if (others.length > MAX_BOXES) return result
  const box = { ...dragged }
  for (const axis of ['x', 'y'] as const) {
    if (locked[axis]) continue
    const hit = snapAxis(box, others, axis, threshold)
    if (!hit) continue
    box[axis] += hit.delta
    result[axis] = box[axis]
    result.isSnapped[axis] = true
    result.refMarks.push(...hit.refs.map((g) => g.mark))
  }
  return result
}

/** 盒子四向最近邻居的间距标注(按住修饰键时全程显示「谁和谁之间多少」) */
export function neighborGaps(box: SnapBox, others: readonly SnapBox[]): GapMark[] {
  const marks: GapMark[] = []
  for (const axis of ['x', 'y'] as const) {
    const me = spanOf(box, axis)
    let before: SnapBox | null = null
    let after: SnapBox | null = null
    for (const o of others) {
      if (!overlaps(spanOf(o, crossOf(axis)), spanOf(box, crossOf(axis)))) continue
      const s = spanOf(o, axis)
      if (s.end <= me.start && (!before || s.end > spanOf(before, axis).end)) before = o
      if (s.start >= me.end && (!after || s.start < spanOf(after, axis).start)) after = o
    }
    if (before) pushGap(marks, before, box, axis)
    if (after) pushGap(marks, box, after, axis)
  }
  return marks
}

function pushGap(marks: GapMark[], a: SnapBox, b: SnapBox, axis: Axis): void {
  const from = spanOf(a, axis).end
  const to = spanOf(b, axis).start
  if (to - from > 0) marks.push(makeMark(axis, from, to, crossRange(a, b, axis)))
}

/** 合并并去重:参考间距标注 + (吸上或按住修饰键时)被拖盒子的邻居间距 */
export function gapMarks(
  box: SnapBox,
  others: readonly SnapBox[],
  refMarks: readonly GapMark[],
  isShowNeighbors: boolean
): GapMark[] {
  const all = [...refMarks, ...(isShowNeighbors ? neighborGaps(box, others) : [])]
  const seen = new Set<string>()
  return all.filter((m) => {
    const key = `${m.axis}:${m.x1}:${m.y1}:${m.x2}:${m.y2}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
