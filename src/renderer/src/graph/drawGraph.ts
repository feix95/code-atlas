// 关系图谱的 Canvas 2D 绘制:边 → 箭头 → 节点 → 标签。纯绘制,不持有状态;
// 颜色从 --graph-* CSS 自定义属性读取(跟随亮暗主题与主题色)。
import type { ForceScene, SimLink, SimNode } from './useForceLayout'
import { GRAPH_EDGE, GRAPH_LABEL, GRAPH_MOTION, GRAPH_NODE } from './graphConfig'

export interface GraphColors {
  bg: string
  node: string
  folder: string
  edge: string
  label: string
  focus: string
  muted: string
}

export function readGraphColors(el: Element): GraphColors {
  const cs = getComputedStyle(el)
  const v = (name: string): string => cs.getPropertyValue(name).trim()
  return {
    bg: v('--graph-bg'),
    node: v('--graph-node'),
    folder: v('--graph-folder'),
    edge: v('--graph-edge'),
    label: v('--graph-label'),
    focus: v('--graph-focus'),
    muted: v('--graph-muted')
  }
}

export interface Transform {
  k: number
  x: number
  y: number
}

export interface HoverState {
  /** 当前(或正在淡出的)悬停节点 */
  id: string | null
  /** 高亮进度 0..1 */
  t: number
}

export interface DrawInput {
  scene: ForceScene
  /** 整层不透明度(切换层级淡入淡出) */
  alpha: number
  hover: HoverState
  transform: Transform
  colors: GraphColors
  fontPx: number
  fontFamily: string
}

function neighborSet(scene: ForceScene, id: string | null): Set<string> {
  const set = new Set<string>()
  if (!id) return set
  set.add(id)
  for (const l of scene.links) {
    if (l.source.id === id) set.add(l.target.id)
    if (l.target.id === id) set.add(l.source.id)
  }
  return set
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function labelAlphaAt(k: number): number {
  const t = (k - GRAPH_LABEL.fadeOutScale) / (GRAPH_LABEL.fadeInScale - GRAPH_LABEL.fadeOutScale)
  return Math.max(0, Math.min(1, t))
}

function truncate(text: string): string {
  return text.length > GRAPH_LABEL.maxChars ? text.slice(0, GRAPH_LABEL.maxChars - 1) + '…' : text
}

function drawLink(ctx: CanvasRenderingContext2D, l: SimLink, color: string, alpha: number): void {
  const { source: s, target: t } = l
  const dx = t.x - s.x
  const dy = t.y - s.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-3) return
  const ux = dx / len
  const uy = dy / len
  const tipX = t.x - ux * (t.r + 1)
  const tipY = t.y - uy * (t.r + 1)
  const baseX = tipX - ux * GRAPH_EDGE.arrowLength
  const baseY = tipY - uy * GRAPH_EDGE.arrowLength
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = GRAPH_EDGE.width + Math.log2(l.weight) * GRAPH_EDGE.weightStep
  ctx.beginPath()
  ctx.moveTo(s.x + ux * s.r, s.y + uy * s.r)
  ctx.lineTo(baseX, baseY)
  ctx.stroke()
  const w = GRAPH_EDGE.arrowWidth / 2
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(baseX - uy * w, baseY + ux * w)
  ctx.lineTo(baseX + uy * w, baseY - ux * w)
  ctx.closePath()
  ctx.fill()
}

/** 节点外观:实心 / 空心描边 / 虚线空心 */
function nodeStyle(
  n: SimNode,
  c: GraphColors
): { color: string; hollow: boolean; dashed: boolean } {
  const d = n.data
  if (d.kind === 'folder') return { color: c.folder, hollow: !!d.lazy, dashed: false }
  if (d.kind === 'external')
    return { color: d.target === 'folder' ? c.folder : c.node, hollow: true, dashed: true }
  if (d.kind === 'overflow') return { color: c.muted, hollow: true, dashed: true }
  return { color: c.node, hollow: false, dashed: false }
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  n: SimNode,
  c: GraphColors,
  focused: boolean,
  alpha: number
): void {
  const style = nodeStyle(n, c)
  const color = focused ? c.focus : style.color
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
  if (!style.hollow) {
    ctx.fillStyle = color
    ctx.fill()
    return
  }
  ctx.fillStyle = c.bg
  ctx.fill()
  ctx.lineWidth = GRAPH_NODE.ringWidth
  ctx.strokeStyle = color
  ctx.setLineDash(style.dashed ? [2.5, 2] : [])
  ctx.stroke()
  ctx.setLineDash([])
}

function drawLabel(ctx: CanvasRenderingContext2D, n: SimNode, color: string, alpha: number): void {
  if (alpha <= 0.01) return
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.fillText(truncate(n.data.label), n.x, n.y + n.r + GRAPH_LABEL.gap)
}

export function drawGraph(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const { scene, hover, transform: tf, colors: c, alpha } = input
  const related = neighborSet(scene, hover.id)
  const dim = lerp(1, GRAPH_MOTION.dimAlpha, hover.t)
  const labelBase = labelAlphaAt(tf.k)
  const isRelatedLink = (l: SimLink): boolean =>
    hover.id !== null && (l.source.id === hover.id || l.target.id === hover.id)

  for (const l of scene.links) {
    const on = isRelatedLink(l)
    drawLink(ctx, l, on && hover.t > 0.5 ? c.focus : c.edge, alpha * (on ? 1 : dim))
  }
  for (const n of scene.nodes) {
    const on = related.has(n.id)
    drawNode(ctx, n, c, n.id === hover.id && hover.t > 0.5, alpha * (on || !hover.id ? 1 : dim))
  }
  ctx.font = `${input.fontPx}px ${input.fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const n of scene.nodes) {
    const on = related.has(n.id)
    const a = on ? Math.max(labelBase, hover.t) : labelBase * (hover.id ? dim : 1)
    drawLabel(ctx, n, c.label, alpha * a)
  }
  ctx.globalAlpha = 1
}
