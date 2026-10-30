// 关系图谱的渲染循环:按需 requestAnimationFrame(模拟 tick / 交互 / 过渡动画时才画),
// 负责悬停过渡、切换层级的淡出淡入、主题变化时重读颜色、新层级首帧绘制前落一次视口。
import { useCallback, useEffect, useRef } from 'react'
import {
  drawGraph,
  readGraphColors,
  type GraphColors,
  type HoverState,
  type Transform
} from './drawGraph'
import type { ForceScene } from './useForceLayout'
import type { ModuleDrawState } from './drawModules'
import type { HoverMode } from './hoverModes'
import type { ViewportSize } from './useGraphViewport'
import { GRAPH_MOTION } from './graphConfig'

interface Typography {
  fontPx: number
  fontFamily: string
}

function readTypography(): Typography {
  const root = getComputedStyle(document.documentElement)
  const rootPx = parseFloat(root.fontSize) || 16
  const labelRem = parseFloat(root.getPropertyValue('--graph-label-size')) || 0.6875
  return { fontPx: rootPx * labelRem, fontFamily: getComputedStyle(document.body).fontFamily }
}

export interface RenderRefs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  sceneRef: React.RefObject<ForceScene | null>
  transformRef: React.RefObject<Transform>
  sizeRef: React.RefObject<ViewportSize>
  fit: () => void
  /** 划分叠加层(只用于当前层;淡出中的上一层不画) */
  modules: ModuleDrawState | null
  /** 当前悬停看法(滚轮切换) */
  hoverMode: HoverMode
  selectedId: string | null
}

export interface GraphRender {
  requestDraw: () => void
  setHover: (id: string | null) => void
  /** 切换层级前调用:把当前层存为淡出快照,并重置自动适应 */
  beginLevelTransition: () => void
}

type HoverMotion = HoverState & { target: number; last: number }

/** 悬停进度按时间推进到目标值;返回是否还需要下一帧 */
function stepHover(h: HoverMotion, now: number): boolean {
  const dt = h.last ? now - h.last : 0
  h.last = now
  const step = dt / GRAPH_MOTION.hoverMs
  h.t = h.target > h.t ? Math.min(h.target, h.t + step) : Math.max(h.target, h.t - step)
  if (h.t === 0 && h.target === 0) h.id = null
  const done = h.t === h.target
  if (done) h.last = 0
  return !done
}

interface LevelMotion {
  start: number
  /** 上一层的淡出快照;淡出结束后清空 */
  ghost: ForceScene | null
  /** 本次切换是否带淡出段(决定淡入起点) */
  hadGhost: boolean
  autoFitted: boolean
  /** 切换前所在层级:新层的场景到位之前不适应(此时场景还是旧层) */
  fromDir: string | null
}

/** 新层级首次绘制之前按内容落一次视口:打开即舒适比例,此后只随用户手动缩放平移 */
function autoFitOnce(lv: LevelMotion, scene: ForceScene | null, r: RenderRefs): void {
  if (!scene || lv.autoFitted || scene.dirRel === lv.fromDir) return
  // 画布尺寸还没量出来(刚挂上等):等下一帧,别把这一次落视口的机会用掉
  if (r.sizeRef.current.w === 0) return
  lv.autoFitted = true
  r.fit()
}

/** refs 由调用方在布局与视口就绪后填入(三者互相引用,经 ref 中转打破循环) */
export function useGraphRender(refs: React.RefObject<RenderRefs | null>): GraphRender {
  const rafRef = useRef(0)
  const hoverRef = useRef<HoverMotion>({ id: null, t: 0, target: 0, last: 0 })
  const levelRef = useRef<LevelMotion>({
    start: 0,
    ghost: null,
    hadGhost: false,
    autoFitted: false,
    fromDir: null
  })
  const colorsRef = useRef<GraphColors | null>(null)
  const typoRef = useRef<Typography | null>(null)

  const frame = useCallback(
    (now: number): boolean => {
      const r = refs.current
      const canvas = r?.canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!r || !canvas || !ctx) return false
      const lv = levelRef.current
      const size = r.sizeRef.current
      const tf = r.transformRef.current
      colorsRef.current ??= readGraphColors(canvas)
      typoRef.current ??= readTypography()
      const colors = colorsRef.current
      const elapsed = now - lv.start
      if (lv.ghost && elapsed >= GRAPH_MOTION.levelOutMs) lv.ghost = null
      const scene = r.sceneRef.current
      // 旧层淡完之后、新层第一次绘制之前适应:淡出中的旧层不被缩放,新层首帧就是最终比例
      if (!lv.ghost) autoFitOnce(lv, scene, r)
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
      ctx.fillStyle = colors.bg
      ctx.fillRect(0, 0, size.w, size.h)
      ctx.setTransform(size.dpr * tf.k, 0, 0, size.dpr * tf.k, size.dpr * tf.x, size.dpr * tf.y)
      let more = stepHover(hoverRef.current, now)
      const base = { hover: hoverRef.current, transform: tf, colors, ...typoRef.current }
      if (lv.ghost) {
        const ghostAlpha = 1 - elapsed / GRAPH_MOTION.levelOutMs
        drawGraph(ctx, {
          ...base,
          scene: lv.ghost,
          alpha: ghostAlpha,
          modules: null,
          hoverMode: 'links',
          selectedId: null
        })
        return true
      }
      const inStart = lv.start + (lv.hadGhost ? GRAPH_MOTION.levelOutMs : 0)
      const inAlpha = lv.start
        ? Math.max(0, Math.min(1, (now - inStart) / GRAPH_MOTION.levelInMs))
        : 1
      if (inAlpha < 1) more = true
      if (scene) {
        drawGraph(ctx, {
          ...base,
          scene,
          alpha: inAlpha,
          modules: r.modules,
          hoverMode: r.hoverMode,
          selectedId: r.selectedId
        })
      }
      return more
    },
    [refs]
  )

  const requestDraw = useCallback(() => {
    const schedule = (): void => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame((now) => {
        rafRef.current = 0
        if (frame(now)) schedule()
      })
    }
    schedule()
  }, [frame])

  useEffect(() => {
    // 亮暗切换挂在 <html data-theme>,自定义主题色写在 <html style>:任一变化即重读颜色
    const mo = new MutationObserver(() => {
      colorsRef.current = null
      typoRef.current = null
      requestDraw()
    })
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style']
    })
    return () => {
      mo.disconnect()
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [requestDraw])

  const setHover = useCallback(
    (id: string | null) => {
      const h = hoverRef.current
      if (id) h.id = id
      h.target = id ? 1 : 0
      requestDraw()
    },
    [requestDraw]
  )

  const beginLevelTransition = useCallback(() => {
    const lv = levelRef.current
    lv.ghost = refs.current?.sceneRef.current ?? null
    lv.fromDir = lv.ghost?.dirRel ?? null
    lv.hadGhost = lv.ghost !== null && lv.ghost.nodes.length > 0
    lv.start = performance.now()
    lv.autoFitted = false
    Object.assign(hoverRef.current, { id: null, t: 0, target: 0, last: 0 })
    requestDraw()
  }, [refs, requestDraw])

  return { requestDraw, setHover, beginLevelTransition }
}
