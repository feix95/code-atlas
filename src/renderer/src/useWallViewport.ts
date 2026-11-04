// 线索桌视口的事件层:滚轮缩放、拖空白处平移、按钮缩放与看全部;纯计算在 wikiWallViewport。
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  WALL_DRAG_THRESHOLD,
  fitWallView,
  initialWallView,
  zoomAt,
  type WallView
} from './wikiWallViewport'
import { trackWallPointer } from './wallPointer'

/** 板面上实际有东西的范围;往左往上拖出去的卡会让 x、y 变成负数 */
export interface WallBounds {
  x: number
  y: number
  w: number
  h: number
}

/** 把「板面从 0 开始」算出的视角挪到实际范围的左上角 */
const shiftView = (v: WallView, b: WallBounds): WallView => ({
  ...v,
  x: v.x - b.x * v.z,
  y: v.y - b.y * v.z
})

export interface WallViewport {
  view: WallView
  setZoom: (z: number) => void
  fit: () => void
  /** 挂在桌面容器的 onPointerDown 上:按在空白处开始平移;没挪动就当点空白 */
  onPanStart: (event: React.PointerEvent<HTMLElement>, onBlankClick: () => void) => void
}

export function useWallViewport(
  scrollRef: RefObject<HTMLDivElement | null>,
  bounds: WallBounds,
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
    setView(shiftView(initialWallView(bounds.w, bounds.h, el.clientWidth, el.clientHeight), bounds))
  }, [ready, bounds, scrollRef])

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
    if (el !== null) {
      setView(shiftView(fitWallView(bounds.w, bounds.h, el.clientWidth, el.clientHeight), bounds))
    }
  }, [scrollRef, bounds])

  const onPanStart = useCallback(
    (event: React.PointerEvent<HTMLElement>, onBlankClick: () => void) => {
      if (event.button !== 0) return
      const target = event.currentTarget
      const startX = event.clientX
      const startY = event.clientY
      const origin = viewRef.current
      let moved = false
      const move = (e: PointerEvent): void => {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        if (!moved && Math.hypot(dx, dy) < WALL_DRAG_THRESHOLD) return
        moved = true
        target.classList.add('is-panning')
        setView({ ...origin, x: origin.x + dx, y: origin.y + dy })
      }
      const up = (): void => {
        target.classList.remove('is-panning')
        if (!moved) onBlankClick()
      }
      trackWallPointer(target, event.pointerId, move, up)
    },
    []
  )

  return { view, setZoom, fit, onPanStart }
}
