// 悬停看法的状态:鼠标停在节点上滚轮时切换(见 hoverModes),鼠标离开这个节点就回到默认的「引用关系」。
// 切换后在鼠标旁显示一枚小标签(看法名 + 第几种 / 共几种)。
import { useCallback, useState } from 'react'
import type { SimNode } from './useForceLayout'
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
  /** 接在视口的悬停回调上:悬停节点变了就重置看法 */
  onHoverChange: (id: string | null) => void
  onModeWheel: (node: SimNode, steps: number, x: number, y: number) => void
}

export function useGraphHoverMode(
  moduleOfNode: (id: string) => string | null,
  setHover: (id: string | null) => void
): GraphHoverMode {
  const [tag, setTag] = useState<HoverModeTag | null>(null)

  const onHoverChange = useCallback(
    (id: string | null) => {
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

  return { mode: tag?.mode ?? 'links', tag, onHoverChange, onModeWheel }
}
