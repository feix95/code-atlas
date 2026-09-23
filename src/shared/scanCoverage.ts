import type { ScanDirNode, ScanTreeNode } from './types.ts'

export function isTreePartial(node: ScanTreeNode): boolean {
  return (
    node.type === 'directory' &&
    (!!node.lazy || !!node.truncated || node.children.some(isTreePartial))
  )
}

export function guideEntries(tree: ScanDirNode): ScanTreeNode[] {
  return [...tree.children].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
}
