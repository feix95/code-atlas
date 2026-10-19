// ── 图片预览视口(纯计算)──
// 屏幕点(相对舞台左上,CSS px)= pan + 图片像素 × zoom;zoom = 1 为 100% 原尺寸。
// 适应窗口不把小图放大超过 100%;大图等比缩进舞台。主进程不读这份,渲染层与自测共用。

export interface ImageSize {
  width: number
  height: number
}

export interface ImageView {
  zoom: number
  panX: number
  panY: number
}

/** 缩放下限:5% */
export const IMAGE_ZOOM_MIN = 0.05
/** 缩放上限:800% */
export const IMAGE_ZOOM_MAX = 8
/** 滚轮缩放灵敏度:每 1 CSS px 滚动量的指数系数(与 UI 工作台同量级) */
export const IMAGE_ZOOM_WHEEL_SENSITIVITY = 0.0015
/** 适应窗口四周留白(CSS px) */
export const IMAGE_FIT_INSET = 16
/** 判定「已经是适应窗口」的倍率容差 */
export const IMAGE_ZOOM_EPS = 1e-4
/** 底栏缩放菜单档位(百分数,25 一档;数组顺序即菜单从上到下) */
export const IMAGE_ZOOM_PRESETS = [150, 125, 100, 75, 50, 25] as const

export function clampImageZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, zoom))
}

/** 单轴平移夹紧:图比舞台小则居中;大则不允许露出舞台底色 */
export function clampPanAxis(pan: number, content: number, view: number): number {
  if (content <= view) return (view - content) / 2
  return Math.min(0, Math.max(view - content, pan))
}

export function clampImagePan(view: ImageView, natural: ImageSize, viewport: ImageSize): ImageView {
  const zoom = clampImageZoom(view.zoom)
  return {
    zoom,
    panX: clampPanAxis(view.panX, natural.width * zoom, viewport.width),
    panY: clampPanAxis(view.panY, natural.height * zoom, viewport.height)
  }
}

/** 适应窗口:等比缩进,小图不放大 */
export function fitImageView(natural: ImageSize, viewport: ImageSize): ImageView {
  const availW = Math.max(1, viewport.width - IMAGE_FIT_INSET * 2)
  const availH = Math.max(1, viewport.height - IMAGE_FIT_INSET * 2)
  const zoom = clampImageZoom(
    Math.min(1, availW / Math.max(1, natural.width), availH / Math.max(1, natural.height))
  )
  return clampImagePan({ zoom, panX: 0, panY: 0 }, natural, viewport)
}

/** 100% 原尺寸并居中(大图停在可平移范围的中点) */
export function actualImageView(natural: ImageSize, viewport: ImageSize): ImageView {
  return clampImagePan(
    {
      zoom: 1,
      panX: (viewport.width - natural.width) / 2,
      panY: (viewport.height - natural.height) / 2
    },
    natural,
    viewport
  )
}

/** 以屏幕点 (x, y) 为中心缩放到 nextZoom:该点下的图片像素保持不动 */
export function zoomImageAt(view: ImageView, nextZoom: number, x: number, y: number): ImageView {
  const zoom = clampImageZoom(nextZoom)
  const ratio = zoom / view.zoom
  return { zoom, panX: x - (x - view.panX) * ratio, panY: y - (y - view.panY) * ratio }
}

export function panImage(view: ImageView, dx: number, dy: number): ImageView {
  return { ...view, panX: view.panX + dx, panY: view.panY + dy }
}

export function canPanImage(view: ImageView, natural: ImageSize, viewport: ImageSize): boolean {
  const zoom = clampImageZoom(view.zoom)
  return (
    natural.width * zoom > viewport.width + 0.5 || natural.height * zoom > viewport.height + 0.5
  )
}

/** 滚轮 delta → 倍率:向下滚(deltaY>0)缩小;行模式按 16px/行 */
export function imageWheelFactor(deltaY: number, deltaMode: number): number {
  const dy = deltaMode === 1 ? deltaY * 16 : deltaY
  return Math.exp(-dy * IMAGE_ZOOM_WHEEL_SENSITIVITY)
}

/**
 * 解析用户输入的缩放百分比:允许带 %、夹到 5–800。
 * 空串、非数字、≤0 回 null(调用方还原,不静默改成 100%)。
 */
export function parseImageZoomPercent(raw: string): number | null {
  const trimmed = raw.trim().replace(/%/g, '')
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(clampImageZoom(n / 100) * 100)
}
