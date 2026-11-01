// 关系图谱的视口:缩放 / 平移变换、指针命中检测、悬停与拖拽;画布尺寸见 useGraphCanvasSize,滚轮见 useGraphWheel。
// 交互状态收敛为单一变量 Interaction;变换与状态都放 ref,指针事件不触发 React 重渲染。
import { useCallback, useEffect, useRef } from 'react'
import type { SimNode } from './useForceLayout'
import type { Transform } from './drawGraph'
import { GRAPH_VIEW } from './graphConfig'
import { useGraphWheel, type HoverReader, type WheelDeps } from './useGraphWheel'
import { useGraphClicks } from './useGraphClicks'
import {
  dragCenterAt,
  grabOffsetAt,
  hitTest,
  hoverNodeOf,
  localPoint,
  panGestureAt,
  type GrabOffset,
  type PanGesture
} from './graphHit'
import { useGraphSpacePan } from './useGraphSpacePan'
import { useGraphCanvasSize, type ViewportSize } from './useGraphCanvasSize'
import { fitTransform } from './fitView'

interface CarryItem {
  node: SimNode
  x: number
  y: number
}

type Interaction =
  | { mode: 'idle' }
  | { mode: 'hovering'; node: SimNode; since: number }
  | {
      mode: 'dragging-node'
      node: SimNode
      sx: number
      sy: number
      /** 按下点相对圆心的偏移:拖动时保持它,点哪拖哪 */
      grab: GrabOffset
      moved: boolean
      /** 跟着一起搬的容器内子项,按按下时的位置记锚点 */
      carry: readonly CarryItem[]
    }
  | { mode: 'panning'; sx: number; sy: number; ox: number; oy: number; by: PanGesture }

/** 拖容器时连同里面的子项一起搬:收集全部后代 */
function collectDescendants(scene: { nodes: readonly SimNode[] } | null, node: SimNode): SimNode[] {
  if (!scene) return []
  return scene.nodes.filter((other) => {
    for (let current = other.parent; current; current = current.parent) {
      if (current === node) return true
    }
    return false
  })
}

/** 悬停(或拖拽中)的节点及其屏幕落位:提示框贴在它上方 */
export interface HoverTarget {
  node: SimNode
  /** 节点圆心的画布内像素坐标与缩放后的半径 */
  x: number
  y: number
  r: number
  /** 拖拽中:高亮照旧,但提示框先收起,松手后再亮 */
  dragging: boolean
}

export interface ViewportDeps extends WheelDeps {
  setDragging: (dragging: boolean) => void
  /** 单击空白处(按下后没平移):取消选中 */
  onBlankClick: () => void
  onNodeDoubleClick: (node: SimNode) => void
  onNodeContextMenu: (node: SimNode, clientX: number, clientY: number) => void
  onHoverChange: (hover: HoverTarget | null) => void
}

export interface GraphViewport {
  transformRef: React.RefObject<Transform>
  sizeRef: React.RefObject<ViewportSize>
  /** 缩放平移至全部节点可见 */
  fit: () => void
  /** 取消悬停(Esc) */
  clearHover: () => void
}

function usePointer(
  deps: ViewportDeps,
  transformRef: React.RefObject<Transform>,
  /** 右键拖动超过阈值后置位,contextmenu 看到它就只关掉浏览器菜单,不再弹节点菜单 */
  rightPanMovedRef: React.RefObject<boolean>
): { clearHover: () => void; readHover: HoverReader } {
  const stateRef = useRef<Interaction>({ mode: 'idle' })
  const depsRef = useRef(deps)
  useEffect(() => {
    depsRef.current = deps
  })

  const screenOf = useCallback(
    (node: SimNode, dragging: boolean): HoverTarget => {
      const tf = transformRef.current
      return {
        node,
        x: tf.x + node.x * tf.k,
        y: tf.y + node.y * tf.k,
        r: node.r * tf.k,
        dragging
      }
    },
    [transformRef]
  )

  const spaceHeldRef = useRef(false)

  const applyCursor = useCallback((): void => {
    const canvas = depsRef.current.canvasRef.current
    if (!canvas) return
    const mode = stateRef.current.mode
    canvas.style.cursor =
      mode === 'panning' || mode === 'dragging-node'
        ? 'grabbing'
        : spaceHeldRef.current
          ? 'grab'
          : mode === 'hovering'
            ? 'pointer'
            : 'default'
  }, [])

  useGraphSpacePan(deps.canvasRef, spaceHeldRef, applyCursor)

  const setState = useCallback(
    (next: Interaction): void => {
      const prev = stateRef.current
      stateRef.current = next
      applyCursor()
      const d = depsRef.current
      // 容器圆圈只作背景:悬停在圈内空白处不高亮、不出详情,拖它时也不点亮
      const prevId =
        prev.mode === 'hovering' || prev.mode === 'dragging-node'
          ? (hoverNodeOf(prev.node)?.id ?? null)
          : null
      const nextId =
        next.mode === 'hovering' || next.mode === 'dragging-node'
          ? (hoverNodeOf(next.node)?.id ?? null)
          : null
      if (prevId === nextId && prev.mode === next.mode) return
      const lit =
        next.mode === 'hovering' || next.mode === 'dragging-node' ? hoverNodeOf(next.node) : null
      // 拖拽中照旧点亮邻居,只是提示框先收起(dragging)
      if (lit) d.onHoverChange(screenOf(lit, next.mode === 'dragging-node'))
      else d.onHoverChange(null)
    },
    [applyCursor, screenOf]
  )

  useEffect(() => {
    const canvas = deps.canvasRef.current
    if (!canvas) return
    const toWorld = (sx: number, sy: number): [number, number] => {
      const tf = transformRef.current
      return [(sx - tf.x) / tf.k, (sy - tf.y) / tf.k]
    }
    const onDown = (e: PointerEvent): void => {
      const pan = panGestureAt(e.button, spaceHeldRef.current)
      if (!pan && e.button !== 0) return
      const [sx, sy] = localPoint(canvas, e)
      canvas.setPointerCapture(e.pointerId)
      if (pan) {
        // 右键是否已拖成平移,决定松手时弹不弹节点菜单
        if (pan === 'right') rightPanMovedRef.current = false
        const tf = transformRef.current
        setState({ mode: 'panning', sx, sy, ox: tf.x, oy: tf.y, by: pan })
        return
      }
      const node = hitTest(depsRef.current.sceneRef.current, transformRef.current, sx, sy)
      if (node) {
        node.fx = node.x
        node.fy = node.y
        const [wx, wy] = toWorld(sx, sy)
        const carry = collectDescendants(depsRef.current.sceneRef.current, node).map((child) => ({
          node: child,
          x: child.x,
          y: child.y
        }))
        setState({
          mode: 'dragging-node',
          node,
          sx,
          sy,
          grab: grabOffsetAt(node, wx, wy),
          moved: false,
          carry
        })
      } else {
        const tf = transformRef.current
        setState({ mode: 'panning', sx, sy, ox: tf.x, oy: tf.y, by: 'blank' })
      }
    }
    const onMove = (e: PointerEvent): void => {
      const [sx, sy] = localPoint(canvas, e)
      const s = stateRef.current
      const d = depsRef.current
      if (s.mode === 'dragging-node') {
        if (!s.moved && Math.hypot(sx - s.sx, sy - s.sy) > GRAPH_VIEW.clickSlopPx) {
          s.moved = true
          d.setDragging(true)
          // 子项从这一刻起固定,整体跟着容器平移,松手后再交回力
          for (const item of s.carry) {
            item.node.fx = item.x
            item.node.fy = item.y
          }
        }
        if (s.moved) {
          const [wx, wy] = toWorld(sx, sy)
          const [ox, oy] = toWorld(s.sx, s.sy)
          const center = dragCenterAt(s.grab, wx, wy)
          s.node.fx = center.x
          s.node.fy = center.y
          for (const item of s.carry) {
            item.node.fx = item.x + wx - ox
            item.node.fy = item.y + wy - oy
          }
        }
        return
      }
      if (s.mode === 'panning') {
        if (s.by === 'right' && Math.hypot(sx - s.sx, sy - s.sy) > GRAPH_VIEW.clickSlopPx)
          rightPanMovedRef.current = true
        const tf = transformRef.current
        tf.x = s.ox + sx - s.sx
        tf.y = s.oy + sy - s.sy
        d.requestDraw()
        return
      }
      const node = hoverNodeOf(hitTest(d.sceneRef.current, transformRef.current, sx, sy))
      if (node) {
        if (s.mode !== 'hovering' || s.node !== node)
          setState({ mode: 'hovering', node, since: performance.now() })
      } else if (s.mode !== 'idle') setState({ mode: 'idle' })
    }
    const onUp = (e: PointerEvent): void => {
      const s = stateRef.current
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      if (s.mode === 'dragging-node') {
        for (const item of s.carry) {
          item.node.fx = null
          item.node.fy = null
        }
        s.node.fx = null
        s.node.fy = null
        if (s.moved) depsRef.current.setDragging(false)
        const hovered = hoverNodeOf(s.node)
        setState(
          hovered ? { mode: 'hovering', node: hovered, since: performance.now() } : { mode: 'idle' }
        )
        return
      }
      if (s.mode !== 'panning') return
      const [sx, sy] = localPoint(canvas, e)
      setState({ mode: 'idle' })
      if (s.by === 'blank' && Math.hypot(sx - s.sx, sy - s.sy) <= GRAPH_VIEW.clickSlopPx)
        depsRef.current.onBlankClick()
    }
    const onLeave = (): void => {
      if (stateRef.current.mode === 'hovering') setState({ mode: 'idle' })
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [deps.canvasRef, rightPanMovedRef, setState, transformRef])

  const clearHover = useCallback(() => {
    if (stateRef.current.mode === 'hovering') setState({ mode: 'idle' })
  }, [setState])
  const readHover = useCallback<HoverReader>(() => {
    const s = stateRef.current
    return s.mode === 'hovering' ? { node: s.node, since: s.since } : null
  }, [])
  return { clearHover, readHover }
}

export function useGraphViewport(deps: ViewportDeps): GraphViewport {
  const transformRef = useRef<Transform>({ k: 1, x: 0, y: 0 })
  const rightPanMovedRef = useRef(false)
  const sizeRef = useGraphCanvasSize(deps.canvasRef, transformRef, deps.requestDraw)
  const { clearHover, readHover } = usePointer(deps, transformRef, rightPanMovedRef)
  useGraphWheel(deps, transformRef, readHover)
  useGraphClicks(deps, transformRef, rightPanMovedRef)
  const { sceneRef, requestDraw } = deps

  const fit = useCallback(() => {
    const next = fitTransform(sceneRef.current, sizeRef.current)
    if (!next) return
    Object.assign(transformRef.current, next)
    requestDraw()
  }, [sceneRef, sizeRef, requestDraw])

  return { transformRef, sizeRef, fit, clearHover }
}
