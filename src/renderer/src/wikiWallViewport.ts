// 线索桌的视口:平移与缩放的纯计算。板面用 transform 平移缩放,不靠浏览器滚动条;
// 缩放以鼠标所在点为中心,点下的那块纸不跑。挂事件的部分在 useWallViewport。

export interface WallView {
  x: number
  y: number
  z: number
}

export const WALL_ZOOM_MIN = 0.25
export const WALL_ZOOM_MAX = 2
/** 低于这个缩放只显示标题:字太小时正文和页脚只是噪点 */
export const WALL_FAR_ZOOM = 0.6
/** 按下后挪动超过这么多像素才算拖动,否则还是一次点击 */
export const WALL_DRAG_THRESHOLD = 4

export function clampZoom(z: number): number {
  return Math.min(WALL_ZOOM_MAX, Math.max(WALL_ZOOM_MIN, z))
}

/** 以屏幕上 (mx, my) 为中心缩放到 z:该点下的板面坐标保持不动 */
export function zoomAt(view: WallView, z: number, mx: number, my: number): WallView {
  const next = clampZoom(z)
  const k = next / view.z
  return { x: mx - (mx - view.x) * k, y: my - (my - view.y) * k, z: next }
}

/** 整张板放进视口:不放大超过 100%,太小时按下限并靠左上 */
export function fitWallView(
  boardW: number,
  boardH: number,
  viewW: number,
  viewH: number
): WallView {
  if (boardW <= 0 || boardH <= 0 || viewW <= 0 || viewH <= 0) return { x: 0, y: 0, z: 1 }
  const z = clampZoom(Math.min(1, viewW / boardW, viewH / boardH))
  return {
    x: Math.max(0, (viewW - boardW * z) / 2),
    y: Math.max(0, (viewH - boardH * z) / 2),
    z
  }
}

/** 初次打开的视角:放得下就整张放下,放不下也别缩到看不清,宁可只看左上一角 */
export function initialWallView(
  boardW: number,
  boardH: number,
  viewW: number,
  viewH: number
): WallView {
  const fit = fitWallView(boardW, boardH, viewW, viewH)
  return fit.z >= WALL_FAR_ZOOM ? fit : { x: 0, y: 0, z: WALL_FAR_ZOOM }
}
