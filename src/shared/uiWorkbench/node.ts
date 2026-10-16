// 设计节点模型(平台中立,导出与画布共用的唯一数据源)。第一种积木:矩形。
// 单位:逻辑像素,一律整数。x/y = 未旋转时的左上角,相对画板原点。
// 旋转:角度 [0, 360),绕自身中心,顺时针为正(与 CSS / React Native / Godot 的屏幕坐标一致)。
// 圆角顺序:左上、右上、右下、左下(同 CSS border-radius);每角不超过短边的一半。
// 所有修改走 NodeAction(命令,定义在 scene.ts):手动拖拽、属性面板、日后的撤销与 AI 修改共用同一入口。
import { ARTBOARD_SIDE_MAX, ARTBOARD_SIDE_MIN } from './artboard.ts'

export type CornerIndex = 0 | 1 | 2 | 3
export type CornerRadii = readonly [number, number, number, number]

export const CORNERS: readonly CornerIndex[] = [0, 1, 2, 3]
/** 导出用的角名(DTCG token 名 / 说明文字) */
export const CORNER_KEYS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const

/** 四边名:边中点手柄(单边缩放)按此序渲染——上右下左,同 CSS 习惯 */
export const EDGES = ['top', 'right', 'bottom', 'left'] as const
export type EdgeName = (typeof EDGES)[number]

/** 描边线型:实线 / 虚线;不勾线时整个 stroke 为 null,线型不入档 */
export type StrokeStyle = 'solid' | 'dashed'

export interface RectStroke {
  /** 描边色,6 位小写 hex(sRGB) */
  color: string
  /** 描边宽(逻辑像素) */
  width: number
  style: StrokeStyle
}

/** 图层通用状态(矩形、直线共用):隐藏 = 不渲染/不命中/不导出;锁定 = 画布上点不中,只能从图层面板选 */
export interface LayerState {
  visible: boolean
  locked: boolean
}

export const DEFAULT_LAYER_STATE: LayerState = { visible: true, locked: false }

/** 图层名/页面名长度上限 */
export const NAME_MAX_LENGTH = 64

/** 名字输入归一:去首尾空白并截断;空串回退 fallback(调用方传原名,改名不能改成空) */
export function sanitizeName(raw: string, fallback: string): string {
  const text = raw.trim().slice(0, NAME_MAX_LENGTH)
  return text === '' ? fallback : text
}

export interface RectNode extends LayerState {
  id: string
  type: 'rect'
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  radii: CornerRadii
  /** 填充色,6 位小写 hex(sRGB);null = 不填充 */
  fill: string | null
  /** 描边;null = 不勾线 */
  stroke: RectStroke | null
  /** 挂接的外观样式 id(styles.ts 里的 RectStyle);null = 自由身 */
  styleId: string | null
}

export type RectPatch = Partial<
  Pick<
    RectNode,
    | 'x'
    | 'y'
    | 'width'
    | 'height'
    | 'rotation'
    | 'radii'
    | 'fill'
    | 'stroke'
    | 'styleId'
    | 'name'
    | 'visible'
    | 'locked'
  >
>

/** 新矩形默认填充(Figma 同款浅灰,白画板上看得清) */
export const RECT_DEFAULT_FILL = '#d9d9d9'
/** 启用描边时的默认描边参数(去掉描边是 stroke=null,不走零宽) */
export const RECT_DEFAULT_STROKE: RectStroke = { color: '#000000', width: 1, style: 'solid' }
/** 描边宽上限 */
export const RECT_STROKE_WIDTH_MAX = 100
/** 坐标边界:允许画到画板外(会被画板裁掉),但不放任到无穷 */
export const NODE_COORD_LIMIT = ARTBOARD_SIDE_MAX * 2

export function normalizeRotation(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360
}

export function maxCornerRadius(width: number, height: number): number {
  return Math.floor(Math.min(width, height) / 2)
}

/** 四角逐个换算,保持四元组类型 */
export function mapRadii(
  radii: CornerRadii,
  fn: (radius: number, corner: CornerIndex) => number
): CornerRadii {
  return [fn(radii[0], 0), fn(radii[1], 1), fn(radii[2], 2), fn(radii[3], 3)]
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 颜色输入解析:# 可省,3 位扩成 6 位,统一小写;不合法返回 null(调用方保留原值) */
export function parseHexColor(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/.test(text)) return `#${[...text].map((c) => c + c).join('')}`
  return /^[0-9a-f]{6}$/.test(text) ? `#${text}` : null
}

export function sanitizeStroke(stroke: RectStroke): RectStroke | null {
  const color = parseHexColor(stroke.color)
  if (!color || (stroke.style !== 'solid' && stroke.style !== 'dashed')) return null
  return { color, width: clampInt(stroke.width, 1, RECT_STROKE_WIDTH_MAX), style: stroke.style }
}

/** 补丁落地前的统一校验:取整、钳边界;尺寸变小时圆角跟着收;非法颜色回退原值;
 *  外观字段(fill/stroke/radii)被手动改而补丁没带 styleId → 静默脱离样式链接(Figma 式) */
export function applyRectPatch(node: RectNode, patch: RectPatch): RectNode {
  const merged = { ...node, ...patch }
  const width = clampInt(merged.width, ARTBOARD_SIDE_MIN, ARTBOARD_SIDE_MAX)
  const height = clampInt(merged.height, ARTBOARD_SIDE_MIN, ARTBOARD_SIDE_MAX)
  const limit = maxCornerRadius(width, height)
  const touchesAppearance = 'fill' in patch || 'stroke' in patch || 'radii' in patch
  return {
    ...merged,
    name: sanitizeName(merged.name, node.name),
    visible: merged.visible !== false,
    locked: merged.locked === true,
    x: clampInt(merged.x, -NODE_COORD_LIMIT, NODE_COORD_LIMIT),
    y: clampInt(merged.y, -NODE_COORD_LIMIT, NODE_COORD_LIMIT),
    width,
    height,
    rotation: normalizeRotation(merged.rotation),
    radii: mapRadii(merged.radii, (r) => clampInt(r, 0, limit)),
    fill: merged.fill === null ? null : (parseHexColor(merged.fill) ?? node.fill),
    stroke: merged.stroke === null ? null : (sanitizeStroke(merged.stroke) ?? node.stroke),
    styleId: 'styleId' in patch ? (patch.styleId ?? null) : touchesAppearance ? null : node.styleId
  }
}

/** 新矩形的 id 与名字:序号取现有最大值 + 1(删掉的号不复用,导出的类名稳定) */
export function createRect(
  nodes: readonly { id: string }[],
  box: Pick<RectNode, 'x' | 'y' | 'width' | 'height'>,
  appearance: Partial<Pick<RectNode, 'fill' | 'stroke' | 'radii' | 'styleId'>> = {}
): RectNode {
  const used = nodes.map((n) => Number(/^rect-(\d+)$/.exec(n.id)?.[1] ?? 0))
  const seq = Math.max(0, ...used) + 1
  return applyRectPatch(
    {
      id: `rect-${seq}`,
      type: 'rect',
      name: `矩形 ${seq}`,
      ...box,
      ...DEFAULT_LAYER_STATE,
      rotation: 0,
      radii: [0, 0, 0, 0],
      fill: RECT_DEFAULT_FILL,
      stroke: null,
      styleId: null,
      ...appearance
    },
    {}
  )
}

/** 克隆矩形:序号规则同 createRect(现有最大 + 1),位置按 offset 平移,源对象不动 */
export function cloneRect(
  source: RectNode,
  nodes: readonly { id: string }[],
  offset: { x: number; y: number }
): RectNode {
  const used = nodes.map((n) => Number(/^rect-(\d+)$/.exec(n.id)?.[1] ?? 0))
  const seq = Math.max(0, ...used) + 1
  return applyRectPatch(
    {
      ...source,
      id: `rect-${seq}`,
      name: `矩形 ${seq}`,
      x: source.x + offset.x,
      y: source.y + offset.y,
      radii: [...source.radii] as CornerRadii
    },
    {}
  )
}

/** 四角同值时返回该值,否则 null(属性面板显示「混合」) */
export function uniformRadius(radii: CornerRadii): number | null {
  return radii.every((r) => r === radii[0]) ? radii[0] : null
}

export function withCornerRadius(
  radii: CornerRadii,
  corner: CornerIndex | 'all',
  value: number
): CornerRadii {
  return mapRadii(radii, (r, i) => (corner === 'all' || i === corner ? value : r))
}
