// 图谱节点的主动作:文件打开预览,文件夹与「其余 N 项」入口进入焦点页。
import { useCallback } from 'react'
import type { LevelNode } from '@shared/graphView'
import type { GraphNav } from './useGraphNav'

/** 文件夹、外部文件夹与「其余 N 项」入口:主动作都是进入 */
export const isFolderTarget = (d: LevelNode): boolean =>
  d.kind === 'folder' || d.kind === 'overflow' || (d.kind === 'external' && d.target === 'folder')

export function useNodeActivate(
  nav: GraphNav,
  onOpenFile: (relPath: string) => void
): (d: LevelNode) => void {
  return useCallback(
    (d: LevelNode) => {
      if (d.kind === 'file' || (d.kind === 'external' && d.target === 'file')) onOpenFile(d.id)
      else if (d.kind === 'overflow') {
        if (d.groupId) void nav.navigate(d.groupId)
      } else if (d.kind === 'folder' || d.kind === 'external') void nav.navigate(d.id)
    },
    [nav, onOpenFile]
  )
}
