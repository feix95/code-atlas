// 图谱的选中与「高亮同模块」状态,以及节点右键菜单的行项。
// 选中 = 单击节点(侧栏所指);高亮 = 非该模块成员变淡。两者都只是视图状态,不触发任何请求。
import { useCallback, useState } from 'react'
import type { LevelGraph, LevelNode } from '@shared/graphView'
import type { ContextMenuEntry } from '../components/contextMenuStore'

export interface GraphSelection {
  /** 选中节点的快照(侧栏按它显示;跳到别的文件夹后仍保留) */
  selected: LevelNode | null
  highlight: string | null
  select: (node: LevelNode | null) => void
  toggleHighlight: (moduleId: string) => void
  /** Esc / 单击空白:取消选中与高亮 */
  clear: () => void
  /** 侧栏里点文件:在当前层就选中并居中,否则进入它所在的文件夹再选中 */
  focusFile: (relPath: string) => void
}

interface SelectionDeps {
  level: LevelGraph | null
  navigate: (relPath: string) => Promise<void>
  centerOn: (id: string) => boolean
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

export function useGraphSelection({ level, navigate, centerOn }: SelectionDeps): GraphSelection {
  const [selected, setSelected] = useState<LevelNode | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)

  const toggleHighlight = useCallback((moduleId: string) => {
    setHighlight((prev) => (prev === moduleId ? null : moduleId))
  }, [])

  const clear = useCallback(() => {
    setSelected(null)
    setHighlight(null)
  }, [])

  const focusFile = useCallback(
    (relPath: string) => {
      const visible = level?.nodes.find((n) => n.id === relPath && n.kind === 'file')
      if (visible) {
        setSelected(visible)
        centerOn(relPath)
        return
      }
      const label = relPath.slice(relPath.lastIndexOf('/') + 1)
      setSelected({ id: relPath, kind: 'file', label, degree: 0, descendantFiles: 0 })
      void navigate(dirOf(relPath))
    },
    [level, navigate, centerOn]
  )

  return { selected, highlight, select: setSelected, toggleHighlight, clear, focusFile }
}

export interface NodeMenuActions {
  moduleId: string | null
  isHighlighted: boolean
  onDetails: () => void
  onToggleHighlight: () => void
  onActivate: () => void
}

/** 节点右键菜单:查看模块详情、高亮同模块、打开文件 / 进入文件夹 */
export function nodeMenuItems(node: LevelNode, actions: NodeMenuActions): ContextMenuEntry[] {
  const isFile = node.kind === 'file' || (node.kind === 'external' && node.target === 'file')
  const noModule = actions.moduleId === null
  const items: ContextMenuEntry[] = [
    { label: '查看模块详情', icon: 'component', run: actions.onDetails },
    {
      label: actions.isHighlighted ? '取消高亮' : '高亮同模块',
      icon: 'bulb',
      disabled: noModule,
      tip: noModule ? '这个节点不属于任何模块' : undefined,
      run: actions.onToggleHighlight
    }
  ]
  if (node.kind === 'overflow') return items
  items.push({
    label: isFile ? '打开文件' : '进入文件夹',
    icon: isFile ? 'file' : 'folder',
    run: actions.onActivate
  })
  return items
}
