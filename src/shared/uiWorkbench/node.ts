// 设计节点模型(平台中立,导出与画布共用的唯一数据源)。第一种积木:矩形。
// 单位:逻辑像素,一律整数。x/y = 未旋转时的左上角,相对画板原点。
// 旋转:角度 [0, 360),绕自身中心,顺时针为正(与 CSS / React Native / Godot 的屏幕坐标一致)。
// 圆角顺序:左上、右上、右下、左下(同 CSS border-radius);每角不超过短边的一半。
// 所有修改走 NodeAction(命令):手动拖拽、属性面板、日后的撤销与 AI 修改共用同一入口。
import { ARTBOARD_SIDE_MAX, ARTBOARD_SIDE_MIN } from './artboard.ts'

export type CornerIndex = 0 | 1 | 2 | 3
export type CornerRadii = readonly [number, number, number, number]

export const CORNERS: readonly CornerIndex[] = [0, 1, 2, 3]
/** 导出用的角名(DTCG token 名 / 说明文字) */
export const CORNER_KEYS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const

export interface RectNode {
  id: string
  type: 'rect'
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  radii: CornerRadii
  /** 填充色,6 位小写 hex(sRGB) */
  fill: string
}

export type RectPatch = Partial<
  Pick<RectNode, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'radii'>
>

export type NodeAction =
  | { type: 'add'; node: RectNode }
  | { type: 'update'; id: string; patch: RectPatch }
  | { type: 'remove'; id: string }

/** 新矩形默认填充(Figma 同款浅灰,白画板上看得清) */
export const RECT_DEFAULT_FILL = '#d9d9d9'
/** 单击不拖时生成的默认边长 */
export const RECT_CLICK_SIZE = 100
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

/** 补丁落地前的统一校验:取整、钳边界;尺寸变小时圆角跟着收 */
export function applyRectPatch(node: RectNode, patch: RectPatch): RectNode {
  const merged = { ...node, ...patch }
  const width = clampInt(merged.width, ARTBOARD_SIDE_MIN, ARTBOARD_SIDE_MAX)
  const height = clampInt(merged.height, ARTBOARD_SIDE_MIN, ARTBOARD_SIDE_MAX)
  const limit = maxCornerRadius(width, height)
  return {
    ...merged,
    x: clampInt(merged.x, -NODE_COORD_LIMIT, NODE_COORD_LIMIT),
    y: clampInt(merged.y, -NODE_COORD_LIMIT, NODE_COORD_LIMIT),
    width,
    height,
    rotation: normalizeRotation(merged.rotation),
    radii: mapRadii(merged.radii, (r) => clampInt(r, 0, limit))
  }
}

export function applyNodeAction(nodes: readonly RectNode[], action: NodeAction): RectNode[] {
  switch (action.type) {
    case 'add':
      return [...nodes, applyRectPatch(action.node, {})]
    case 'update':
      return nodes.map((n) => (n.id === action.id ? applyRectPatch(n, action.patch) : n))
    case 'remove':
      return nodes.filter((n) => n.id !== action.id)
  }
}

/** 新矩形的 id 与名字:序号取现有最大值 + 1(删掉的号不复用,导出的类名稳定) */
export function createRect(
  nodes: readonly RectNode[],
  box: Pick<RectNode, 'x' | 'y' | 'width' | 'height'>
): RectNode {
  const used = nodes.map((n) => Number(/^rect-(\d+)$/.exec(n.id)?.[1] ?? 0))
  const seq = Math.max(0, ...used) + 1
  return applyRectPatch(
    {
      id: `rect-${seq}`,
      type: 'rect',
      name: `矩形 ${seq}`,
      ...box,
      rotation: 0,
      radii: [0, 0, 0, 0],
      fill: RECT_DEFAULT_FILL
    },
    {}
  )
}

/** 克隆矩形:序号规则同 createRect(现有最大 + 1),位置按 offset 平移,源对象不动 */
export function cloneRect(
  source: RectNode,
  nodes: readonly RectNode[],
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
