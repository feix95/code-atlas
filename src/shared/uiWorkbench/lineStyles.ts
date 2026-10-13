// 直线外观样式(纯逻辑,无 React / DOM):整包方案 = 描边(颜色/线宽/线型)+ 端点样式,不含端点坐标。
// 规则同矩形样式(styles.ts):节点经 styleId 挂接,改定义由调用方批量回写(活链接);
// 手动改线的外观 → applyLinePatch 静默脱钩;存档反序列化逐字段校验,坏的丢弃。
import { LINE_CAPS, type LineCap, type LineNode } from './line.ts'
import type { RectStroke } from './node.ts'
import { STYLE_NAME_MAX, STYLES_MAX, isRecord, toStroke } from './styles.ts'

export interface LineAppearance {
  stroke: RectStroke
  cap: LineCap
}

export interface LineStyle extends LineAppearance {
  id: string
  name: string
}

/** 直线的外观两件套 → 方案载荷;存方案与默认外观共用同一出口 */
export function lineAppearanceOf(node: LineAppearance): LineAppearance {
  return { stroke: { ...node.stroke }, cap: node.cap }
}

/** 挂着样式的线外观 → 取样式最新定义(活链接);样式已被删除按「无样式」落位,保留最后已知数值 */
export function resolveLinkedLineLook(
  look: LineAppearance & { styleId: string | null },
  styles: readonly LineStyle[]
): LineAppearance & { styleId: string | null } {
  const linked = styles.find((s) => s.id === look.styleId)
  if (!linked) return { stroke: look.stroke, cap: look.cap, styleId: null }
  return { ...lineAppearanceOf(linked), styleId: linked.id }
}

function toLineStyle(value: unknown): LineStyle | null {
  if (!isRecord(value)) return null
  const { id, name, stroke, cap } = value
  if (typeof id !== 'string' || id === '') return null
  if (typeof name !== 'string' || name.trim() === '') return null
  const s = toStroke(stroke)
  if (s === null || !LINE_CAPS.includes(cap as LineCap)) return null
  return { id, name: name.trim().slice(0, STYLE_NAME_MAX), stroke: s, cap: cap as LineCap }
}

/** 已 JSON.parse 的存档 → 合法直线样式列表;坏条目丢弃,超限截断 */
export function sanitizeLineStyles(value: unknown): LineStyle[] {
  if (!Array.isArray(value)) return []
  return value
    .map(toLineStyle)
    .filter((s): s is LineStyle => s !== null)
    .slice(0, STYLES_MAX)
}

/** 直线节点的挂接 id 是否仍指向存在的样式(悬空按无样式) */
export function linkedLineStyleId(node: LineNode, styles: readonly LineStyle[]): string {
  return styles.some((s) => s.id === node.styleId) ? (node.styleId ?? '') : ''
}
