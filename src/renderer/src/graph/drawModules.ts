// 划分叠加层的 Canvas 2D 绘制:模块轮廓(半透明凸包 + 模块名)与文件夹分段色环。
// 绘制顺序由 drawGraph 编排:轮廓 → 边 → 色环 → 节点 → 标签。纯绘制,不持有状态。
import type { ForceScene, SimNode } from './useForceLayout'
import type { ModuleOverlay, RingSegment } from './moduleOverlay'
import { moduleDisplayName } from './moduleOverlay'
import { circleHull } from './hull'
import { GRAPH_HULL, GRAPH_MOTION, GRAPH_RING } from './graphConfig'

export interface ModuleColors {
  /** 调色板(--graph-module-1 至 --graph-module-N) */
  palette: string[]
  neutral: string
  hullFillAlpha: number
  hullStrokeAlpha: number
}

export interface ModuleDrawState {
  overlay: ModuleOverlay
  /** 「高亮同模块」的模块 id:非成员变淡;null = 不高亮 */
  highlight: string | null
}

function colorOf(state: ModuleDrawState, colors: ModuleColors, moduleId: string | null): string {
  const index = moduleId === null ? undefined : state.overlay.colorOf.get(moduleId)
  return index === undefined ? colors.neutral : colors.palette[index] || colors.neutral
}

/** 高亮同模块时,节点(或轮廓)不属于该模块就按 dimAlpha 变淡 */
export function moduleDim(state: ModuleDrawState | null, moduleId: string | null): number {
  if (!state?.highlight) return 1
  return moduleId === state.highlight ? 1 : GRAPH_MOTION.dimAlpha
}

export function drawHulls(
  ctx: CanvasRenderingContext2D,
  scene: ForceScene,
  state: ModuleDrawState,
  colors: ModuleColors,
  alpha: number,
  labelAlpha: number
): void {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]))
  for (const [moduleId, ids] of state.overlay.hulls) {
    const circles = ids.map((id) => byId.get(id)).filter((n): n is SimNode => n !== undefined)
    if (circles.length < 2) continue
    const poly = circleHull(circles, GRAPH_HULL.padding, GRAPH_HULL.samples)
    const color = colorOf(state, colors, moduleId)
    const dim = alpha * moduleDim(state, moduleId)
    ctx.beginPath()
    poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = GRAPH_HULL.strokeWidth
    ctx.globalAlpha = dim * colors.hullFillAlpha
    ctx.fill()
    ctx.globalAlpha = dim * colors.hullStrokeAlpha
    ctx.stroke()
    const info = state.overlay.byId.get(moduleId)
    if (!info || labelAlpha <= 0.01) continue
    const top = poly.reduce((best, p) => (p[1] < best[1] ? p : best), poly[0])
    ctx.globalAlpha = dim * labelAlpha
    ctx.textBaseline = 'bottom'
    ctx.fillText(moduleDisplayName(info), top[0], top[1] - GRAPH_HULL.labelGap)
  }
}

export function drawRing(
  ctx: CanvasRenderingContext2D,
  n: SimNode,
  segments: RingSegment[],
  state: ModuleDrawState,
  colors: ModuleColors,
  alpha: number
): void {
  if (segments.length === 0) return
  const radius = n.r + GRAPH_RING.gap + GRAPH_RING.width / 2
  const gap = segments.length > 1 ? GRAPH_RING.segmentGap : 0
  ctx.lineWidth = GRAPH_RING.width
  ctx.globalAlpha = alpha
  let angle = -Math.PI / 2
  for (const seg of segments) {
    const sweep = seg.share * Math.PI * 2
    ctx.strokeStyle = colorOf(state, colors, seg.moduleId)
    ctx.beginPath()
    ctx.arc(n.x, n.y, radius, angle + gap / 2, angle + Math.max(sweep - gap / 2, gap / 2))
    ctx.stroke()
    angle += sweep
  }
}
