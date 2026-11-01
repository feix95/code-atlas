// 滚轮手势落在节点或空白处时的层级动作:展开、收起、进入文件夹或返回上一层。
import { useCallback } from 'react'
import type { LevelNode } from '@shared/graphView'
import type { GraphExpansion } from './useGraphExpansion'
import type { GraphNav } from './useGraphNav'
import type { SimNode } from './useForceLayout'
import { levelWheelAction, wheelTargetOf } from './wheelIntent'

interface EnterLeaveDeps {
  nav: GraphNav
  expansion: GraphExpansion
  /** 进入文件夹:先清旧选中,再走节点的主动作 */
  onEnter: (node: LevelNode) => void
}

export function useGraphEnterLeave({
  nav,
  expansion,
  onEnter
}: EnterLeaveDeps): (node: SimNode | null, steps: number, containerId: string | null) => void {
  return useCallback(
    (node, steps, containerId) => {
      const target = wheelTargetOf(node)
      const action = levelWheelAction(target, steps, nav.dirRel !== '', containerId)
      if (action.kind === 'expandAll') expansion.expandAll()
      else if (action.kind === 'collapseAll') expansion.collapseAll()
      else if (action.kind === 'collapseContainer') expansion.toggle(action.id)
      else if (action.kind === 'expandFolder' && node) expansion.toggle(node.id)
      else if (action.kind === 'leave') nav.goUp()
      else if (action.kind === 'enter' && node) onEnter(node.data)
    },
    [nav, expansion, onEnter]
  )
}
