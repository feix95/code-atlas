// 展开容器的绘制:半透明圆底在轮廓之前铺好,名称在标签阶段画在容器顶边内侧。
// 子项由节点层绘制;容器自身不画实心圆与色环。纯绘制,不持有状态。
import type { SimNode } from './useForceLayout'
import type { GraphColors } from './drawGraph'
import { GRAPH_CONTAINER } from './graphConfig'
import { truncateLabel } from './graphText'

export function drawContainers(
  ctx: CanvasRenderingContext2D,
  nodes: readonly SimNode[],
  colors: GraphColors,
  /** 每个容器的整体不透明度(悬停时无关容器与节点一起变淡) */
  alphaOf: (node: SimNode) => number,
  highlightId: string | null,
  highlightT: number
): void {
  for (const node of nodes) {
    if (!node.data.isContainer) continue
    const alpha = alphaOf(node)
    ctx.globalAlpha = alpha * colors.container.fillAlpha
    ctx.fillStyle = colors.folder
    ctx.beginPath()
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = alpha * colors.container.strokeAlpha
    ctx.strokeStyle = node.id === highlightId && highlightT > 0.5 ? colors.focus : colors.folder
    ctx.lineWidth = GRAPH_CONTAINER.strokeWidth
    ctx.stroke()
  }
}

export function drawContainerLabel(
  ctx: CanvasRenderingContext2D,
  node: SimNode,
  colors: GraphColors,
  alpha: number
): void {
  if (!node.data.isContainer || alpha <= 0.01) return
  ctx.globalAlpha = alpha
  ctx.fillStyle = colors.label
  ctx.fillText(truncateLabel(node.data.label), node.x, node.y - node.r + GRAPH_CONTAINER.labelGap)
}
