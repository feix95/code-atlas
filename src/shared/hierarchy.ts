// 分组树:关系图谱的层级抽象。文件夹实现包装扫描树;P4 的模块树、标签树复用同一接口。
// 路径契约照旧 —— 节点身份是 relPath,根节点 id 为扫描树根自己的 relPath(通常为空串)。
import type { ScanDirNode } from './types.ts'

export type GroupKind = 'folder' | 'file'

export interface GroupTree {
  readonly rootId: string
  has(id: string): boolean
  kindOf(id: string): GroupKind
  labelOf(id: string): string
  /** 直接子项:文件夹在前、文件在后,各自保持扫描顺序 */
  children(id: string): readonly string[]
  parentOf(id: string): string | null
  isLazy(id: string): boolean
  /** 已扫描的后代文件数;文件本身为 0 */
  descendantFiles(id: string): number
  /** 扫描树里出现的全部文件 relPath:引用端点不在这份名单里的边直接跳过 */
  allFiles(): ReadonlySet<string>
}

interface Entry {
  kind: GroupKind
  label: string
  parentId: string | null
  lazy: boolean
  descendantFiles: number
  children: readonly string[]
}

function entryOf(entries: ReadonlyMap<string, Entry>, id: string): Entry {
  const entry = entries.get(id)
  if (!entry) throw new Error(`分组树里没有节点:${id}`)
  return entry
}

export function folderTree(scanTree: ScanDirNode): GroupTree {
  const entries = new Map<string, Entry>()
  const files = new Set<string>()

  const walk = (node: ScanDirNode): { files: number; children: string[] } => {
    const folders: string[] = []
    const leafFiles: string[] = []
    let count = 0
    for (const child of node.children) {
      if (child.type === 'directory') {
        const sub = walk(child)
        entries.set(child.relPath, {
          kind: 'folder',
          label: child.name,
          parentId: node.relPath,
          lazy: child.lazy ?? false,
          descendantFiles: sub.files,
          children: sub.children
        })
        folders.push(child.relPath)
        count += sub.files
      } else {
        files.add(child.relPath)
        entries.set(child.relPath, {
          kind: 'file',
          label: child.name,
          parentId: node.relPath,
          lazy: false,
          descendantFiles: 0,
          children: []
        })
        leafFiles.push(child.relPath)
        count += 1
      }
    }
    return { files: count, children: [...folders, ...leafFiles] }
  }

  const root = walk(scanTree)
  entries.set(scanTree.relPath, {
    kind: 'folder',
    label: scanTree.name,
    parentId: null,
    lazy: scanTree.lazy ?? false,
    descendantFiles: root.files,
    children: root.children
  })

  return {
    rootId: scanTree.relPath,
    has: (id) => entries.has(id),
    kindOf: (id) => entryOf(entries, id).kind,
    labelOf: (id) => entryOf(entries, id).label,
    children: (id) => entries.get(id)?.children ?? [],
    parentOf: (id) => entries.get(id)?.parentId ?? null,
    isLazy: (id) => entries.get(id)?.lazy ?? false,
    descendantFiles: (id) => entries.get(id)?.descendantFiles ?? 0,
    allFiles: () => files
  }
}
