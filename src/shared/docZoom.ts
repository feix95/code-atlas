// ── 文档字号缩放(doc zoom)──
// 预览正文的字号系数,Ctrl+滚轮挂在 .code-view 上走它 —— 与界面缩放(uiScale)两本账:
// uiScale 动根字号管全界面,docZoom 只乘预览文档的字号。主进程/渲染层都可能读,住 shared。

/** 文档缩放下限:50% */
export const DOC_ZOOM_MIN = 0.5
/** 文档缩放上限:300% */
export const DOC_ZOOM_MAX = 3
/** 滚轮一格一档:10%(文档缩放惯例比界面缩放的 5% 粗一档) */
export const DOC_ZOOM_STEP = 0.1

/** 系数夹紧(纯函数):非法值回 1,合法值贴边 —— 跟 clampUiScale 同脾气 */
export function clampDocZoom(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1
  return Math.min(Math.max(v, DOC_ZOOM_MIN), DOC_ZOOM_MAX)
}
