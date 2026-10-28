// 大纲浮窗的拖动/拉伸现场:抓手按住拖位置,右下角拉手拉尺寸(左上角钉住),方向键微调。
// 手势进行中只改本地 live 账,松手才落盘;上屏前每次按当前预览栏大小夹一遍,
// 预览栏变窄、滚动、浮窗自己变大都会重量,不让它跑出栏外。
// 宽高不留多余空白:拉的途中随鼠标走,松手若比内容尺寸还大就平滑吸回内容尺寸(回到自适应)。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { getOutlinePlacement, setOutlinePlacement, subscribeOutlinePlacement } from './codePrefs'
import {
  capToContent,
  clampCollapsed,
  clampPlacement,
  isDragStarted,
  moveCollapsed,
  movePlacement,
  resizePlacement,
  settleResize,
  snapFrame,
  type OutlineBounds,
  type OutlinePlacement
} from './outlinePlacement'
import {
  measureBounds,
  measureWidestItem,
  remPx,
  sameBounds,
  type OutlineRefs
} from './outlineMeasure'

/** 方向键一步挪多远(rem);按住 Shift 走大步 */
const NUDGE_REM = 1
const NUDGE_BIG_REM = 4
/** 吸回动画留多久再撤掉 live 账;要比 doc-outline.css 里 .is-snapping 的过渡(--dur-2)略长 */
const SNAP_SETTLE_MS = 200

// 窗口宽度变了:浮窗在屏上的位置钉住不动。账里的 right 是相对坞右缘记的,坞右缘跟着窗口右缘走,
// 把这段位移补回去 —— 位置跟页面走,不跟预览区外框走(拖文件树分隔条不改变窗口宽度,不受影响)
if (typeof window !== 'undefined') {
  let viewportWidth = window.innerWidth
  window.addEventListener('resize', () => {
    const next = window.innerWidth
    const shift = next - viewportWidth
    viewportWidth = next
    const p = getOutlinePlacement()
    if (Math.abs(shift) < 0.5 || p.right === null) return
    setOutlinePlacement({ ...p, right: p.right + shift })
  })
}

type GestureKind = 'move' | 'resize'

interface Gesture {
  kind: GestureKind
  pointerId: number
  x: number
  y: number
  start: OutlinePlacement & { right: number; top: number }
  from: { width: number; height: number }
  bounds: OutlineBounds
  last: OutlinePlacement
  /** 挪够 DRAG_START_PX 才为 true;没挪够的松手什么都不改 */
  hasMoved: boolean
}

/** 本地 live 账(只在内存,从不落盘):drag = 手势进行中(不受内容尺寸限制),snap = 松手后正在吸回内容尺寸 */
type LivePlacement = { phase: 'drag' | 'snap'; placement: OutlinePlacement }

function arrowDelta(e: React.KeyboardEvent<HTMLElement>, step: number): [number, number] | null {
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step]
  }
  return moves[e.key] ?? null
}

/** 实测几何;最长条目宽按「条目或开合变了才重量」缓存(undefined = 待重量) */
function useMeasure(refs: OutlineRefs): {
  measure: () => OutlineBounds | null
  invalidate: () => void
} {
  const widestRef = useRef<number | null | undefined>(undefined)
  const { viewRef, dockRef, panelRef } = refs
  const measure = useCallback((): OutlineBounds | null => {
    const panel = panelRef.current
    if (widestRef.current === undefined && panel) widestRef.current = measureWidestItem(panel)
    return measureBounds({ viewRef, dockRef, panelRef }, widestRef.current ?? null)
  }, [viewRef, dockRef, panelRef])
  const invalidate = useCallback((): void => {
    widestRef.current = undefined
  }, [])
  return { measure, invalidate }
}

export function useOutlinePlacement(
  refs: OutlineRefs,
  isOpen: boolean,
  /** 条目列表的指纹(换了文档就变):变了要重量内容宽 */
  contentKey: unknown
): {
  style: React.CSSProperties | undefined
  isDragging: boolean
  isSnapping: boolean
  /** 刚结束的是一次真拖动吗(读一次就清零):圆钮据此决定松手后的 click 要不要展开 */
  consumeDrag: () => boolean
  grip: React.HTMLAttributes<HTMLElement>
  resizer: React.HTMLAttributes<HTMLElement>
} {
  const stored = useSyncExternalStore(subscribeOutlinePlacement, getOutlinePlacement)
  const [live, setLive] = useState<LivePlacement | null>(null)
  const [bounds, setBounds] = useState<OutlineBounds | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const snapTimerRef = useRef(0)
  const draggedRef = useRef(false)
  const { viewRef, panelRef } = refs
  const { measure, invalidate } = useMeasure(refs)
  // 位置夹边按屏上形态量:展开时手动宽高就是屏上的宽高;收起时只剩圆钮,存下的展开宽高不能拿来算
  const clampByForm = useCallback(
    (p: OutlinePlacement, b: OutlineBounds) =>
      isOpen ? clampPlacement(p, b) : clampCollapsed(p, b),
    [isOpen]
  )
  // 挪位置同理:收起态的位移按圆钮尺寸夹,不然存的展开宽度会把圆钮拦在半路
  const moveByForm = useCallback(
    (
      start: OutlinePlacement & { right: number; top: number },
      dx: number,
      dy: number,
      b: OutlineBounds
    ) => (isOpen ? movePlacement(start, dx, dy, b) : moveCollapsed(start, dx, dy, b)),
    [isOpen]
  )

  useLayoutEffect(() => {
    const view = viewRef.current
    const panel = panelRef.current
    if (!view || !panel) return
    invalidate()
    const update = (): void => {
      const next = measure()
      setBounds((prev) => (sameBounds(prev, next) ? prev : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(view)
    observer.observe(panel)
    view.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      view.removeEventListener('scroll', update)
    }
  }, [viewRef, panelRef, measure, invalidate, isOpen, contentKey])

  /**
   * 收尾一次手势:挪过才落盘(必要时吸回内容尺寸),只是按了一下就当没发生。
   * 松手、指针取消、丢了指针捕获(页签被藏起来、元素被拆)、窗口失焦、页面转入后台、
   * 换文档、卸载,都走这里 —— 任何一条路都不会让拖动态残留。
   */
  const endGesture = useCallback((): void => {
    const g = gestureRef.current
    if (!g) return
    gestureRef.current = null
    if (!g.hasMoved) return
    // 只拦紧跟在这次松手后面的那一下 click(同一轮输入事件里派发,早于任何定时器),
    // 过后清零,免得拖完面板再去点圆钮时被误拦
    draggedRef.current = true
    window.setTimeout(() => {
      draggedRef.current = false
    }, 0)
    const b = measure() ?? g.bounds
    const settled = g.kind === 'resize' ? settleResize(g.last, b) : g.last
    setOutlinePlacement(settled)
    if (settled.width === g.last.width && settled.height === g.last.height) {
      setLive(null)
      return
    }
    // 先以显式像素尺寸过渡到内容尺寸,过渡完再交给自适应档
    setLive({ phase: 'snap', placement: snapFrame(settled, g.last, b) })
    snapTimerRef.current = window.setTimeout(() => setLive(null), SNAP_SETTLE_MS)
  }, [measure])

  // 手势进行中窗口失焦、页面转入后台:松手事件可能永远到不了,主动收尾
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') endGesture()
    }
    window.addEventListener('blur', endGesture)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('blur', endGesture)
      document.removeEventListener('visibilitychange', onHidden)
      endGesture()
    }
  }, [endGesture, contentKey])

  useEffect(() => () => window.clearTimeout(snapTimerRef.current), [])

  const begin = useCallback(
    (kind: GestureKind) =>
      (e: React.PointerEvent<HTMLElement>): void => {
        const b = measure()
        const panel = panelRef.current
        if (e.button !== 0 || !b || !panel) return
        // 不让按下变成选字:拖动全程靠指针捕获收事件,正文一个字都不会被选中
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        // 吸回动画还没走完又按下:动画直接收尾(落盘的账早已是终值)
        window.clearTimeout(snapTimerRef.current)
        setLive(null)
        draggedRef.current = false
        const start = clampByForm(capToContent(getOutlinePlacement(), b), b)
        const from = { width: panel.offsetWidth, height: panel.offsetHeight }
        gestureRef.current = {
          kind,
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          start,
          from,
          bounds: b,
          last: start,
          hasMoved: false
        }
      },
    [measure, panelRef, clampByForm]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      const g = gestureRef.current
      if (!g || g.pointerId !== e.pointerId) return
      const dx = e.clientX - g.x
      const dy = e.clientY - g.y
      if (!g.hasMoved && !isDragStarted(dx, dy)) return
      g.hasMoved = true
      g.last =
        g.kind === 'move'
          ? moveByForm(g.start, dx, dy, g.bounds)
          : resizePlacement(g.start, g.from, dx, dy, g.bounds)
      setLive({ phase: 'drag', placement: g.last })
    },
    [moveByForm]
  )

  const finish = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      if (gestureRef.current?.pointerId === e.pointerId) endGesture()
    },
    [endGesture]
  )

  const nudge = useCallback(
    (kind: GestureKind, e: React.KeyboardEvent<HTMLElement>): void => {
      const b = measure()
      const panel = panelRef.current
      const delta = arrowDelta(e, remPx(e.currentTarget) * (e.shiftKey ? NUDGE_BIG_REM : NUDGE_REM))
      if (!b || !panel || !delta) return
      e.preventDefault()
      const start = clampByForm(capToContent(getOutlinePlacement(), b), b)
      const from = { width: panel.offsetWidth, height: panel.offsetHeight }
      setOutlinePlacement(
        kind === 'move'
          ? moveByForm(start, delta[0], delta[1], b)
          : settleResize(resizePlacement(start, from, delta[0], delta[1], b), b)
      )
    },
    [measure, panelRef, clampByForm, moveByForm]
  )

  const consumeDrag = useCallback((): boolean => {
    const dragged = draggedRef.current
    draggedRef.current = false
    return dragged
  }, [])

  const resetSize = useCallback((): void => {
    setOutlinePlacement({ ...getOutlinePlacement(), width: null, height: null })
  }, [])

  const wanted = live ? live.placement : bounds ? capToContent(stored, bounds) : stored
  const shown = bounds ? clampByForm(wanted, bounds) : null
  const sized = isOpen && shown !== null
  const style: React.CSSProperties | undefined = shown
    ? {
        right: shown.right,
        top: shown.top,
        width: sized ? (shown.width ?? undefined) : undefined,
        maxWidth: sized && shown.width !== null ? 'none' : undefined,
        height: sized ? (shown.height ?? undefined) : undefined,
        maxHeight: sized && shown.height !== null ? 'none' : undefined
      }
    : undefined
  const pointer = {
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    // 鼠标按下不抢焦点:否则松手后按钮留着焦点,切走再切回来焦点复原,顶边条就一直亮着
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => e.preventDefault()
  }
  return {
    style,
    isDragging: live?.phase === 'drag',
    isSnapping: live?.phase === 'snap',
    consumeDrag,
    grip: { ...pointer, onPointerDown: begin('move'), onKeyDown: (e) => nudge('move', e) },
    resizer: {
      ...pointer,
      onPointerDown: begin('resize'),
      onDoubleClick: resetSize,
      onKeyDown: (e) => (e.key === 'Enter' ? resetSize() : nudge('resize', e))
    }
  }
}
