// 线索桌视口的事件层:滚轮缩放、拖空白处平移、按钮缩放与看全部;纯计算在 wikiWallViewport。
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  WALL_DRAG_THRESHOLD,
  WALL_ZOOM_MAX,
  WALL_ZOOM_MIN,
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

/** 已经缩到头还接着滚这么多,才算「滚到底」要换层,免得滚过头误进 */
const OVERSCROLL_TO_SWITCH = 260
/** 停手这么久,攒下的「滚到底」清零 */
const OVERSCROLL_IDLE_MS = 500
/** 缩小最多缩到整层看全时的这一比例 */
const OUT_FLOOR = 0.6

export function useWallViewport(
  scrollRef: RefObject<HTMLDivElement | null>,
  boardW: number,
  boardH: number,
  ready: boolean,
  /** 换了一层就重新定初始视角 */
  resetKey: string,
  /** 缩到头还接着滚:放大方向为 in、缩小为 out,坐标是鼠标所在的屏幕点 */
  onOverZoom: (dir: 'in' | 'out', clientX: number, clientY: number) => void
): WallViewport {
  const [view, setView] = useState<WallView>({ x: 0, y: 0, z: 1 })
  const viewRef = useRef(view)
  /** 已定过初始视角的那一层 */
  const placedRef = useRef<string | null>(null)
  const overRef = useRef({ dir: 'in' as 'in' | 'out', sum: 0, at: 0 })
  const overZoomRef = useRef(onOverZoom)
  const boardRef = useRef({ w: boardW, h: boardH })

  useEffect(() => {
    viewRef.current = view
    overZoomRef.current = onOverZoom
    boardRef.current = { w: boardW, h: boardH }
  })

  // 数据到位后定一次初始视角;之后的平移缩放都由用户说了算
  useEffect(() => {
    const el = scrollRef.current
    if (!ready || placedRef.current === resetKey || el === null) return
    placedRef.current = resetKey
    setView(initialWallView(boardW, boardH, el.clientWidth, el.clientHeight))
  }, [ready, boardW, boardH, scrollRef, resetKey])

  // 滚轮缩放要拦住默认滚动,React 的 onWheel 是被动监听拦不住,只能手挂
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = Math.exp(-event.deltaY * 0.0015)
      const v = viewRef.current
      const dir = event.deltaY < 0 ? 'in' : 'out'
      // 缩小的底线:整层放进视口后再缩一半;再往外滚就是回上一层
      const board = boardRef.current
      const fitZ = fitWallView(board.w, board.h, el.clientWidth, el.clientHeight).z
      const floor = Math.max(WALL_ZOOM_MIN, fitZ * OUT_FLOOR)
      const atEdge = dir === 'in' ? v.z >= WALL_ZOOM_MAX : v.z * factor < floor
      const over = overRef.current
      if (atEdge && event.deltaY !== 0) {
        if (over.dir !== dir || event.timeStamp - over.at > OVERSCROLL_IDLE_MS) over.sum = 0
        over.dir = dir
        over.at = event.timeStamp
        over.sum += Math.abs(event.deltaY)
        if (over.sum >= OVERSCROLL_TO_SWITCH) {
          over.sum = 0
          overZoomRef.current(dir, event.clientX, event.clientY)
        }
        return
      }
      over.sum = 0
      setView((p) => zoomAt(p, p.z * factor, event.clientX - rect.left, event.clientY - rect.top))
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
