// UI 工作台画布视口:视口尺寸监测 + 首帧适配 + 滚轮缩放平移 + 鼠标在画布上时的缩放快捷键。
// 交互对照 Figma:Ctrl+滚轮以鼠标为中心缩放、滚轮平移(Shift 横向)、Ctrl+0 回 100%、Ctrl +/− 缩放、Shift+1 适配。
// 监听挂在画布所在窗口上(页签可撕成子窗,子窗是另一个 window)。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArtboardSize } from '../../../shared/uiWorkbench/artboard.ts'
import {
  fitArtboard,
  zoomAt,
  ZOOM_KEY_FACTOR,
  ZOOM_WHEEL_SENSITIVITY,
  type Viewport,
  type ViewSize
} from './viewport.ts'
import { usePointerPan, type PanMode } from './usePointerPan.ts'
import { isEditableTarget } from './isEditableTarget.ts'

/** 滚轮 deltaMode 换算成 CSS px:行模式按 16px/行,页模式按视口高 */
function wheelPixels(e: WheelEvent, pageHeight: number): { dx: number; dy: number } {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageHeight : 1
  return { dx: e.deltaX * unit, dy: e.deltaY * unit }
}

export interface CanvasViewportApi {
  viewportRef: React.RefObject<HTMLDivElement | null>
  view: Viewport
  viewSize: ViewSize | null
  panMode: PanMode
  /** 画板尺寸变更后重新适配窗口 */
  refit: (board: ArtboardSize) => void
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  /** 鼠标是否停在画布上:快捷键(缩放/工具/删除)只在此为真时归画布处理 */
  isHoveredRef: React.RefObject<boolean>
}

export function useCanvasViewport(board: ArtboardSize): CanvasViewportApi {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 })
  const [viewSize, setViewSize] = useState<ViewSize | null>(null)
  const sizeRef = useRef<ViewSize | null>(null)
  const boardRef = useRef(board)
  const isHoveredRef = useRef(false)
  useEffect(() => {
    boardRef.current = board
  })

  const refit = useCallback((next: ArtboardSize) => {
    if (sizeRef.current) setView(fitArtboard(next, sizeRef.current))
  }, [])

  useViewSize(viewportRef, (size) => {
    const isFirst = sizeRef.current === null
    sizeRef.current = size
    setViewSize(size)
    if (isFirst) setView(fitArtboard(boardRef.current, size))
  })
  useWheel(viewportRef, setView, sizeRef)
  const pan = usePointerPan(viewportRef, isHoveredRef, setView)
  useZoomShortcuts(viewportRef, isHoveredRef, setView, sizeRef, boardRef)

  return {
    viewportRef,
    view,
    viewSize,
    panMode: pan.panMode,
    refit,
    onPointerDown: pan.onPointerDown,
    isHoveredRef
  }
}

/** 视口尺寸监测;用画布所在窗口的 ResizeObserver(子窗的元素归子窗管) */
function useViewSize(
  ref: React.RefObject<HTMLDivElement | null>,
  onSize: (size: ViewSize) => void
): void {
  const onSizeRef = useRef(onSize)
  useEffect(() => {
    onSizeRef.current = onSize
  })
  useEffect(() => {
    const el = ref.current
    const win = el?.ownerDocument.defaultView
    if (!el || !win) return
    const observer = new win.ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) onSizeRef.current({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
}

/** 滚轮:Ctrl/Cmd(含触控板双指捏合)= 以鼠标为中心缩放;否则平移,Shift 把纵向滚动转横向 */
function useWheel(
  ref: React.RefObject<HTMLDivElement | null>,
  setView: React.Dispatch<React.SetStateAction<Viewport>>,
  sizeRef: React.RefObject<ViewSize | null>
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const { dx, dy } = wheelPixels(e, sizeRef.current?.height ?? 0)
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const factor = Math.exp(-dy * ZOOM_WHEEL_SENSITIVITY)
        setView((v) => zoomAt(v, v.zoom * factor, e.clientX - rect.left, e.clientY - rect.top))
        return
      }
      const [moveX, moveY] = e.shiftKey && dx === 0 ? [dy, 0] : [dx, dy]
      setView((v) => ({ ...v, panX: v.panX - moveX, panY: v.panY - moveY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, setView, sizeRef])
}

/** 鼠标停在画布上时接管缩放快捷键;preventDefault 后界面缩放键(useZoomKeys)跳过同一事件 */
function useZoomShortcuts(
  ref: React.RefObject<HTMLDivElement | null>,
  isHoveredRef: React.RefObject<boolean>,
  setView: React.Dispatch<React.SetStateAction<Viewport>>,
  sizeRef: React.RefObject<ViewSize | null>,
  boardRef: React.RefObject<ArtboardSize>
): void {
  useEffect(() => {
    const win = ref.current?.ownerDocument.defaultView
    if (!win) return
    const onKey = (e: KeyboardEvent): void => {
      const size = sizeRef.current
      if (!isHoveredRef.current || !size || isEditableTarget(e.target) || e.altKey) return
      const cx = size.width / 2
      const cy = size.height / 2
      const mod = e.ctrlKey || e.metaKey
      if (!mod && e.shiftKey && e.code === 'Digit1') setView(fitArtboard(boardRef.current, size))
      else if (mod && !e.shiftKey && e.key === '0') setView((v) => zoomAt(v, 1, cx, cy))
      else if (mod && (e.key === '=' || e.key === '+'))
        setView((v) => zoomAt(v, v.zoom * ZOOM_KEY_FACTOR, cx, cy))
      else if (mod && e.key === '-') setView((v) => zoomAt(v, v.zoom / ZOOM_KEY_FACTOR, cx, cy))
      else return
      e.preventDefault()
    }
    win.addEventListener('keydown', onKey, true)
    return () => win.removeEventListener('keydown', onKey, true)
  }, [ref, isHoveredRef, setView, sizeRef, boardRef])
}
