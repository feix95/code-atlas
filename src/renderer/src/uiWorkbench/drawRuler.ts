// 标尺绘制(canvas 2D):底色 + 画板范围底 + 主次刻度 + 主刻度数字。
// 颜色与字体从标尺元素的计算样式读取(CSS 变量统一管理,换主题后重画即跟上)。
import { rulerTicks, type RulerTick } from './viewport.ts'

export type RulerAxis = 'horizontal' | 'vertical'

export interface RulerFrame {
  axis: RulerAxis
  zoom: number
  /** 该轴平移量(CSS px) */
  pan: number
  /** 画板在该轴上的设计长度,用于画范围底 */
  boardLength: number
}

interface RulerCanvas {
  ctx: CanvasRenderingContext2D
  style: CSSStyleDeclaration
  width: number
  height: number
  isHorizontal: boolean
}

/** 主刻度线长占标尺厚度的比例;次刻度 */
const MAJOR_TICK_RATIO = 0.55
const MINOR_TICK_RATIO = 0.25
/** 数字标签与主刻度线的间距(CSS px) */
const LABEL_OFFSET = 3

export function formatRulerValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

/** 按设备像素比准备画布,返回绘制上下文;画布不可用返回 null */
function prepareCanvas(canvas: HTMLCanvasElement, axis: RulerAxis): RulerCanvas | null {
  const ctx = canvas.getContext('2d')
  const win = canvas.ownerDocument.defaultView
  if (!ctx || !win) return null
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const dpr = win.devicePixelRatio || 1
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return {
    ctx,
    style: win.getComputedStyle(canvas),
    width,
    height,
    isHorizontal: axis === 'horizontal'
  }
}

function drawBackground(rc: RulerCanvas, frame: RulerFrame): void {
  const { ctx, style, width, height, isHorizontal } = rc
  ctx.fillStyle = style.getPropertyValue('--uwb-ruler-bg')
  ctx.fillRect(0, 0, width, height)
  const rangeLen = frame.boardLength * frame.zoom
  ctx.fillStyle = style.getPropertyValue('--uwb-ruler-range')
  if (isHorizontal) ctx.fillRect(frame.pan, 0, rangeLen, height)
  else ctx.fillRect(0, frame.pan, width, rangeLen)
}

function drawTick(rc: RulerCanvas, tick: RulerTick): void {
  const { ctx, width, height, isHorizontal } = rc
  const pos = Math.round(tick.pos) + 0.5
  const tickLen =
    (isHorizontal ? height : width) * (tick.major ? MAJOR_TICK_RATIO : MINOR_TICK_RATIO)
  ctx.beginPath()
  if (isHorizontal) {
    ctx.moveTo(pos, height)
    ctx.lineTo(pos, height - tickLen)
  } else {
    ctx.moveTo(width, pos)
    ctx.lineTo(width - tickLen, pos)
  }
  ctx.stroke()
  if (!tick.major) return
  const label = formatRulerValue(tick.value)
  if (isHorizontal) {
    ctx.fillText(label, pos + LABEL_OFFSET, LABEL_OFFSET)
    return
  }
  ctx.save()
  ctx.translate(LABEL_OFFSET, pos - LABEL_OFFSET)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(label, 0, 0)
  ctx.restore()
}

export function drawRuler(canvas: HTMLCanvasElement, frame: RulerFrame): void {
  const rc = prepareCanvas(canvas, frame.axis)
  if (!rc) return
  drawBackground(rc, frame)
  const { ctx, style } = rc
  ctx.strokeStyle = style.getPropertyValue('--uwb-ruler-tick')
  ctx.fillStyle = style.getPropertyValue('--uwb-ruler-text')
  ctx.font = `${style.fontSize} ${style.fontFamily}`
  ctx.lineWidth = 1
  ctx.textBaseline = 'top'
  const length = rc.isHorizontal ? rc.width : rc.height
  for (const tick of rulerTicks(frame.zoom, frame.pan, length)) drawTick(rc, tick)
}
