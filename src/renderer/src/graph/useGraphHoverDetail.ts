// 节点详情的悬停触发:指针一落到节点上就展示,扫过也开。
// 展示后不随鼠标离开收回(留到点空白或 Esc),换节点直接切换;拖拽中的节点不触发。
import { useEffect } from 'react'
import type { LevelNode } from '@shared/graphView'
import type { HoverTarget } from './useGraphViewport'

/** 可以弹出详情的悬停目标:拖拽中先不弹,收起的项只是计数占位,没有可看的详情 */
export function detailNodeOf(hover: HoverTarget | null): LevelNode | null {
  if (!hover || hover.dragging) return null
  return hover.node.data.kind === 'overflow' ? null : hover.node.data
}

export function useGraphHoverDetail(
  hover: HoverTarget | null,
  show: (node: LevelNode) => void
): void {
  const node = detailNodeOf(hover)
  useEffect(() => {
    if (node) show(node)
  }, [node, show])
}
