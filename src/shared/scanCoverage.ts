import type { ScanTreeNode } from './types.ts'

export function isTreePartial(node: ScanTreeNode): boolean {
  return (
    node.type === 'directory' &&
    (!!node.lazy || !!node.truncated || node.children.some(isTreePartial))
  )
}
