/** 路径跑马灯的节奏计算:纯函数,不碰 DOM(自测见 scripts/selftest-marquee.mts)。
 *
 * 位移口径:左移正好等于「文本宽 - 可视宽」,滚到底时路径末字贴着可视区右缘,
 * 不会滚过头也不会差一截。去程按固定速度换算时长(慢速、可读),
 * 回程另给一档更快的速度,鼠标移开后迅速归位。
 */

export interface MarqueeOptions {
  /** 去程速度(px/秒) */
  speedPxPerSec?: number
  /** 去程时长下限(ms):位移再短也别一闪而过 */
  minDurMs?: number
  /** 去程时长上限(ms):超长路径别让人等到不耐烦 */
  maxDurMs?: number
  /** 回程速度(px/秒) */
  rewindPxPerSec?: number
  /** 回程时长下限(ms) */
  minRewindMs?: number
  /** 回程时长上限(ms) */
  maxRewindMs?: number
}

export interface MarqueePlan {
  /** 需要左移的像素数 */
  shift: number
  /** 去程时长(ms) */
  durMs: number
  /** 回程时长(ms) */
  rewindMs: number
}

const DEFAULT_OPTIONS: Required<MarqueeOptions> = {
  speedPxPerSec: 28,
  minDurMs: 1200,
  maxDurMs: 6000,
  rewindPxPerSec: 400,
  minRewindMs: 160,
  maxRewindMs: 260
}

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

  const speed = positiveOr(options.speedPxPerSec, DEFAULT_OPTIONS.speedPxPerSec)
  const rewindSpeed = positiveOr(options.rewindPxPerSec, DEFAULT_OPTIONS.rewindPxPerSec)
  const minDur = positiveOr(options.minDurMs, DEFAULT_OPTIONS.minDurMs)
  const maxDur = positiveOr(options.maxDurMs, DEFAULT_OPTIONS.maxDurMs)
  const minRewind = positiveOr(options.minRewindMs, DEFAULT_OPTIONS.minRewindMs)
  const maxRewind = positiveOr(options.maxRewindMs, DEFAULT_OPTIONS.maxRewindMs)

  return {
    shift,
    durMs: Math.round(clamp((shift / speed) * 1000, minDur, maxDur)),
    rewindMs: Math.round(clamp((shift / rewindSpeed) * 1000, minRewind, maxRewind))
  }
}
