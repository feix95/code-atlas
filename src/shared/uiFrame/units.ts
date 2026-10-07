// 单位换算与吸附(第 12 节):内部存逻辑像素,网页类目标显示与导出为 rem。

/** 默认根字号(px);方案元信息里可另记 */
export const DEFAULT_ROOT_PX = 16

/** 拖动吸附步长(逻辑像素,= 0.125rem@16) */
export const SNAP_STEP_PX = 2

/** 靠近同族变量值多少逻辑像素以内即磁吸到该变量 */
export const MAGNET_PX = 2

/** rem 最多保留的小数位(第 12 节 精度) */
const REM_DECIMALS = 4

/** 去掉多余尾零:0.5000 → 0.5;-0 → 0 */
function trimNumber(n: number, decimals: number): string {
  const fixed = Number(n.toFixed(decimals))
  return Object.is(fixed, -0) ? '0' : String(fixed)
}

/** 逻辑像素 → rem 文本;0 写成 0(无单位零在 CSS 里合法且无歧义) */
export function remText(px: number, rootPx: number = DEFAULT_ROOT_PX): string {
  if (px === 0) return '0'
  return `${trimNumber(px / rootPx, REM_DECIMALS)}rem`
}

/** rem 数值(不带单位),design.json 的 dimension 对象要它 */
export function remNumber(px: number, rootPx: number = DEFAULT_ROOT_PX): number {
  return Number((px / rootPx).toFixed(REM_DECIMALS))
}

/** em 文本(字间距用) */
export function emText(value: number): string {
  if (value === 0) return '0'
  return `${trimNumber(value, REM_DECIMALS)}em`
}

/** 普通数字文本(行高、透明度、字重、线宽) */
export function numberText(value: number): string {
  return trimNumber(value, REM_DECIMALS)
}

/** 按步长吸附并夹在 [min, max] 内 */
export function snapPx(px: number, step: number, min: number, max: number): number {
  const snapped = step > 0 ? Math.round(px / step) * step : px
  return Math.min(max, Math.max(min, snapped))
}

/** 界面上的数值读法:2.5rem · 40px */
export function describePx(px: number, rootPx: number = DEFAULT_ROOT_PX): string {
  return `${remText(px, rootPx)} · ${trimNumber(px, 2)}px`
}
