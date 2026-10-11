// UI 工作台画布视口的纯计算:缩放、平移、适配窗口、标尺刻度。
// 坐标约定:屏幕点(相对视口左上角,CSS px)= pan + 设计点 × zoom;画板左上角为设计坐标原点。
// zoom = 1 时 1 逻辑像素 = 1 CSS px(应用界面缩放改的是根字号,不影响 CSS px)。
import type { ArtboardSize } from '../../../shared/uiWorkbench/artboard.ts'

export interface Viewport {
  zoom: number
  panX: number
  panY: number
}

export interface ViewSize {
  width: number
  height: number
}

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 8
/** 键盘缩放一档的倍率(Ctrl + / Ctrl −) */
export const ZOOM_KEY_FACTOR = 2
/** 滚轮缩放灵敏度:每 1px 滚动量的指数系数 */
export const ZOOM_WHEEL_SENSITIVITY = 0.0015
/** 适配窗口时画板四周留白(CSS px) */
export const FIT_PADDING = 48

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** 以屏幕点 (x, y) 为中心缩放到 nextZoom:该点下的设计坐标保持不动 */
export function zoomAt(view: Viewport, nextZoom: number, x: number, y: number): Viewport {
  const zoom = clampZoom(nextZoom)
  const ratio = zoom / view.zoom
  return { zoom, panX: x - (x - view.panX) * ratio, panY: y - (y - view.panY) * ratio }
}

/** 画板按指定缩放居中 */
export function centerArtboard(board: ArtboardSize, size: ViewSize, zoom: number): Viewport {
  return {
    zoom,
    panX: (size.width - board.width * zoom) / 2,
    panY: (size.height - board.height * zoom) / 2
  }
}

/** 适配窗口:整张画板放进视口(四周留白),放大不超过 100% */
export function fitArtboard(board: ArtboardSize, size: ViewSize): Viewport {
  const availW = Math.max(1, size.width - FIT_PADDING * 2)
  const availH = Math.max(1, size.height - FIT_PADDING * 2)
  const zoom = clampZoom(Math.min(1, availW / board.width, availH / board.height))
  return centerArtboard(board, size, zoom)
}

/** 标尺主刻度候选间距(设计单位) */
const RULER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
/** 主刻度之间至少相隔的屏幕距离(CSS px),保证数字标签不挤 */
export const RULER_MIN_MAJOR_PX = 56
/** 次刻度之间至少相隔的屏幕距离(CSS px) */
export const RULER_MIN_MINOR_PX = 6

export interface RulerTick {
  /** 设计坐标 */
  value: number
  /** 屏幕坐标(CSS px,相对标尺起点) */
  pos: number
  major: boolean
}

/** 主刻度间距:满足最小屏幕间距的最小候选值 */
export function rulerMajorStep(zoom: number): number {
  return RULER_STEPS.find((s) => s * zoom >= RULER_MIN_MAJOR_PX) ?? RULER_STEPS.at(-1)!
}

/** 次刻度细分份数:10 → 5 → 2 → 不细分,取屏幕间距够用的最细档 */
export function rulerSubdivisions(step: number, zoom: number): number {
  return [10, 5, 2].find((n) => (step * zoom) / n >= RULER_MIN_MINOR_PX) ?? 1
}

/** 一条标尺上可见范围内的全部刻度;pan 为该轴的平移量,length 为标尺屏幕长度 */
export function rulerTicks(zoom: number, pan: number, length: number): RulerTick[] {
  const step = rulerMajorStep(zoom)
  const minor = step / rulerSubdivisions(step, zoom)
  const first = Math.floor(-pan / zoom / minor) * minor
  const last = (length - pan) / zoom
  const ticks: RulerTick[] = []
  for (let i = 0; first + i * minor <= last; i++) {
    const value = Math.round((first + i * minor) * 1e6) / 1e6
    const major = Math.abs(value / step - Math.round(value / step)) < 1e-6
    ticks.push({ value, pos: pan + value * zoom, major })
  }
  return ticks
}
