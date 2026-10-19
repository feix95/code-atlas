// 图片预览视口:适应窗口 / 100% / Ctrl+滚轮(光标为中心) / 拖拽平移。
// 变换公式在 shared/imageZoom;这里只接线。子窗经 ownerDocument 取 ResizeObserver 与滚轮。
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  actualImageView,
  canPanImage,
  clampImagePan,
  clampImageZoom,
  fitImageView,
  imageWheelFactor,
  panImage,
  zoomImageAt,
  type ImageSize,
  type ImageView
} from '@shared/imageZoom'

/** 拖过这点才算平移,免得单击/双击被拖势吃掉 */
const PAN_THRESHOLD_PX = 3

export interface ImageViewportApi {
  stageRef: React.RefObject<HTMLDivElement | null>
  view: ImageView
  isFit: boolean
  isPanning: boolean
  canPan: boolean
  zoomPercent: number
  toggleFitActual: () => void
  setZoomPercent: (percent: number) => void
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
}

export function useImageViewport(natural: ImageSize | null): ImageViewportApi {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<ImageView>({ zoom: 1, panX: 0, panY: 0 })
  const [viewport, setViewport] = useState<ImageSize | null>(null)
  const [isFit, setIsFit] = useState(true)
  const [isPanning, setIsPanning] = useState(false)
  const viewRef = useRef(view)
  const naturalRef = useRef(natural)
  const viewportRef = useRef(viewport)
  const isFitRef = useRef(isFit)

  const commit = useCallback((next: ImageView, stickFit: boolean): void => {
    const nat = naturalRef.current
    const vp = viewportRef.current
    const clamped = nat && vp ? clampImagePan(next, nat, vp) : next
    const unchanged =
      clamped.zoom === viewRef.current.zoom &&
      clamped.panX === viewRef.current.panX &&
      clamped.panY === viewRef.current.panY
    // 小图拖不动:夹紧后没位移,别把「适应窗口」档误判成自由缩放
    if (!stickFit && isFitRef.current && unchanged) return
    isFitRef.current = stickFit
    viewRef.current = clamped
    setIsFit(stickFit)
    setView(clamped)
  }, [])

  useStageSize(stageRef, (size) => {
    viewportRef.current = size
    setViewport(size)
    const nat = naturalRef.current
    if (!nat) return
    if (isFitRef.current) commit(fitImageView(nat, size), true)
    else commit(viewRef.current, false)
  })

  useEffect(() => {
    naturalRef.current = natural
    const vp = viewportRef.current
    if (!natural || !vp) return
    if (isFitRef.current) commit(fitImageView(natural, vp), true)
    else commit(viewRef.current, false)
  }, [natural, commit])

  useWheelZoom(stageRef, viewRef, naturalRef, viewportRef, commit)
  const { toggleFitActual, setZoomPercent } = useImageZoomCommands(
    commit,
    viewRef,
    naturalRef,
    viewportRef,
    isFitRef
  )
  const onPointerDown = useImageDrag(viewRef, commit, setIsPanning)

  const canPan = natural !== null && viewport !== null && canPanImage(view, natural, viewport)

  return {
    stageRef,
    view,
    isFit,
    isPanning,
    canPan,
    zoomPercent: Math.round(view.zoom * 100),
    toggleFitActual,
    setZoomPercent,
    onPointerDown,
    onDoubleClick: toggleFitActual
  }
}

function useImageZoomCommands(
  commit: (next: ImageView, stickFit: boolean) => void,
  viewRef: React.RefObject<ImageView>,
  naturalRef: React.RefObject<ImageSize | null>,
  viewportRef: React.RefObject<ImageSize | null>,
  isFitRef: React.RefObject<boolean>
): { toggleFitActual: () => void; setZoomPercent: (percent: number) => void } {
  const toggleFitActual = useCallback((): void => {
    const nat = naturalRef.current
    const vp = viewportRef.current
    if (!nat || !vp) return
    if (isFitRef.current) commit(actualImageView(nat, vp), false)
    else commit(fitImageView(nat, vp), true)
  }, [commit, naturalRef, viewportRef, isFitRef])

  const setZoomPercent = useCallback(
    (percent: number): void => {
      const nat = naturalRef.current
      const vp = viewportRef.current
      if (!nat || !vp) return
      commit(
        zoomImageAt(viewRef.current, clampImageZoom(percent / 100), vp.width / 2, vp.height / 2),
        false
      )
    },
    [commit, viewRef, naturalRef, viewportRef]
  )

  return { toggleFitActual, setZoomPercent }
}

function useStageSize(
  ref: React.RefObject<HTMLDivElement | null>,
  onSize: (size: ImageSize) => void
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

function useWheelZoom(
  ref: React.RefObject<HTMLDivElement | null>,
  viewRef: React.RefObject<ImageView>,
  naturalRef: React.RefObject<ImageSize | null>,
  viewportRef: React.RefObject<ImageSize | null>,
  commit: (next: ImageView, stickFit: boolean) => void
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      const nat = naturalRef.current
      const vp = viewportRef.current
      const current = viewRef.current
      if (!nat || !vp) return
      const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      if (!e.ctrlKey && !e.metaKey) {
        if (!canPanImage(current, nat, vp)) return
        e.preventDefault()
        commit(panImage(current, -dx, -dy), false)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const rect = el.getBoundingClientRect()
      const factor = imageWheelFactor(e.deltaY, e.deltaMode)
      commit(
        zoomImageAt(current, current.zoom * factor, e.clientX - rect.left, e.clientY - rect.top),
        false
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, viewRef, naturalRef, viewportRef, commit])
}

function useImageDrag(
  viewRef: React.RefObject<ImageView>,
  commit: (next: ImageView, stickFit: boolean) => void,
  setIsPanning: (value: boolean) => void
): (e: React.PointerEvent<HTMLDivElement>) => void {
  return useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0 && e.button !== 1) return
      e.preventDefault()
      const target = e.currentTarget
      const startX = e.clientX
      const startY = e.clientY
      let lastX = startX
      let lastY = startY
      let moved = false
      try {
        target.setPointerCapture(e.pointerId)
      } catch {
        // 指针已抬起时 capture 会抛,这轮手势作废
        return
      }
      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - lastX
        const dy = ev.clientY - lastY
        lastX = ev.clientX
        lastY = ev.clientY
        if (!moved) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < PAN_THRESHOLD_PX) return
          moved = true
          setIsPanning(true)
        }
        commit(panImage(viewRef.current, dx, dy), false)
      }
      const onEnd = (): void => {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onEnd)
        target.removeEventListener('pointercancel', onEnd)
        if (moved) setIsPanning(false)
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onEnd)
      target.addEventListener('pointercancel', onEnd)
    },
    [viewRef, commit, setIsPanning]
  )
}
