// 图层悬停联动:鼠标停在左栏某一行,画布上给对应对象描一圈功能蓝细线(Figma 同款)。
// 画在视口上的屏幕坐标覆盖层,不拦指针、不进设计数值;隐藏的对象不在渲染列表里,自然不描。
import type { SceneNode } from '@shared/uiWorkbench/scene'
import { useHoveredLayer } from '../../uiWorkbench/layerHoverStore'
import { nodeOutline, pointsAttr } from '../../uiWorkbench/nodeOutline'
import type { Viewport } from '../../uiWorkbench/viewport'

export function LayerHoverOutline({
  nodes,
  view
}: {
  nodes: readonly SceneNode[]
  view: Viewport
}): React.JSX.Element | null {
  const hoveredId = useHoveredLayer()
  const node = hoveredId === null ? undefined : nodes.find((n) => n.id === hoveredId)
  if (!node) return null
  return (
    <svg className="uwb-overlay" aria-hidden="true">
      <polygon className="uwb-hover-node" points={pointsAttr(nodeOutline(node, view))} />
    </svg>
  )
}
