// 外观样式(纯逻辑,无 React / DOM):整包方案 = 填充 + 描边 + 圆角,不含几何与角度。
// 节点经 styleId 挂接:改样式定义 → 调用方批量回写所有挂接节点(活链接,Figma 式);
// 手动改节点外观 → applyRectPatch 静默脱钩。存档反序列化逐字段校验,坏的丢弃。
import { RECT_STROKE_WIDTH_MAX, type CornerRadii, type RectNode, type RectStroke } from './node.ts'

export interface StyleAppearance {
  fill: string | null
  stroke: RectStroke | null
  radii: CornerRadii
}

export interface RectStyle extends StyleAppearance {
  id: string
  name: string
}

export const STYLE_NAME_MAX = 32
export const STYLES_MAX = 64

/** 节点的外观三件套 → 方案载荷;存方案与「复制外观」共用同一出口 */
export function appearanceOf(node: RectNode): StyleAppearance {
  return {
    fill: node.fill,
    stroke: node.stroke ? { ...node.stroke } : null,
    radii: [...node.radii] as CornerRadii
  }
}

/** 外观三件套值比较:判「当前矩形是否还等于方案定义」(链接态展示用) */
export function sameAppearance(a: StyleAppearance, b: StyleAppearance): boolean {
  const sa = a.stroke
  const sb = b.stroke
  return (
    a.fill === b.fill &&
    (sa === sb ||
      (sa !== null &&
        sb !== null &&
        sa.color === sb.color &&
        sa.width === sb.width &&
        sa.style === sb.style)) &&
    a.radii.every((r, i) => r === b.radii[i])
  )
}

/** 方案名:去首尾空白、截断;留空回落「样式 N」 */
export function normalizeStyleName(raw: string, seq: number): string {
  return raw.trim().slice(0, STYLE_NAME_MAX) || `样式 ${seq}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value)
}

function toStroke(value: unknown): RectStroke | null {
  if (value === null) return null
  if (!isRecord(value)) return null
  const { color, width, style } = value
  if (!isHex(color)) return null
  if (
    !Number.isInteger(width) ||
    (width as number) < 1 ||
    (width as number) > RECT_STROKE_WIDTH_MAX
  )
    return null
  if (style !== 'solid' && style !== 'dashed') return null
  return { color, width: width as number, style }
}

function toRadii(value: unknown): CornerRadii | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  if (!value.every((r) => Number.isInteger(r) && (r as number) >= 0)) return null
  return [value[0] as number, value[1] as number, value[2] as number, value[3] as number]
}

function toStyle(value: unknown): RectStyle | null {
  if (!isRecord(value)) return null
  const { id, name, fill, stroke, radii } = value
  if (typeof id !== 'string' || id === '') return null
  if (typeof name !== 'string' || name.trim() === '') return null
  const s = toStroke(stroke)
  const r = toRadii(radii)
  // stroke 字段:null = 方案不勾线;非 null 但解析失败 = 坏条目,整条丢弃
  if ((fill !== null && !isHex(fill)) || (stroke !== null && s === null) || r === null) {
    return null
  }
  return {
    id,
    name: name.trim().slice(0, STYLE_NAME_MAX),
    fill: fill as string | null,
    stroke: s,
    radii: r
  }
}

/** 已 JSON.parse 的存档 → 合法方案列表;坏条目丢弃,超限截断 */
export function sanitizeStylePresets(value: unknown): RectStyle[] {
  if (!Array.isArray(value)) return []
  return value
    .map(toStyle)
    .filter((s): s is RectStyle => s !== null)
    .slice(0, STYLES_MAX)
}

/** 存方案:同名覆盖原位(沿用原 id——挂着的实例靠 id 认,改名才断链);
 *  返回 { list, id, overwrote } 让调用方决定要不要把新定义回写到挂接节点 */
export function saveStylePreset(
  list: readonly RectStyle[],
  preset: RectStyle
): { list: RectStyle[]; id: string; overwrote: boolean } {
  const index = list.findIndex((s) => s.name === preset.name)
  if (index < 0)
    return { list: [...list, preset].slice(0, STYLES_MAX), id: preset.id, overwrote: false }
  const keptId = list[index].id
  return {
    list: list.map((s, i) => (i === index ? { ...preset, id: keptId } : s)),
    id: keptId,
    overwrote: true
  }
}

export function removeStylePreset(list: readonly RectStyle[], id: string): RectStyle[] {
  return list.filter((s) => s.id !== id)
}
