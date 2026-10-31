// 图谱节点详情浮窗的拖动/拉伸现场:按住标题拖位置,右下角拉手拉尺寸(左上角钉住),方向键微调。
// 手势进行中只改内存 live 账,松手才落盘;上屏前按当前画布大小夹一遍,换层级、缩窗口都不会跑出画布。
// 宽度在本次打开时按首个节点量一次,换节点不再跟着内容改宽,避免悬停切换时面板抽动;高度仍按内容收。
// 拉的途中跟手,松手比内容尺寸还大就平滑吸回;拖到左栏上方松手 = 停靠。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import {
  getGraphPanelPlacement,
  setGraphPanelPlacement,
  subscribeGraphPanelPlacement
} from '../codePrefs'
import {
  capToContent,
  clampPlacement,
  isDragStarted,
  movePlacement,
  resizePlacement,
  sameFloatBounds,
  settleResize,
  snapFrame,
  type FitBounds,
  type FloatPlacement
} from '../floatPlacement'
import { remPx } from '../outlineMeasure'
import type { SidebarDropTarget } from '../sidebarDock'
import {
  measureGraphPanelBounds,
  measureNaturalHeight,
  measureNaturalWidth
} from './graphPanelMeasure'

/** 方向键一步挪多远(rem);按住 Shift 走大步 */
const NUDGE_REM = 1
const NUDGE_BIG_REM = 4
/** 吸回动画留多久再撤掉 live 账;要比 graph-panel.css 里 .is-snapping 的过渡(--dur-2)略长 */
const SNAP_SETTLE_MS = 200

type GestureKind = 'move' | 'resize'

interface Gesture {
  kind: GestureKind
  pointerId: number
  x: number
  y: number
  start: FloatPlacement & { right: number; top: number }
  from: { width: number; height: number }
  bounds: FitBounds
  last: FloatPlacement
  /** 挪够 DRAG_START_PX 才为 true;没挪够的松手什么都不改 */
  hasMoved: boolean
}

/** 本地 live 账(只在内存,从不落盘):drag = 手势进行中,snap = 松手后正在吸回内容尺寸 */
type LivePlacement = { phase: 'drag' | 'snap'; placement: FloatPlacement }

function arrowDelta(e: React.KeyboardEvent<HTMLElement>, step: number): [number, number] | null {
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step]
  }
  return moves[e.key] ?? null
}

export function useGraphPanelPlacement(
  viewRef: React.RefObject<HTMLDivElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  /** 拖动落点(左栏能收留时才给):命中就在松手时改成停靠,不再存位置账 */
  dropTarget?: SidebarDropTarget
): {
  style: React.CSSProperties | undefined
  isDragging: boolean
  isSnapping: boolean
  /** 浮窗此刻拖在落点上(左栏已亮起落位框) */
  isOverDock: boolean
  grip: React.HTMLAttributes<HTMLElement>
  resizer: React.HTMLAttributes<HTMLElement>
} {
  const stored = useSyncExternalStore(subscribeGraphPanelPlacement, getGraphPanelPlacement)
  const [live, setLive] = useState<LivePlacement | null>(null)
  const [bounds, setBounds] = useState<FitBounds | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const snapTimerRef = useRef(0)
  // 自适应宽:本次打开量一次就锁住;内容高随内容与宽度变(换行),每次都要重量
  const autoWidthRef = useRef<number | null>(null)
  const naturalHeightRef = useRef<{ height: number; atWidth: number } | null>(null)
  const dropRef = useRef(dropTarget)
  const [overDock, setOverDock] = useState(false)
  const overDockRef = useRef(false)

  useLayoutEffect(() => {
    dropRef.current = dropTarget
  }, [dropTarget])

  // 落点开合的每一跳都通知外面:左栏据此亮/灭落位框
  const setOver = useCallback((next: boolean): void => {
    if (overDockRef.current === next) return
    overDockRef.current = next
    setOverDock(next)
    dropRef.current?.onHot?.(next)
  }, [])

  const measure = useCallback((): FitBounds | null => {
    const view = viewRef.current
    const panel = panelRef.current
    if (!view || !panel || view.clientWidth === 0 || view.clientHeight === 0) return null
    if (autoWidthRef.current === null) autoWidthRef.current = measureNaturalWidth(panel)
    const panelWidth = panel.offsetWidth
    let naturalHeight = naturalHeightRef.current
    if (!naturalHeight || naturalHeight.atWidth !== panelWidth) {
      naturalHeight = { height: measureNaturalHeight(panel), atWidth: panelWidth }
      naturalHeightRef.current = naturalHeight
    }
    return measureGraphPanelBounds(view, panel, {
      width: autoWidthRef.current,
      height: naturalHeight.height
    })
  }, [viewRef, panelRef])

  useLayoutEffect(() => {
    const view = viewRef.current
    const panel = panelRef.current
    if (!view || !panel) return
    autoWidthRef.current = null
    naturalHeightRef.current = null
    const update = (): void => {
      const next = measure()
      setBounds((prev) => (sameFloatBounds(prev, next) ? prev : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(view)
    observer.observe(panel)
    // 换节点、模块数据到货都会换掉面板里的内容:高度重量,宽度沿用本次打开时的值
    const mutations = new MutationObserver(() => {
      naturalHeightRef.current = null
      update()
    })
    mutations.observe(panel, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [viewRef, panelRef, measure])

  /**
   * 收尾一次手势:挪过才落盘(拉伸要吸回内容尺寸),只是按了一下就当没发生。
   * 松手、指针取消、丢了指针捕获、窗口失焦、页面转入后台、卸载都走这里;
   * 拖在左栏上方松手时改成停靠,位置账原样留着,失焦/卸载这类半路收尾不算停靠。
   */
  const endGesture = useCallback(
    (commit: boolean): void => {
      const g = gestureRef.current
      if (!g) return
      gestureRef.current = null
      const dropped = commit && g.kind === 'move' && overDockRef.current
      setOver(false)
      if (!g.hasMoved) return
      if (dropped) {
        dropRef.current?.onDrop()
        return
      }
      window.clearTimeout(snapTimerRef.current)
      const b = measure() ?? g.bounds
      const settled = g.kind === 'resize' ? settleResize(g.last, b) : g.last
      setGraphPanelPlacement(settled)
      if (settled.width === g.last.width && settled.height === g.last.height) {
        setLive(null)
        return
      }
      // 先以显式像素尺寸过渡到内容尺寸,过渡完再交给自适应档
      setLive({ phase: 'snap', placement: snapFrame(settled, g.last, b) })
      snapTimerRef.current = window.setTimeout(() => setLive(null), SNAP_SETTLE_MS)
    },
    [measure, setOver]
  )

  // 手势进行中窗口失焦、页面转入后台:松手事件可能永远到不了,主动收尾(不算停靠)
  useEffect(() => {
    const abort = (): void => endGesture(false)
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') abort()
    }
    window.addEventListener('blur', abort)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('blur', abort)
      document.removeEventListener('visibilitychange', onHidden)
      abort()
    }
  }, [endGesture])

  useEffect(() => () => window.clearTimeout(snapTimerRef.current), [])
  // 拖到一半浮窗被藏起来(停靠落定、换签):左栏的落位框也得跟着灭
  useEffect(() => () => dropRef.current?.onHot?.(false), [dropTarget])

  const begin = useCallback(
    (kind: GestureKind) =>
      (e: React.PointerEvent<HTMLElement>): void => {
        const b = measure()
        const panel = panelRef.current
        if (e.button !== 0 || !b || !panel) return
        // 不让按下变成选字:拖动全程靠指针捕获收事件
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        // 吸回动画还没走完又按下:动画直接收尾(落盘的账早已是终值)
        window.clearTimeout(snapTimerRef.current)
        setLive(null)
        setOver(false)
        const start = clampPlacement(capToContent(getGraphPanelPlacement(), b), b)
        gestureRef.current = {
          kind,
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          start,
          from: { width: panel.offsetWidth, height: panel.offsetHeight },
          bounds: b,
          last: start,
          hasMoved: false
        }
      },
    [measure, panelRef, setOver]
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
          ? movePlacement(g.start, dx, dy, g.bounds)
          : resizePlacement(g.start, g.from, dx, dy, g.bounds)
      setLive({ phase: 'drag', placement: g.last })
      // 只有挪位置才认落点;拉尺寸怎么拉都不该把面板送走
      setOver(g.kind === 'move' && (dropRef.current?.hit(e.clientX, e.clientY) ?? false))
    },
    [setOver]
  )

  const finishOk = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      if (gestureRef.current?.pointerId === e.pointerId) endGesture(true)
    },
    [endGesture]
  )

  const finishAbort = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      if (gestureRef.current?.pointerId === e.pointerId) endGesture(false)
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
      const start = clampPlacement(capToContent(getGraphPanelPlacement(), b), b)
      const from = { width: panel.offsetWidth, height: panel.offsetHeight }
      setGraphPanelPlacement(
        kind === 'move'
          ? movePlacement(start, delta[0], delta[1], b)
          : settleResize(resizePlacement(start, from, delta[0], delta[1], b), b)
      )
    },
    [measure, panelRef]
  )

  const resetSize = useCallback((): void => {
    setGraphPanelPlacement({ ...getGraphPanelPlacement(), width: null, height: null })
  }, [])

  const wanted = live ? live.placement : bounds ? capToContent(stored, bounds) : stored
  const shown = bounds ? clampPlacement(wanted, bounds) : null
  // 自适应宽显式落到内容宽(不超过自适应上限),不再靠 CSS max-content:
  // 吸回内容尺寸时右缘按 fitWidth 补偿,不取整的话实宽比它小零点几像素,浮窗会一次次往右挪
  const autoWidth = bounds ? Math.min(bounds.fitWidth, bounds.autoMaxWidth) : undefined
  const style: React.CSSProperties | undefined = shown
    ? {
        right: shown.right,
        top: shown.top,
        width: shown.width ?? autoWidth,
        maxWidth: shown.width !== null ? 'none' : undefined,
        height: shown.height ?? undefined,
        maxHeight: shown.height !== null ? 'none' : undefined
      }
    : undefined
  const pointer = {
    onPointerMove,
    onPointerUp: finishOk,
    onPointerCancel: finishAbort,
    onLostPointerCapture: finishAbort,
    // 鼠标按下不抢焦点:否则松手后按钮留着焦点,切走再切回来焦点复原
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => e.preventDefault()
  }
  return {
    style,
    isDragging: live?.phase === 'drag',
    isSnapping: live?.phase === 'snap',
    isOverDock: overDock,
    grip: { ...pointer, onPointerDown: begin('move'), onKeyDown: (e) => nudge('move', e) },
    resizer: {
      ...pointer,
      onPointerDown: begin('resize'),
      onDoubleClick: resetSize,
      onKeyDown: (e) => (e.key === 'Enter' ? resetSize() : nudge('resize', e))
    }
  }
}
