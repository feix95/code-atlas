// 画布的尺寸与设备像素比适配:尺寸变化时保持画面中心不动,绘制缓冲按 DPR 放大。
import { useEffect, useRef } from 'react'
import type { Transform } from './drawGraph'

export interface ViewportSize {
  w: number
  h: number
  dpr: number
}

export function useGraphCanvasSize(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  transformRef: React.RefObject<Transform>,
  requestDraw: () => void
): React.RefObject<ViewportSize> {
  const sizeRef = useRef<ViewportSize>({ w: 0, h: 0, dpr: 1 })
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const apply = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const prev = sizeRef.current
      const tf = transformRef.current
      // 首次:原点放画布中央;之后尺寸变化保持中心不动
      if (prev.w === 0) Object.assign(tf, { x: rect.width / 2, y: rect.height / 2 })
      else
        Object.assign(tf, {
          x: tf.x + (rect.width - prev.w) / 2,
          y: tf.y + (rect.height - prev.h) / 2
        })
      sizeRef.current = { w: rect.width, h: rect.height, dpr }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      requestDraw()
    }
    const ro = new ResizeObserver(apply)
    ro.observe(canvas)
    apply()
    return () => ro.disconnect()
  }, [canvasRef, requestDraw, transformRef])
  return sizeRef
}
