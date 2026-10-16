// 画布标尺(PS / Figma 同款):0 点对齐页面原点,选中对象的占位高亮,刻度疏密随缩放自动换档;
// 尺寸变化、主题切换(<html> 的 data-theme 与内联配色变量)时重画。
import { useEffect, useRef } from 'react'
import { drawRuler, type RulerFrame } from '../../uiWorkbench/drawRuler'

export function Ruler(frame: RulerFrame): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef(frame)
  const { axis, zoom, pan, rangeStart, rangeLength } = frame

  useEffect(() => {
    frameRef.current = { axis, zoom, pan, rangeStart, rangeLength }
    if (canvasRef.current) drawRuler(canvasRef.current, frameRef.current)
  }, [axis, zoom, pan, rangeStart, rangeLength])

  useEffect(() => {
    const canvas = canvasRef.current
    const win = canvas?.ownerDocument.defaultView
    if (!canvas || !win) return
    const redraw = (): void => drawRuler(canvas, frameRef.current)
    const resize = new win.ResizeObserver(redraw)
    resize.observe(canvas)
    const theme = new win.MutationObserver(redraw)
    theme.observe(canvas.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style']
    })
    return () => {
      resize.disconnect()
      theme.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className={`uwb-ruler is-${axis}`} aria-hidden="true" />
}
