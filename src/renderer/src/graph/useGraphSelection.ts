// 图谱的选中状态,以及节点右键菜单的行项。
// 选中 = 指针落到节点上(侧栏所指),点空白或 Esc 取消;只是视图状态,不触发任何请求。
import { useCallback, useState } from 'react'
import type { LevelNode } from '@shared/graphView'
import type { ContextMenuEntry } from '../components/contextMenuStore'

export interface GraphSelection {
  /** 选中节点的快照(侧栏按它显示;跳到别的文件夹后仍保留) */
  selected: LevelNode | null
  select: (node: LevelNode | null) => void
  /** Esc / 单击空白:取消选中 */
  clear: () => void
}

export function useGraphSelection(): GraphSelection {
  const [selected, setSelected] = useState<LevelNode | null>(null)

  const clear = useCallback(() => setSelected(null), [])

  return { selected, select: setSelected, clear }
}

export interface NodeMenuActions {
  moduleId: string | null
  onDetails: () => void
  onChangeColor: () => void
  onActivate: () => void
}

/** 节点右键菜单:查看模块详情、更改模块颜色(有归属模块才出)、打开文件 / 进入此文件夹 */
export function nodeMenuItems(node: LevelNode, actions: NodeMenuActions): ContextMenuEntry[] {
  const isFile = node.kind === 'file' || (node.kind === 'external' && node.target === 'file')
  const items: ContextMenuEntry[] = [
    { label: '查看模块详情', icon: 'component', run: actions.onDetails }
  ]
  // 没有归属模块的节点无从改色:整行不出,菜单宽度随最长一行收窄
  if (actions.moduleId !== null) {
    items.push({ label: '更改模块颜色', icon: 'palette', run: actions.onChangeColor })
  }
  if (node.kind === 'overflow') return items
  items.push({
    label: isFile ? '打开文件' : '进入此文件夹',
    icon: isFile ? 'file' : 'folder',
    run: actions.onActivate
  })
  return items
}
