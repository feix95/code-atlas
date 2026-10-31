// 关系图谱的 Canvas 2D 绘制:模块轮廓 → 边 → 箭头 → 色环 → 节点 → 标签。纯绘制,不持有状态;
// 颜色从 --graph-* CSS 自定义属性读取(跟随亮暗主题与主题色)。
import type { ForceScene, SimLink, SimNode } from './useForceLayout'
import { drawContainers, drawContainerLabel } from './drawContainers'
import { drawHulls, drawRing, type ModuleColors, type ModuleDrawState } from './drawModules'
import {
  GRAPH_EDGE,
  GRAPH_LABEL,
  GRAPH_MODULE_COLORS,
  GRAPH_MOTION,
  GRAPH_NODE
} from './graphConfig'
import { hoverRelated, isHoverLink, type BelongsFn, type HoverMode } from './hoverModes'

export interface GraphColors {
  bg: string
  node: string
  folder: string
  edge: string
  label: string
  focus: string
  muted: string
  modules: ModuleColors
  /** 原地展开容器的圆底与描边透明度 */
  container: {
    fillAlpha: number
    strokeAlpha: number
  }
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
    muted: v('--graph-muted'),
    container: {
      fillAlpha: parseFloat(v('--graph-container-fill-alpha')) || 0,
      strokeAlpha: parseFloat(v('--graph-container-stroke-alpha')) || 0
    },
    modules: {
      palette: Array.from({ length: GRAPH_MODULE_COLORS }, (_, i) => v(`--graph-module-${i + 1}`)),
      tone: {
        sat: parseFloat(v('--graph-module-gen-sat')) || 0,
        lightA: parseFloat(v('--graph-module-gen-light-a')) || 0,
        lightB: parseFloat(v('--graph-module-gen-light-b')) || 0
      },
      neutral: v('--graph-module-neutral'),
      hullFillAlpha: parseFloat(v('--graph-hull-fill-alpha')) || 0,
      hullStrokeAlpha: parseFloat(v('--graph-hull-stroke-alpha')) || 0
    }
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
  /** 划分叠加层;null = 关闭「模块着色」或没有模块数据,画面与改造前一致 */
  modules: ModuleDrawState | null
  /** 悬停节点时的看法(滚轮切换):决定哪些节点与连线保持高亮 */
  hoverMode: HoverMode
  /** 详情浮窗选中的节点(侧栏所指) */
  selectedId: string | null
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

/** 选中节点:节点外再描一圈强调色 */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  n: SimNode,
  color: string,
  alpha: number
): void {
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = GRAPH_NODE.selectedWidth
  ctx.beginPath()
  ctx.arc(n.x, n.y, n.r + GRAPH_NODE.selectedGap, 0, Math.PI * 2)
  ctx.stroke()
}

function nodeModule(input: DrawInput, id: string | null): string | null {
  if (id === null) return null
  return input.modules?.overlay.nodes.get(id)?.hullModule ?? null
}

/** 节点是否属于某模块:文件看归属,文件夹看轮廓归属或色环里有没有这个模块 */
function belongsFn(input: DrawInput): BelongsFn {
  return (nodeId, moduleId) => {
    const info = input.modules?.overlay.nodes.get(nodeId)
    if (!info) return false
    return info.hullModule === moduleId || info.ring.some((s) => s.moduleId === moduleId)
  }
}

function drawNodes(ctx: CanvasRenderingContext2D, input: DrawInput, related: Set<string>): void {
  const { scene, hover, colors: c, alpha, modules } = input
  const dim = lerp(1, GRAPH_MOTION.dimAlpha, hover.t)
  for (const n of scene.nodes) {
    const on = related.has(n.id)
    const a = alpha * (on || !hover.id ? 1 : dim)
    const ring = modules?.overlay.nodes.get(n.id)?.ring
    // 容器的圆底与名称单独绘制,这里跳过它的实心圆与色环
    if (!n.data.isContainer) {
      if (modules && ring) drawRing(ctx, n, ring, modules, c.modules, a)
      drawNode(ctx, n, c, n.id === hover.id && hover.t > 0.5, a)
    }
    if (n.id === input.selectedId) drawSelection(ctx, n, c.focus, alpha)
  }
}

export function drawGraph(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const { scene, hover, hoverMode: mode, transform: tf, colors: c, alpha, modules } = input
  const belongs = belongsFn(input)
  const hoverModule = nodeModule(input, hover.id)
  const related = hoverRelated(scene.nodes, scene.links, hover.id, mode, belongs, hoverModule)
  const dim = lerp(1, GRAPH_MOTION.dimAlpha, hover.t)
  const labelBase = labelAlphaAt(tf.k)
  const isRelatedLink = (l: SimLink): boolean =>
    hover.id !== null && isHoverLink(l, hover.id, mode, belongs, hoverModule)
  // 「同模块」看法下它自己的模块轮廓保持亮,其余轮廓与节点一起变淡
  const hullAlpha = (moduleId: string): number =>
    alpha * (!hover.id || (mode === 'module' && moduleId === hoverModule) ? 1 : dim)

  const containerAlpha = (n: SimNode): number => alpha * (related.has(n.id) || !hover.id ? 1 : dim)

  ctx.font = `${input.fontPx}px ${input.fontFamily}`
  ctx.textAlign = 'center'
  drawContainers(ctx, scene.nodes, c, containerAlpha, hover.id, hover.t)
  if (modules) drawHulls(ctx, scene, modules, c.modules, labelBase, hullAlpha)
  for (const l of scene.links) {
    const on = isRelatedLink(l)
    drawLink(ctx, l, on && hover.t > 0.5 ? c.focus : c.edge, alpha * (on ? 1 : dim))
  }
  drawNodes(ctx, input, related)
  ctx.textBaseline = 'top'
  for (const n of scene.nodes) {
    const on = related.has(n.id)
    const a = on ? Math.max(labelBase, hover.t) : labelBase * (hover.id ? dim : 1)
    if (n.data.isContainer) drawContainerLabel(ctx, n, c, alpha * a)
    else drawLabel(ctx, n, c.label, alpha * a)
  }
  ctx.globalAlpha = 1
}
