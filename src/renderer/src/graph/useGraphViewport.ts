// 关系图谱的视口:缩放 / 平移变换、指针命中检测、悬停与拖拽,以及画布尺寸与设备像素比适配。
// 交互状态收敛为单一变量 Interaction;变换与状态都放 ref,指针事件不触发 React 重渲染。
import { useCallback, useEffect, useRef } from 'react'
import type { ForceScene, SimNode } from './useForceLayout'
import type { Transform } from './drawGraph'
import { GRAPH_NODE, GRAPH_VIEW } from './graphConfig'

type Interaction =
  | { mode: 'idle' }
  | { mode: 'hovering'; node: SimNode }
  | { mode: 'dragging-node'; node: SimNode; sx: number; sy: number; moved: boolean }
  | { mode: 'panning'; sx: number; sy: number; ox: number; oy: number }

export interface ViewportSize {
  w: number
  h: number
  dpr: number
}

interface ViewportDeps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  sceneRef: React.RefObject<ForceScene | null>
  requestDraw: () => void
  setDragging: (dragging: boolean) => void
  onNodeClick: (node: SimNode) => void
  onHoverChange: (id: string | null) => void
}

export interface GraphViewport {
  transformRef: React.RefObject<Transform>
  sizeRef: React.RefObject<ViewportSize>
  /** 缩放平移至全部节点可见 */
  fit: () => void
  /** 取消悬停(Esc) */
  clearHover: () => void
}

function clampScale(k: number): number {
  return Math.max(GRAPH_VIEW.minScale, Math.min(GRAPH_VIEW.maxScale, k))
}

function localPoint(
  canvas: HTMLCanvasElement,
  e: { clientX: number; clientY: number }
): [number, number] {
  const rect = canvas.getBoundingClientRect()
  return [e.clientX - rect.left, e.clientY - rect.top]
}

function hitTest(scene: ForceScene | null, tf: Transform, sx: number, sy: number): SimNode | null {
  if (!scene) return null
  const wx = (sx - tf.x) / tf.k
  const wy = (sy - tf.y) / tf.k
  const slop = GRAPH_NODE.hitSlopPx / tf.k
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const n = scene.nodes[i]
    if (Math.hypot(n.x - wx, n.y - wy) <= n.r + slop) return n
  }
  return null
}

export function fitTransform(scene: ForceScene | null, size: ViewportSize): Transform | null {
  if (!scene || scene.nodes.length === 0 || size.w === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const n of scene.nodes) {
    x0 = Math.min(x0, n.x - n.r)
    y0 = Math.min(y0, n.y - n.r)
    x1 = Math.max(x1, n.x + n.r)
    y1 = Math.max(y1, n.y + n.r)
  }
  const pad = GRAPH_VIEW.fitPaddingPx
  const k = clampScale(
    Math.min((size.w - pad * 2) / (x1 - x0 || 1), (size.h - pad * 2) / (y1 - y0 || 1), 1.5)
  )
  return { k, x: size.w / 2 - ((x0 + x1) / 2) * k, y: size.h / 2 - ((y0 + y1) / 2) * k }
}

function useCanvasSize(
  deps: ViewportDeps,
  transformRef: React.RefObject<Transform>
): React.RefObject<ViewportSize> {
  const sizeRef = useRef<ViewportSize>({ w: 0, h: 0, dpr: 1 })
  const { canvasRef, requestDraw } = deps
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const apply = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const prev = sizeRef.current
      const tf = transformRef.current
      // 首次:原点放画布中央;之后尺寸变化保持中心不动
      if (prev.w === 0) Object.assign(tf, { x: rect.width / 2, y: rect.height / 2 })
      else
        Object.assign(tf, {
          x: tf.x + (rect.width - prev.w) / 2,
          y: tf.y + (rect.height - prev.h) / 2
        })
      sizeRef.current = { w: rect.width, h: rect.height, dpr }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      requestDraw()
    }
    const ro = new ResizeObserver(apply)
    ro.observe(canvas)
    apply()
    return () => ro.disconnect()
  }, [canvasRef, requestDraw, transformRef])
  return sizeRef
}

function useWheel(deps: ViewportDeps, transformRef: React.RefObject<Transform>): void {
  const { canvasRef, requestDraw } = deps
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) return // Ctrl+滚轮归界面缩放(useWheelZoom)
      e.preventDefault()
      const [sx, sy] = localPoint(canvas, e)
      const tf = transformRef.current
      const k = clampScale(tf.k * Math.exp(-e.deltaY * GRAPH_VIEW.wheelSpeed))
      tf.x = sx - ((sx - tf.x) / tf.k) * k
      tf.y = sy - ((sy - tf.y) / tf.k) * k
      tf.k = k
      requestDraw()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [canvasRef, requestDraw, transformRef])
}

function usePointer(deps: ViewportDeps, transformRef: React.RefObject<Transform>): () => void {
  const stateRef = useRef<Interaction>({ mode: 'idle' })
  const depsRef = useRef(deps)
  useEffect(() => {
    depsRef.current = deps
  })

  const setState = useCallback((next: Interaction): void => {
    const prev = stateRef.current
    stateRef.current = next
    const d = depsRef.current
    const canvas = d.canvasRef.current
    if (canvas) {
      canvas.style.cursor =
        next.mode === 'panning' ? 'grabbing' : next.mode === 'idle' ? 'default' : 'pointer'
    }
    const prevId = prev.mode === 'hovering' || prev.mode === 'dragging-node' ? prev.node.id : null
    const nextId = next.mode === 'hovering' || next.mode === 'dragging-node' ? next.node.id : null
    if (prevId !== nextId) d.onHoverChange(nextId)
  }, [])

  useEffect(() => {
    const canvas = deps.canvasRef.current
    if (!canvas) return
    const toWorld = (sx: number, sy: number): [number, number] => {
      const tf = transformRef.current
      return [(sx - tf.x) / tf.k, (sy - tf.y) / tf.k]
    }
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const [sx, sy] = localPoint(canvas, e)
      canvas.setPointerCapture(e.pointerId)
      const node = hitTest(depsRef.current.sceneRef.current, transformRef.current, sx, sy)
      if (node) {
        node.fx = node.x
        node.fy = node.y
        setState({ mode: 'dragging-node', node, sx, sy, moved: false })
      } else {
        const tf = transformRef.current
        setState({ mode: 'panning', sx, sy, ox: tf.x, oy: tf.y })
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
        }
        if (s.moved) [s.node.fx, s.node.fy] = toWorld(sx, sy)
        return
      }
      if (s.mode === 'panning') {
        const tf = transformRef.current
        tf.x = s.ox + sx - s.sx
        tf.y = s.oy + sy - s.sy
        d.requestDraw()
        return
      }
      const node = hitTest(d.sceneRef.current, transformRef.current, sx, sy)
      if (node) {
        if (s.mode !== 'hovering' || s.node !== node) setState({ mode: 'hovering', node })
      } else if (s.mode !== 'idle') setState({ mode: 'idle' })
    }
    const onUp = (e: PointerEvent): void => {
      const s = stateRef.current
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      if (s.mode === 'dragging-node') {
        s.node.fx = null
        s.node.fy = null
        if (s.moved) depsRef.current.setDragging(false)
        else depsRef.current.onNodeClick(s.node)
        setState({ mode: 'hovering', node: s.node })
        return
      }
      if (s.mode === 'panning') setState({ mode: 'idle' })
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
  }, [deps.canvasRef, setState, transformRef])

  return useCallback(() => {
    if (stateRef.current.mode === 'hovering') setState({ mode: 'idle' })
  }, [setState])
}

export function useGraphViewport(deps: ViewportDeps): GraphViewport {
  const transformRef = useRef<Transform>({ k: 1, x: 0, y: 0 })
  const sizeRef = useCanvasSize(deps, transformRef)
  useWheel(deps, transformRef)
  const clearHover = usePointer(deps, transformRef)
  const { sceneRef, requestDraw } = deps

  const fit = useCallback(() => {
    const next = fitTransform(sceneRef.current, sizeRef.current)
    if (!next) return
    Object.assign(transformRef.current, next)
    requestDraw()
  }, [sceneRef, sizeRef, requestDraw])

  return { transformRef, sizeRef, fit, clearHover }
}
