// 悬停看法的状态:鼠标停在节点上滚轮时切换(见 hoverModes),鼠标离开这个节点就回到默认的「引用关系」。
// 切换后在鼠标旁显示一枚小标签(看法名 + 第几种 / 共几种)。
// 同时记下当前悬停的节点与它屏幕上的落位,供悬停提示框贴上去。
import { useCallback, useState } from 'react'
import type { SimNode } from './useForceLayout'
import type { HoverTarget } from './useGraphViewport'
import { hoverModesFor, stepHoverMode, type HoverMode } from './hoverModes'

export interface HoverModeTag {
  nodeId: string
  mode: HoverMode
  /** 从 1 数起 */
  index: number
  count: number
  /** 画布内像素坐标(标签贴在鼠标右下) */
  x: number
  y: number
}

export interface GraphHoverMode {
  mode: HoverMode
  tag: HoverModeTag | null
  /** 当前悬停的节点与落位;拖拽中也有,dragging 为 true 时提示框不亮 */
  hover: HoverTarget | null
  /** 接在视口的悬停回调上:悬停节点变了就重置看法 */
  onHoverChange: (hover: HoverTarget | null) => void
  onModeWheel: (node: SimNode, steps: number, x: number, y: number) => void
}

export function useGraphHoverMode(
  moduleOfNode: (id: string) => string | null,
  setHover: (id: string | null) => void
): GraphHoverMode {
  const [tag, setTag] = useState<HoverModeTag | null>(null)
  const [hover, setHoverTarget] = useState<HoverTarget | null>(null)

  const onHoverChange = useCallback(
    (next: HoverTarget | null) => {
      const id = next?.node.id ?? null
      setHoverTarget((prev) => {
        if (!next) return prev === null ? prev : null
        if (
          prev &&
          prev.node.id === next.node.id &&
          prev.dragging === next.dragging &&
          prev.x === next.x &&
          prev.y === next.y &&
          prev.r === next.r
        )
          return prev
        return next
      })
      setHover(id)
      setTag((t) => (t && t.nodeId === id ? t : null))
    },
    [setHover]
  )

  const onModeWheel = useCallback(
    (node: SimNode, steps: number, x: number, y: number) => {
      const modes = hoverModesFor(moduleOfNode(node.id))
      setTag((t) => {
        const current = t && t.nodeId === node.id ? t.mode : 'links'
        const mode = stepHoverMode(current, modes, steps)
        const index = modes.indexOf(mode) + 1
        return { nodeId: node.id, mode, index, count: modes.length, x, y }
      })
    },
    [moduleOfNode]
  )

  return { mode: tag?.mode ?? 'links', tag, hover, onHoverChange, onModeWheel }
}
