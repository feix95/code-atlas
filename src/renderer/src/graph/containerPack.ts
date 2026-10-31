// 展开容器内子项的排布:每个子项占一个“圆 + 下方标签”的矩形盒,盒之间留固定间隙。
// 容器按子项盒子总面积预算起始圆;每项在圆内撒若干候选点,选离已放盒子最远的空位
// 放下,放不下就整体放大半径重来;放好后整体向心压缩,再沿半径逐个往里挪,把空隙
// 收掉。排布是确定性的(固定种子),同一组子项每次得到同样的位置;没有固定的行、
// 列或扫描顺序,不会出现网格或斜线。
import { GRAPH_CONTAINER, GRAPH_LABEL, GRAPH_NODE, GRAPH_ZOOM } from './graphConfig.ts'
import { boxesOverlap, farthestCorner, labelBox, type Box } from './nodeBox.ts'

export interface LayoutChild {
  id: string
  radius: number
  /** 节点下方标签的宽度;0 = 没有下方标签(容器名画在圆内) */
  labelWidth: number
}

export interface Slot {
  dx: number
  dy: number
}

export interface ContainerLayout {
  slots: Map<string, Slot>
  radius: number
}

export function childBox(x: number, y: number, child: LayoutChild, labelHeight: number): Box {
  return labelBox(x, y, child.radius, child.labelWidth, labelHeight)
}

interface Placement {
  child: LayoutChild
  x: number
  y: number
}

/** 每项撒多少个候选点;点数越多分布越均匀,代价是 O(候选数 × 子项数²) */
const PACK_CANDIDATES = 40

/** 放不下时整体放大半径的比例 */
const PACK_GROW = 1.06

/** 固定种子:同一组子项每次排布结果一致 */
const PACK_SEED = 0x9e3779b9

/** 向心压缩:每次整体缩掉的比例、最小比例、压缩轮数与每轮松弛上限 */
const COMPRESS_STEP = 0.03
const COMPRESS_STEP_MIN = 0.002
const COMPRESS_PASSES = 20
const COMPRESS_ROUNDS = 30

/** 沿半径往圆心挪的试探步数与轮数 */
const RADIAL_STEPS = 20
const RADIAL_SWEEPS = 10

function boxArea(child: LayoutChild, labelHeight: number): number {
  const width = 2 * Math.max(child.radius, child.labelWidth / 2)
  const height = 2 * child.radius + (child.labelWidth > 0 ? GRAPH_LABEL.gap + labelHeight : 0)
  return width * height
}

/** 两盒之间的最短距离 */
function boxGap(a: Box, b: Box): number {
  const dx = Math.max(b.left - a.right, a.left - b.right, 0)
  const dy = Math.max(b.top - a.bottom, a.top - b.bottom, 0)
  return Math.hypot(dx, dy)
}

/** 固定种子的伪随机数:排布要可复现,不能用 Math.random */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 起始圆半径按盒子总面积与填充率预算;单看总面积放不下最宽的标签时按该标签兜底 */
function budgetRadius(items: readonly Placement[], labelHeight: number): number {
  const area = items.reduce((sum, item) => sum + boxArea(item.child, labelHeight), 0)
  const ideal = Math.sqrt(area / (Math.PI * GRAPH_ZOOM.containerFill))
  const widest = Math.max(
    ...items.map((item) => farthestCorner(childBox(0, 0, item.child, labelHeight)))
  )
  return Math.max(GRAPH_NODE.folderRadiusMin, ideal, widest) + GRAPH_ZOOM.containerPadding
}

/** 盒子是否与除 skip 外的其他子项都不重叠 */
function isFree(
  box: Box,
  items: readonly Placement[],
  skip: Placement | null,
  labelHeight: number
): boolean {
  for (const other of items) {
    if (other === skip) continue
    const otherBox = childBox(other.x, other.y, other.child, labelHeight)
    if (boxesOverlap(box, otherBox, GRAPH_ZOOM.childGap)) return false
  }
  return true
}

/** 逐项找空位:每项取 PACK_CANDIDATES 个候选点,选离已放盒子最远的;有子项放不下返回 false */
function placeItems(
  items: readonly Placement[],
  radius: number,
  labelHeight: number,
  random: () => number
): boolean {
  const placed: Placement[] = []
  for (const item of items) {
    let bestScore = -1
    let bestX = 0
    let bestY = 0
    for (let candidate = 0; candidate < PACK_CANDIDATES; candidate++) {
      const distance = radius * Math.sqrt(random())
      const angle = random() * Math.PI * 2
      const x = Math.cos(angle) * distance
      const y = Math.sin(angle) * distance
      const box = childBox(x, y, item.child, labelHeight)
      if (farthestCorner(box) > radius) continue
      let clearance = Infinity
      let blocked = false
      for (const other of placed) {
        const otherBox = childBox(other.x, other.y, other.child, labelHeight)
        if (boxesOverlap(box, otherBox, GRAPH_ZOOM.childGap)) {
          blocked = true
          break
        }
        clearance = Math.min(clearance, boxGap(box, otherBox))
      }
      if (!blocked && clearance > bestScore) {
        bestScore = clearance
        bestX = x
        bestY = y
      }
    }
    if (bestScore < 0) return false
    item.x = bestX
    item.y = bestY
    placed.push(item)
  }
  return true
}

/** 最远盒角越出圆就把中心朝圆心缩,缩几次直到整盒回到圆内 */
function clampInside(item: Placement, radius: number, labelHeight: number): void {
  for (let attempt = 0; attempt < 4; attempt++) {
    const reach = farthestCorner(childBox(item.x, item.y, item.child, labelHeight))
    if (reach <= radius) return
    const scale = radius / reach
    item.x *= scale
    item.y *= scale
  }
}

function countOverlaps(items: readonly Placement[], labelHeight: number): number {
  let count = 0
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (
        boxesOverlap(
          childBox(items[i].x, items[i].y, items[i].child, labelHeight),
          childBox(items[j].x, items[j].y, items[j].child, labelHeight),
          GRAPH_ZOOM.childGap
        )
      ) {
        count++
      }
    }
  }
  return count
}

/** 一轮松弛:两两按盒子分开,再夹回圆内;返回这一轮是否动过 */
function relaxRound(items: readonly Placement[], radius: number, labelHeight: number): boolean {
  let moved = false
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      const boxA = childBox(a.x, a.y, a.child, labelHeight)
      const boxB = childBox(b.x, b.y, b.child, labelHeight)
      if (!boxesOverlap(boxA, boxB, GRAPH_ZOOM.childGap)) continue
      const overlapX =
        Math.min(boxA.right, boxB.right) - Math.max(boxA.left, boxB.left) + GRAPH_ZOOM.childGap
      const overlapY =
        Math.min(boxA.bottom, boxB.bottom) - Math.max(boxA.top, boxB.top) + GRAPH_ZOOM.childGap
      if (overlapX <= overlapY) {
        const push = (b.x >= a.x ? 1 : -1) * (overlapX / 2)
        a.x -= push
        b.x += push
      } else {
        const centerA = (boxA.top + boxA.bottom) / 2
        const centerB = (boxB.top + boxB.bottom) / 2
        const push = (centerB >= centerA ? 1 : -1) * (overlapY / 2)
        a.y -= push
        b.y += push
      }
      moved = true
    }
  }
  for (const item of items) clampInside(item, radius, labelHeight)
  return moved
}

/** 整体向心压缩:缩完仍不重叠就保留,缩出重叠就减半步长再试 */
function compressToCenter(
  input: readonly Placement[],
  radius: number,
  labelHeight: number
): Placement[] {
  let current = input.map((item) => ({ ...item }))
  let step = COMPRESS_STEP
  for (let pass = 0; pass < COMPRESS_PASSES; pass++) {
    const candidate = current.map((item) => ({
      ...item,
      x: item.x * (1 - step),
      y: item.y * (1 - step)
    }))
    for (let round = 0; round < COMPRESS_ROUNDS; round++) {
      if (!relaxRound(candidate, radius, labelHeight)) break
    }
    if (countOverlaps(candidate, labelHeight) > 0) {
      step /= 2
      if (step < COMPRESS_STEP_MIN) break
      continue
    }
    current = candidate
  }
  return current
}

/** 逐个沿半径向圆心试探,落在最靠内的空位上;扫到没人再动为止 */
function radialCompact(
  input: readonly Placement[],
  radius: number,
  labelHeight: number
): Placement[] {
  const items = input.map((item) => ({ ...item }))
  for (let sweep = 0; sweep < RADIAL_SWEEPS; sweep++) {
    let moved = false
    for (const item of items) {
      const originX = item.x
      const originY = item.y
      let bestX = originX
      let bestY = originY
      for (let step = 1; step <= RADIAL_STEPS; step++) {
        const scale = 1 - step / RADIAL_STEPS
        const x = originX * scale
        const y = originY * scale
        const box = childBox(x, y, item.child, labelHeight)
        if (farthestCorner(box) > radius) continue
        if (!isFree(box, items, item, labelHeight)) continue
        bestX = x
        bestY = y
      }
      if (bestX !== originX || bestY !== originY) {
        item.x = bestX
        item.y = bestY
        moved = true
      }
    }
    if (!moved) break
  }
  return items
}

/** 以盒子包围盒居中,返回槽位;半径由盒子四角和顶部容器名反推 */
function boundLayout(
  placements: readonly Placement[],
  labelHeight: number,
  containerLabelWidth: number
): ContainerLayout {
  const boxes = placements.map((item) => childBox(item.x, item.y, item.child, labelHeight))
  const minX = Math.min(...boxes.map((box) => box.left))
  const maxX = Math.max(...boxes.map((box) => box.right))
  const minY = Math.min(...boxes.map((box) => box.top))
  const maxY = Math.max(...boxes.map((box) => box.bottom))
  const centerX = placements.length > 0 ? (minX + maxX) / 2 : 0
  const centerY = placements.length > 0 ? (minY + maxY) / 2 : 0

  const slots = new Map<string, Slot>()
  let reach = 0
  let contentTop = Infinity
  for (const item of placements) {
    const dx = item.x - centerX
    const dy = item.y - centerY
    const box = childBox(dx, dy, item.child, labelHeight)
    reach = Math.max(reach, farthestCorner(box))
    contentTop = Math.min(contentTop, box.top)
    slots.set(item.child.id, { dx, dy })
  }

  const nameReserve =
    placements.length > 0
      ? -contentTop + GRAPH_CONTAINER.labelGap + labelHeight + GRAPH_ZOOM.containerPadding
      : 0
  const radius =
    Math.max(
      GRAPH_NODE.folderRadiusMin,
      reach,
      nameReserve,
      containerLabelWidth / 2 + GRAPH_ZOOM.containerPadding
    ) + GRAPH_ZOOM.containerPadding
  return { slots, radius }
}

export function packContainerChildren(
  children: readonly LayoutChild[],
  labelHeight: number,
  containerLabelWidth: number
): ContainerLayout {
  if (children.length === 0) return boundLayout([], labelHeight, containerLabelWidth)
  const items: Placement[] = [...children]
    .sort((a, b) => boxArea(b, labelHeight) - boxArea(a, labelHeight) || (a.id < b.id ? -1 : 1))
    .map((child) => ({ child, x: 0, y: 0 }))
  let radius = budgetRadius(items, labelHeight)
  // 放不下就放大重来;半径指数增长,子项总能找到空位
  while (!placeItems(items, radius, labelHeight, seededRandom(PACK_SEED))) {
    radius *= PACK_GROW
  }
  const compacted = compressToCenter(items, radius, labelHeight)
  const tightened = compressToCenter(
    radialCompact(compacted, radius, labelHeight),
    radius,
    labelHeight
  )
  return boundLayout(
    radialCompact(tightened, radius, labelHeight),
    labelHeight,
    containerLabelWidth
  )
}
