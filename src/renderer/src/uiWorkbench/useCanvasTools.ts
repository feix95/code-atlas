// 画布工具与节点手势:V 选择/移动、R 拖出矩形(Shift 正方形、Alt 从中心、单击得默认尺寸);
// 矩形工具常驻(PS 式),但调整手势(角点缩放/圆角点/旋转旋钮)松手后自动回落到移动工具——
// 「画」归画,「调」归调,开始调即视为画图阶段结束。属性面板改数值不触发回落。
// 选中后:节点上拖动 = 移动;四角小圆点 = 圆角(默认四角同调,按住 Ctrl 只调该角);
// 顶边外侧的点状旋钮 = 绕中心旋转(Shift 吸附 15°)。拖出的坐标取整吸附。
// 全部修改经 docActions.dispatch 走 NodeAction,与撤销 / AI 日后共用同一条命令通路。
import { useEffect, useRef, useState } from 'react'
import {
  angleDeg,
  hitTopmost,
  radiusFromLocal,
  rectCenter,
  rectFromDrag,
  resizeRect,
  snapAngle,
  snapValue,
  toLocal,
  type Point
} from '@shared/uiWorkbench/geometry'
import {
  createRect,
  maxCornerRadius,
  normalizeRotation,
  RECT_CLICK_SIZE,
  withCornerRadius,
  type CornerIndex
} from '@shared/uiWorkbench/node'
import { docActions, getDocState, selectedNode } from './documentStore'
import { cornerResizeCursor } from './cursors'
import { isEditableTarget } from './isEditableTarget'
import type { CanvasViewportApi } from './useCanvasViewport'

export type CanvasTool = 'select' | 'rect'
/** 正在进行的选中手势(覆盖层用来保持旋钮可见) */
export type GestureKind = 'radius' | 'rotate' | null

/** Shift 拖圆角柄的吸附步长:4pt 网格约定 */
const RADIUS_SNAP_STEP = 4

export interface CanvasToolsApi {
  tool: CanvasTool
  setTool: (tool: CanvasTool) => void
  activeGesture: GestureKind
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  startResizeDrag: (e: React.PointerEvent, corner: CornerIndex) => void
  startRadiusDrag: (e: React.PointerEvent, corner: CornerIndex) => void
  startRotateDrag: (e: React.PointerEvent) => void
}

/** 手势换算只依赖这几样:指针位置 + 修饰键状态(PointerEvent 与合成重放共用) */
type DragEventLike = Pick<
  PointerEvent,
  'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'
>

/** 拖动期间挂 window 级监听:指针飞出元素手势也不断;结束时收掉。
 *  修饰键按下/松开会在最后一次指针位置原地重算——按 Shift 立即吸附、松开落回原值(PS 式);
 *  dragCursor 把手势光标钉在文档根上,指针悬到别处也不跳回默认;
 *  setPointerCapture + blur 兜底:窗口外松手/失焦也能收尾,光标不会被钉死 */
function trackPointer(
  down: React.PointerEvent,
  onMove: (e: DragEventLike) => void,
  onEnd: () => void,
  dragCursor?: string
): void {
  const target = down.currentTarget
  const win = target.ownerDocument.defaultView
  if (!win) return
  const root = win.document.documentElement
  const prevCursor = root.style.cursor
  if (dragCursor) root.style.cursor = dragCursor
  let last: DragEventLike | null = null
  const move = (e: PointerEvent): void => {
    last = e
    onMove(e)
  }
  const modifier = (e: KeyboardEvent): void => {
    if (!last || (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta'))
      return
    onMove({
      clientX: last.clientX,
      clientY: last.clientY,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey
    })
  }
  const end = (): void => {
    win.removeEventListener('pointermove', move)
    win.removeEventListener('keydown', modifier, true)
    win.removeEventListener('keyup', modifier, true)
    win.removeEventListener('pointerup', end)
    win.removeEventListener('pointercancel', end)
    win.removeEventListener('blur', end)
    if (dragCursor) root.style.cursor = prevCursor
    onEnd()
  }
  target.setPointerCapture(down.pointerId)
  win.addEventListener('pointermove', move)
  win.addEventListener('keydown', modifier, true)
  win.addEventListener('keyup', modifier, true)
  win.addEventListener('pointerup', end)
  win.addEventListener('pointercancel', end)
  win.addEventListener('blur', end)
}

export function useCanvasTools(viewport: CanvasViewportApi): CanvasToolsApi {
  const [tool, setTool] = useState<CanvasTool>('select')
  const [activeGesture, setActiveGesture] = useState<GestureKind>(null)
  const viewRef = useRef(viewport.view)
  const toolRef = useRef(tool)
  useEffect(() => {
    viewRef.current = viewport.view
    toolRef.current = tool
  })
  const toDesign = (e: { clientX: number; clientY: number }): Point => {
    const el = viewport.viewportRef.current
    const v = viewRef.current
    const rect = el?.getBoundingClientRect()
    return {
      x: (e.clientX - (rect?.left ?? 0) - v.panX) / v.zoom,
      y: (e.clientY - (rect?.top ?? 0) - v.panY) / v.zoom
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    const start = toDesign(e)
    if (toolRef.current === 'rect') {
      const node = createRect(getDocState().nodes, { ...start, width: 1, height: 1 })
      docActions.dispatch({ type: 'add', node })
      docActions.select(node.id)
      trackPointer(
        e,
        (ev) =>
          docActions.dispatch({
            type: 'update',
            id: node.id,
            patch: rectFromDrag(start, toDesign(ev), {
              isSquare: ev.shiftKey,
              isFromCenter: ev.altKey
            })
          }),
        () => {
          const fresh = getDocState().nodes.find((n) => n.id === node.id)
          if (fresh && fresh.width === 1 && fresh.height === 1) {
            docActions.dispatch({
              type: 'update',
              id: node.id,
              patch: { width: RECT_CLICK_SIZE, height: RECT_CLICK_SIZE }
            })
          }
          // 工具常驻(PS 式):画完不弹回移动,连画不用反复选;退出靠 V / Esc / 工具钮
        },
        'crosshair'
      )
      return
    }
    const hit = hitTopmost(getDocState().nodes, start)
    if (!hit) {
      docActions.select(null)
      return
    }
    docActions.select(hit.id)
    const origin = { x: hit.x, y: hit.y }
    trackPointer(
      e,
      (ev) => {
        const cur = toDesign(ev)
        docActions.dispatch({
          type: 'update',
          id: hit.id,
          patch: {
            x: Math.round(origin.x + cur.x - start.x),
            y: Math.round(origin.y + cur.y - start.y)
          }
        })
      },
      () => {},
      'move'
    )
  }

  function startResizeDrag(e: React.PointerEvent, corner: CornerIndex): void {
    const node = selectedNode(getDocState())
    if (!node || e.button !== 0) return
    trackPointer(
      e,
      (ev) =>
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: resizeRect(node, corner, toLocal(node, toDesign(ev)), ev.shiftKey)
        }),
      fallbackToSelect,
      cornerResizeCursor(node.rotation, corner)
    )
  }

  function startRadiusDrag(e: React.PointerEvent, corner: CornerIndex): void {
    const node = selectedNode(getDocState())
    if (!node || e.button !== 0) return
    setActiveGesture('radius')
    const cap = maxCornerRadius(node.width, node.height)
    trackPointer(
      e,
      (ev) => {
        let radius = radiusFromLocal(node, corner, toLocal(node, toDesign(ev)))
        if (ev.shiftKey) radius = Math.min(cap, snapValue(radius, RADIUS_SNAP_STEP))
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: {
            radii: withCornerRadius(node.radii, ev.ctrlKey || ev.metaKey ? corner : 'all', radius)
          }
        })
      },
      () => {
        setActiveGesture(null)
        fallbackToSelect()
      },
      cornerResizeCursor(node.rotation, corner)
    )
  }

  function startRotateDrag(e: React.PointerEvent): void {
    const node = selectedNode(getDocState())
    if (!node || e.button !== 0) return
    const center = rectCenter(node)
    const base = angleDeg(center, toDesign(e))
    setActiveGesture('rotate')
    trackPointer(
      e,
      (ev) => {
        const raw = node.rotation + angleDeg(center, toDesign(ev)) - base
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: { rotation: normalizeRotation(ev.shiftKey ? snapAngle(raw, 15) : raw) }
        })
      },
      () => {
        setActiveGesture(null)
        fallbackToSelect()
      },
      'grabbing'
    )
  }

  /** 调整手势松手后:矩形工具自动回落到移动工具(已是移动时幂等) */
  function fallbackToSelect(): void {
    if (toolRef.current === 'rect') setTool('select')
  }

  useToolKeys(viewport, setTool)

  return {
    tool,
    setTool,
    activeGesture,
    onPointerDown,
    startResizeDrag,
    startRadiusDrag,
    startRotateDrag
  }
}

/** 单键快捷键:鼠标在画布上且焦点不在输入框时生效——Esc 取消选中,V 移动,R 矩形,Delete 删选中 */
function useToolKeys(viewport: CanvasViewportApi, setTool: (tool: CanvasTool) => void): void {
  const { viewportRef, isHoveredRef } = viewport
  useEffect(() => {
    const win = viewportRef.current?.ownerDocument.defaultView
    if (!win) return
    const onKey = (e: KeyboardEvent): void => {
      if (!isHoveredRef.current || isEditableTarget(e.target)) return
      if (e.key === 'Escape') {
        docActions.select(null)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const { selectedId } = getDocState()
      if (e.code === 'KeyV') setTool('select')
      else if (e.code === 'KeyR') setTool('rect')
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        docActions.dispatch({ type: 'remove', id: selectedId })
      } else return
      e.preventDefault()
    }
    win.addEventListener('keydown', onKey, true)
    return () => win.removeEventListener('keydown', onKey, true)
  }, [viewportRef, isHoveredRef, setTool])
}
