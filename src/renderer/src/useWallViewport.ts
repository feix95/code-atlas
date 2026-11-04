// 线索桌视口的事件层:滚轮缩放、拖空白处平移、按钮缩放与看全部;纯计算在 wikiWallViewport。
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  WALL_DRAG_THRESHOLD,
  fitWallView,
  initialWallView,
  zoomAt,
  type WallView
} from './wikiWallViewport'

export interface WallViewport {
  view: WallView
  setZoom: (z: number) => void
  fit: () => void
  /** 挂在桌面容器的 onPointerDown 上:按在空白处开始平移;没挪动就当点空白 */
  onPanStart: (event: React.PointerEvent<HTMLElement>, onBlankClick: () => void) => void
}

export function useWallViewport(
  scrollRef: RefObject<HTMLDivElement | null>,
  boardW: number,
  boardH: number,
  ready: boolean
): WallViewport {
  const [view, setView] = useState<WallView>({ x: 0, y: 0, z: 1 })
  const viewRef = useRef(view)
  const placedRef = useRef(false)

  useEffect(() => {
    viewRef.current = view
  }, [view])

  // 数据到位后定一次初始视角;之后的平移缩放都由用户说了算
  useEffect(() => {
    const el = scrollRef.current
    if (!ready || placedRef.current || el === null) return
    placedRef.current = true
    setView(initialWallView(boardW, boardH, el.clientWidth, el.clientHeight))
  }, [ready, boardW, boardH, scrollRef])

  // 滚轮缩放要拦住默认滚动,React 的 onWheel 是被动监听拦不住,只能手挂
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = Math.exp(-event.deltaY * 0.0015)
      setView((v) => zoomAt(v, v.z * factor, event.clientX - rect.left, event.clientY - rect.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scrollRef])

  const setZoom = useCallback(
    (z: number) => {
      const el = scrollRef.current
      const mx = el === null ? 0 : el.clientWidth / 2
      const my = el === null ? 0 : el.clientHeight / 2
      setView((v) => zoomAt(v, z, mx, my))
    },
    [scrollRef]
  )

  const fit = useCallback(() => {
    const el = scrollRef.current
    if (el !== null) setView(fitWallView(boardW, boardH, el.clientWidth, el.clientHeight))
  }, [scrollRef, boardW, boardH])

  const onPanStart = useCallback(
    (event: React.PointerEvent<HTMLElement>, onBlankClick: () => void) => {
      if (event.button !== 0) return
      const target = event.currentTarget
      const startX = event.clientX
      const startY = event.clientY
      const origin = viewRef.current
      let moved = false
      target.setPointerCapture(event.pointerId)
      const move = (e: PointerEvent): void => {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        if (!moved && Math.hypot(dx, dy) < WALL_DRAG_THRESHOLD) return
        moved = true
        target.classList.add('is-panning')
        setView({ ...origin, x: origin.x + dx, y: origin.y + dy })
      }
      const up = (): void => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', up)
        target.removeEventListener('pointercancel', up)
        target.classList.remove('is-panning')
        if (!moved) onBlankClick()
      }
      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', up)
      target.addEventListener('pointercancel', up)
    },
    []
  )

  return { view, setZoom, fit, onPanStart }
}
