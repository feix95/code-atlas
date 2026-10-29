// 关系图谱的滚轮:按 wheelIntent 的判定分发成缩放视口、切换悬停看法或进出层级。
// 新手势开始时记下鼠标下的节点,整个手势都对它生效;鼠标下的节点与悬停记录不一致(缩放后节点移走了)时不算停稳。
import { useEffect, useRef } from 'react'
import type { ForceScene, SimNode } from './useForceLayout'
import type { Transform } from './drawGraph'
import { GRAPH_VIEW } from './graphConfig'
import { hitTest, localPoint } from './graphHit'
import { clampScale } from './fitView'
import { nextGesture, takeSteps, wheelDeltaPx, type WheelGesture } from './wheelIntent'

export interface WheelDeps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  sceneRef: React.RefObject<ForceScene | null>
  requestDraw: () => void
  /** 在节点上停稳后滚轮:往下滚 steps 为正(下一种看法),坐标为画布内像素 */
  onModeWheel: (node: SimNode, steps: number, x: number, y: number) => void
  /** Ctrl+滚轮(含触控板捏合):steps 为 -1 = 往上滚,进入鼠标下的文件夹;1 = 往下滚,返回上一层 */
  onLevelWheel: (node: SimNode | null, steps: number) => void
}

/** 当前悬停的节点与开始悬停的时间(ms,performance.now) */
export type HoverReader = () => { node: SimNode; since: number } | null

function zoomAt(tf: Transform, sx: number, sy: number, deltaPx: number): void {
  const k = clampScale(tf.k * Math.exp(-deltaPx * GRAPH_VIEW.wheelSpeed))
  tf.x = sx - ((sx - tf.x) / tf.k) * k
  tf.y = sy - ((sy - tf.y) / tf.k) * k
  tf.k = k
}

export function useGraphWheel(
  deps: WheelDeps,
  transformRef: React.RefObject<Transform>,
  readHover: HoverReader
): void {
  const depsRef = useRef(deps)
  useEffect(() => {
    depsRef.current = deps
  })
  const { canvasRef } = deps
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let gesture: WheelGesture | null = null
    let target: SimNode | null = null
    const onWheel = (e: WheelEvent): void => {
      // Ctrl+滚轮不归界面缩放(界面缩放走键盘 +/-/0):落在画布上的都由图谱处理
      e.preventDefault()
      const d = depsRef.current
      const now = performance.now()
      const [sx, sy] = localPoint(canvas, e)
      const tf = transformRef.current
      const under = hitTest(d.sceneRef.current, tf, sx, sy)
      const hover = readHover()
      const since = hover && hover.node === under ? hover.since : null
      gesture = nextGesture(gesture, now, e.ctrlKey, since)
      if (gesture.startedAt === now) target = under
      const deltaPx = wheelDeltaPx(e.deltaY, e.deltaMode)
      if (gesture.action === 'zoom') {
        zoomAt(tf, sx, sy, deltaPx)
        d.requestDraw()
        return
      }
      const r = takeSteps(gesture, deltaPx)
      gesture = r.gesture
      if (r.steps === 0) return
      if (gesture.action === 'level') d.onLevelWheel(target, r.steps)
      else if (target) d.onModeWheel(target, r.steps, sx, sy)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [canvasRef, transformRef, readHover])
}
