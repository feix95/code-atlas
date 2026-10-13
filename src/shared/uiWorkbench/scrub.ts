// 标签拖拽调数值(Photoshop 的 scrubby slider)的步长换算(纯逻辑,无 React / DOM)。
// 向右拖增大、向左拖减小;每 SCRUB_PX_PER_STEP 像素 = 1 步,Shift 按 SCRUB_SHIFT_MULTIPLIER 倍放大。
// 不足一步的位移累积在 rest 里带到下一帧,慢拖也不丢。

/** 每多少像素的水平位移算一步 */
export const SCRUB_PX_PER_STEP = 2
/** 按住 Shift 时每步的倍率 */
export const SCRUB_SHIFT_MULTIPLIER = 10

export interface ScrubStep {
  /** 本帧换算出的整数增量(可为负) */
  delta: number
  /** 未凑满一步的累积位移(单位:步),下一帧传回 */
  rest: number
}

export function scrubStep(rest: number, movementX: number, isShift: boolean): ScrubStep {
  const total = rest + movementX / SCRUB_PX_PER_STEP
  const whole = Math.trunc(total)
  return { delta: whole * (isShift ? SCRUB_SHIFT_MULTIPLIER : 1), rest: total - whole }
}
