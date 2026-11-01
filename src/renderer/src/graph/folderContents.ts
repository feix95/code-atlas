// 文件夹详情的内容清单:只列直接子项(文件夹在前、文件在后,沿用扫描顺序),
// 超长文件夹按图上预览额度截断,剩余项数单独给出。
import type { GroupTree } from '../../../shared/hierarchy.ts'
import { GRAPH_PREVIEW_NODES } from '../../../shared/visibleGraph.ts'

export interface FolderEntry {
  id: string
  name: string
  kind: 'folder' | 'file'
  /** 文件夹:已扫描的后代文件数;文件为 0 */
  descendantFiles: number
}

export interface FolderContents {
  entries: FolderEntry[]
  /** 超出预览额度、没有列出的直接子项数 */
  hidden: number
}

export function folderContents(tree: GroupTree, id: string): FolderContents {
  if (!tree.has(id)) return { entries: [], hidden: 0 }
  const children = tree.children(id)
  return {
    entries: children.slice(0, GRAPH_PREVIEW_NODES).map((child) => ({
      id: child,
      name: tree.labelOf(child),
      kind: tree.kindOf(child),
      descendantFiles: tree.descendantFiles(child)
    })),
    hidden: Math.max(0, children.length - GRAPH_PREVIEW_NODES)
  }
}
