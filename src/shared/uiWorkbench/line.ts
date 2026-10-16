// 直线节点(纯逻辑,无 React / DOM):由起点、终点两个端点定义,长度与角度是派生量。
// 坐标相对画板原点,范围同矩形;端点保留 2 位小数(Shift 吸 15° 时端点才不被整数取整带偏角度)。
// 描边必有(没有描边的线不存在),线宽/颜色/线型复用矩形的 RectStroke;端点样式 cap 对应 SVG stroke-linecap。
// 本文件不引用 geometry.ts / scene.ts,避免循环依赖;命中/框选判定在 scene.ts 里按类型分派到这里。
import {
  DEFAULT_LAYER_STATE,
  NODE_COORD_LIMIT,
  sanitizeName,
  sanitizeStroke,
  type LayerState,
  type RectStroke
} from './node.ts'

/** 端点样式:平头(无) / 圆头 / 方头(后两者各向外多出半个线宽) */
export type LineCap = 'butt' | 'round' | 'square'
export const LINE_CAPS: readonly LineCap[] = ['butt', 'round', 'square']
export const LINE_CAP_LABELS: Record<LineCap, string> = {
  butt: '平头',
  round: '圆头',
  square: '方头'
}

export interface LineNode extends LayerState {
  id: string
  type: 'line'
  name: string
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: RectStroke
  cap: LineCap
  /** 挂接的直线样式 id(lineStyles.ts 里的 LineStyle);null = 自由身 */
  styleId: string | null
}

export type LinePatch = Partial<
  Pick<
    LineNode,
    | 'x1'
    | 'y1'
    | 'x2'
    | 'y2'
    | 'stroke'
    | 'cap'
    | 'styleId'
    | 'name'
    | 'visible'
    | 'locked'
    | 'parentId'
  >
>

export interface LineEnds {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface Pt {
  x: number
  y: number
}

/** 新线默认描边:1px 黑实线(分割线最常见的用法) */
export const LINE_DEFAULT_STROKE: RectStroke = { color: '#000000', width: 1, style: 'solid' }
export const LINE_DEFAULT_CAP: LineCap = 'butt'
/** 吸附角度步长(Shift) */
export const LINE_SNAP_ANGLE = 15

const DEG = Math.PI / 180

/** 保留 2 位小数;+ 0 把 -0 归成 0(三角函数结果 -6e-15 取整后会变 -0,导出会出现 "-0") */
export function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0
}

function clampCoord(value: number): number {
  return round2(Math.min(NODE_COORD_LIMIT, Math.max(-NODE_COORD_LIMIT, value)))
}

/** 补丁落地前的统一校验:端点钳边界取 2 位小数;非法描边/端点样式回退原值;
 *  外观字段(stroke/cap)被手动改而补丁没带 styleId → 静默脱离样式链接(同矩形) */
export function applyLinePatch(node: LineNode, patch: LinePatch): LineNode {
  const merged = { ...node, ...patch }
  const touchesAppearance = 'stroke' in patch || 'cap' in patch
  return {
    ...merged,
    name: sanitizeName(merged.name, node.name),
    visible: merged.visible !== false,
    locked: merged.locked === true,
    parentId: merged.parentId ?? null,
    x1: clampCoord(merged.x1),
    y1: clampCoord(merged.y1),
    x2: clampCoord(merged.x2),
    y2: clampCoord(merged.y2),
    stroke: sanitizeStroke(merged.stroke) ?? node.stroke,
    cap: LINE_CAPS.includes(merged.cap) ? merged.cap : node.cap,
    styleId: 'styleId' in patch ? (patch.styleId ?? null) : touchesAppearance ? null : node.styleId
  }
}

function nextSeq(nodes: readonly { id: string }[]): number {
  const used = nodes.map((n) => Number(/^line-(\d+)$/.exec(n.id)?.[1] ?? 0))
  return Math.max(0, ...used) + 1
}

/** 新直线的 id 与名字:序号取现有最大值 + 1(删掉的号不复用,导出的类名稳定) */
export function createLine(
  nodes: readonly { id: string }[],
  ends: LineEnds,
  look: Partial<Pick<LineNode, 'stroke' | 'cap' | 'styleId'>> = {}
): LineNode {
  const seq = nextSeq(nodes)
  return applyLinePatch(
    {
      id: `line-${seq}`,
      type: 'line',
      name: `直线 ${seq}`,
      ...DEFAULT_LAYER_STATE,
      ...ends,
      stroke: { ...LINE_DEFAULT_STROKE },
      cap: LINE_DEFAULT_CAP,
      styleId: null,
      ...look
    },
    {}
  )
}

/** 克隆直线:序号规则同 createLine,整条按 offset 平移,源对象不动 */
export function cloneLine(
  source: LineNode,
  nodes: readonly { id: string }[],
  offset: Pt
): LineNode {
  const seq = nextSeq(nodes)
  return applyLinePatch(
    {
      ...source,
      id: `line-${seq}`,
      name: `直线 ${seq}`,
      x1: source.x1 + offset.x,
      y1: source.y1 + offset.y,
      x2: source.x2 + offset.x,
      y2: source.y2 + offset.y,
      stroke: { ...source.stroke }
    },
    {}
  )
}

export function lineLength(line: LineEnds): number {
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1)
}

/** 起点→终点的方向角,度,[0, 360),顺时针为正(y 向下坐标系) */
export function lineAngle(line: LineEnds): number {
  const deg = Math.atan2(line.y2 - line.y1, line.x2 - line.x1) / DEG
  return ((deg % 360) + 360) % 360
}

/** 改长度:起点与方向不动,终点沿原方向伸缩;零长线按 0° 方向 */
export function lineWithLength(line: LineEnds, length: number): LinePatch {
  const rad = lineAngle(line) * DEG
  return { x2: line.x1 + Math.cos(rad) * length, y2: line.y1 + Math.sin(rad) * length }
}

/** 改角度:起点与长度不动,终点绕起点转到新方向 */
export function lineWithAngle(line: LineEnds, deg: number): LinePatch {
  const length = lineLength(line)
  return { x2: line.x1 + Math.cos(deg * DEG) * length, y2: line.y1 + Math.sin(deg * DEG) * length }
}

/** 平移整条线(移动手势与方向键微调共用) */
export function lineTranslatePatch(line: LineEnds, dx: number, dy: number): LinePatch {
  return { x1: line.x1 + dx, y1: line.y1 + dy, x2: line.x2 + dx, y2: line.y2 + dy }
}

/** 拖出直线:start 按下点,end 当前点。isAngleSnap(Shift)把方向吸到 15° 整倍数、长度不变;
 *  isFromCenter(Alt)以 start 为中点向两侧对称展开。自由绘制端点取整数;吸角或吸附到对象(isPrecise)时保留 2 位小数,
 *  否则吸到中线的 .5 会被取整弄丢 */
export function lineFromDrag(
  start: Pt,
  end: Pt,
  mods: { isAngleSnap: boolean; isFromCenter: boolean; isPrecise?: boolean }
): LineEnds {
  let dx = end.x - start.x
  let dy = end.y - start.y
  if (mods.isAngleSnap) {
    const length = Math.hypot(dx, dy)
    const snapped = Math.round(Math.atan2(dy, dx) / DEG / LINE_SNAP_ANGLE) * LINE_SNAP_ANGLE * DEG
    dx = Math.cos(snapped) * length
    dy = Math.sin(snapped) * length
  }
  const round = mods.isAngleSnap || mods.isPrecise ? round2 : Math.round
  return {
    x1: round(mods.isFromCenter ? start.x - dx : start.x),
    y1: round(mods.isFromCenter ? start.y - dy : start.y),
    x2: round(start.x + dx),
    y2: round(start.y + dy)
  }
}

/** 拖端点:另一端钉死,被拖端落到指针处(Shift 吸 15°,以钉死端为圆心) */
export function lineEndpointPatch(
  line: LineEnds,
  which: 'start' | 'end',
  pointer: Pt,
  mods: { isAngleSnap: boolean; isPrecise?: boolean }
): LinePatch {
  const fixed = which === 'end' ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 }
  const moved = lineFromDrag(fixed, pointer, { ...mods, isFromCenter: false })
  return which === 'end' ? { x2: moved.x2, y2: moved.y2 } : { x1: moved.x2, y1: moved.y2 }
}

/** 点到线段的距离 */
function distanceToSegment(p: Pt, line: LineEnds): number {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - line.x1) * dx + (p.y - line.y1) * dy) / lengthSq))
  return Math.hypot(p.x - (line.x1 + t * dx), p.y - (line.y1 + t * dy))
}

/** 命中:点到线段距离 ≤ max(容差, 半线宽);容差是屏幕像素换算来的设计单位(线很细,不放宽就点不中) */
export function hitLine(line: LineNode, p: Pt, tolerance: number): boolean {
  return distanceToSegment(p, line) <= Math.max(tolerance, line.stroke.width / 2)
}

/** 框选相交:线段与轴对齐选框有交点即中(Liang-Barsky 裁剪;选框可退化为线/点) */
export function lineOverlapsBox(
  line: LineEnds,
  box: { x: number; y: number; width: number; height: number }
): boolean {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const edges: [number, number][] = [
    [-dx, line.x1 - box.x],
    [dx, box.x + box.width - line.x1],
    [-dy, line.y1 - box.y],
    [dy, box.y + box.height - line.y1]
  ]
  let enter = 0
  let leave = 1
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) enter = Math.max(enter, t)
    else leave = Math.min(leave, t)
    if (enter > leave) return false
  }
  return true
}
