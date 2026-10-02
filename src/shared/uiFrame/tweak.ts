// 键盘微调与前后对比(§5.6):方向键 ±1 步长、Shift + 方向键 ±4 步长。
// 步长口径与拖动手柄一致:像素变量 = 吸附步长(0.125rem),字重 10,其余数字 0.05。
import { SNAP_STEP_PX } from './units.ts'
import type { TokenValue } from './types.ts'

/** 方向键微调一次走多少;Shift 时调用方乘 4 */
export function nudgeStep(value: TokenValue): number {
  if (value.kind === 'dimension') return SNAP_STEP_PX
  if (value.kind === 'fontWeight') return 10
  if (value.kind === 'em') return 0.05
  if (value.kind === 'number') return 0.05
  return 1
}

/** 该变量能不能用方向键微调(数字类) */
export function nudgeable(value: TokenValue): boolean {
  return (
    value.kind === 'dimension' ||
    value.kind === 'number' ||
    value.kind === 'fontWeight' ||
    value.kind === 'em'
  )
}

function numberOf(value: TokenValue): number {
  return value.kind === 'dimension' ? value.px : 'value' in value ? value.value : 0
}

/**
 * 方向键微调:dir=+1 增 / -1 减,steps=Shift 时 4 否则 1。
 * min/max 给手柄的上下界;不给就只在数字类上兜底 >= 0 之外的值不拦(行高可为任意正值)。
 * 返回新的字面量;不改变量的种类(dimension 仍是 dimension)。
 */
export function nudgeValue(
  value: TokenValue,
  dir: 1 | -1,
  steps: number,
  min = -Infinity,
  max = Infinity
): TokenValue | null {
  if (!nudgeable(value)) return null
  const next = Math.min(max, Math.max(min, numberOf(value) + nudgeStep(value) * steps * dir))
  const rounded = Number(next.toFixed(4))
  if (rounded === numberOf(value)) return null
  if (value.kind === 'dimension') return { kind: 'dimension', px: rounded }
  if (value.kind === 'em') return { kind: 'em', value: rounded }
  if (value.kind === 'fontWeight') return { kind: 'fontWeight', value: rounded }
  return { kind: 'number', value: rounded }
}
