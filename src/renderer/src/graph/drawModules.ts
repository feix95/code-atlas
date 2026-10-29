// 划分叠加层的 Canvas 2D 绘制:模块轮廓(只贴成员的半透明轮廓 + 模块名)与文件夹分段色环。
// 绘制顺序由 drawGraph 编排:轮廓 → 边 → 色环 → 节点 → 标签。纯绘制,不持有状态。
import type { ForceScene, SimNode } from './useForceLayout'
import type { ModuleOverlay, RingSegment } from './moduleOverlay'
import { moduleDisplayName } from './moduleOverlay'
import { moduleOutline, type Point } from './outline'
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

/** 闭合环按相邻顶点中点做二次曲线平滑,去掉网格留下的折角 */
function traceSmooth(ctx: CanvasRenderingContext2D, loop: Point[]): void {
  const mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  const start = mid(loop[loop.length - 1], loop[0])
  ctx.moveTo(start[0], start[1])
  loop.forEach((p, i) => {
    const m = mid(p, loop[(i + 1) % loop.length])
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1])
  })
  ctx.closePath()
}

function topmost(loops: Point[][]): Point {
  return loops.flat().reduce((best, p) => (p[1] < best[1] ? p : best))
}

interface OutlineCache {
  signature: number
  overlay: ModuleDrawState['overlay']
  loops: Map<string, Point[][]>
}

/** 每个场景一份轮廓缓存:节点没动(只是悬停、淡入等重绘)时不重算 */
const outlineCache = new WeakMap<ForceScene, OutlineCache>()

/** 全部节点坐标(精确到半个世界单位)的滚动哈希,用来判断布局是否动过 */
function positionSignature(scene: ForceScene): number {
  let hash = scene.nodes.length
  for (const n of scene.nodes) {
    hash = (Math.imul(hash, 31) + Math.round(n.x * 2)) | 0
    hash = (Math.imul(hash, 31) + Math.round(n.y * 2)) | 0
  }
  return hash
}

function outlinesOf(scene: ForceScene, state: ModuleDrawState): Map<string, Point[][]> {
  const signature = positionSignature(scene)
  const cached = outlineCache.get(scene)
  if (cached && cached.signature === signature && cached.overlay === state.overlay)
    return cached.loops
  const byId = new Map(scene.nodes.map((n) => [n.id, n]))
  const loops = new Map<string, Point[][]>()
  for (const [moduleId, ids] of state.overlay.hulls) {
    const circles = ids.map((id) => byId.get(id)).filter((n): n is SimNode => n !== undefined)
    if (circles.length < 2) continue
    const memberIds = new Set(ids)
    const others = scene.nodes.filter((n) => !memberIds.has(n.id))
    loops.set(moduleId, moduleOutline(circles, others, GRAPH_HULL))
  }
  outlineCache.set(scene, { signature, overlay: state.overlay, loops })
  return loops
}

export function drawHulls(
  ctx: CanvasRenderingContext2D,
  scene: ForceScene,
  state: ModuleDrawState,
  colors: ModuleColors,
  alpha: number,
  labelAlpha: number
): void {
  for (const [moduleId, loops] of outlinesOf(scene, state)) {
    if (loops.length === 0) continue
    const color = colorOf(state, colors, moduleId)
    const dim = alpha * moduleDim(state, moduleId)
    ctx.beginPath()
    for (const loop of loops) traceSmooth(ctx, loop)
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = GRAPH_HULL.strokeWidth
    ctx.globalAlpha = dim * colors.hullFillAlpha
    ctx.fill('evenodd')
    ctx.globalAlpha = dim * colors.hullStrokeAlpha
    ctx.stroke()
    const info = state.overlay.byId.get(moduleId)
    if (!info || labelAlpha <= 0.01) continue
    const top = topmost(loops)
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
