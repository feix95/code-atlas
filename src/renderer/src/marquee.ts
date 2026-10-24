/** 路径跑马灯的节奏计算:纯函数,不碰 DOM(自测见 scripts/selftest-marquee.mts)。
 *
 * 位移口径:溢出量向上取整等于「文本宽 - 可视宽」,正好让长边贴齐可视区一端。
 * 去程/回程按时长按速度算,夹在 400–700ms;路过不甩,停稳再动见 MARQUEE_HOVER_DELAY_MS。
 * 指针离开后停留 MARQUEE_HOLD_MS,再按同一套慢滑收回左边。
 */

export interface MarqueeOptions {
  /** 去程时长(ms):传入则用这个数,不传则按速度算 */
  durMs?: number
  /** 去程速度(px/秒):只在没手写 durMs 时生效 */
  goPxPerSec?: number
  /** 去程时长下限(ms) */
  minDurMs?: number
  /** 去程时长上限(ms) */
  maxDurMs?: number
  /** 回程速度(px/秒) */
  rewindPxPerSec?: number
  /** 回程时长下限(ms) */
  minRewindMs?: number
  /** 回程时长上限(ms) */
  maxRewindMs?: number
}

export interface MarqueePlan {
  /** 溢出像素数:把末尾送进视窗 */
  shift: number
  /** 去程时长(ms) */
  durMs: number
  /** 回程时长(ms):与去程同一套慢滑 */
  rewindMs: number
}

/** 指针停稳多久才开去程(ms):路过划过不甩,避免行缘抖动来回抽 */
export const MARQUEE_HOVER_DELAY_MS = 100
/** 指针离开后再停留多久才收回(ms) */
export const MARQUEE_HOLD_MS = 5000

const DEFAULT_OPTIONS = {
  goPxPerSec: 800,
  minDurMs: 400,
  maxDurMs: 700,
  rewindPxPerSec: 800,
  minRewindMs: 400,
  maxRewindMs: 700
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 取正数配置;缺省、非有限值、非正数一律回落到默认值 */
function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 算出一次滚动需要的位移与两段时长。
 *
 * 返回 null 表示「不需要滚动」:路径装得下(含 1px 内的零头),或宽度读数不可用
 * (例如菜单刚展开、还没完成排版)。
 */
export function marqueePlan(
  textWidth: number,
  viewWidth: number,
  options: MarqueeOptions = {}
): MarqueePlan | null {
  if (!Number.isFinite(textWidth) || !Number.isFinite(viewWidth)) return null
  if (textWidth <= 0 || viewWidth <= 0) return null
  // 1px 内的零头不值得为它滚一次(像素取整造成的假溢出)
  const overflow = textWidth - viewWidth
  if (overflow <= 1) return null
  const shift = Math.ceil(overflow)

  const goSpeed = positiveOr(options.goPxPerSec, DEFAULT_OPTIONS.goPxPerSec)
  const minDur = positiveOr(options.minDurMs, DEFAULT_OPTIONS.minDurMs)
  const maxDur = positiveOr(options.maxDurMs, DEFAULT_OPTIONS.maxDurMs)
  const durMs =
    options.durMs !== undefined && Number.isFinite(options.durMs) && options.durMs > 0
      ? Math.round(options.durMs)
      : Math.round(clamp((shift / goSpeed) * 1000, minDur, maxDur))

  const rewindSpeed = positiveOr(options.rewindPxPerSec, DEFAULT_OPTIONS.rewindPxPerSec)
  const minRewind = positiveOr(options.minRewindMs, DEFAULT_OPTIONS.minRewindMs)
  const maxRewind = positiveOr(options.maxRewindMs, DEFAULT_OPTIONS.maxRewindMs)

  return {
    shift,
    durMs,
    rewindMs: Math.round(clamp((shift / rewindSpeed) * 1000, minRewind, maxRewind))
  }
}
