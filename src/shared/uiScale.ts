// ── 界面缩放档位 ──
// 「界面大小」的三口径同一张尺:preload 的根字号引擎(读存档 + 夹紧)、设置页的滑块/步进钮、
// 主界面侧栏的 rem 换算,全挂这一份。主进程和渲染层都要读,住 shared。

/** 界面缩放下限:80% */
export const SCALE_MIN = 0.8
/** 界面缩放上限:180% */
export const SCALE_MAX = 1.8

/** 根字号基准(px):html 的 font-size = 它 × 系数;像素 → rem 的换算也认这个数 */
export const ROOT_FONT_BASE_PX = 16

/**
 * 缩放系数夹紧(纯函数):非法值(不是数/零/负)回 1,合法值贴边。
 * 超出范围的旧存档不静默跳回 100% —— 用户调过 180% 就给他 180%。
 */
export function clampUiScale(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1
  return Math.min(Math.max(v, SCALE_MIN), SCALE_MAX)
}
