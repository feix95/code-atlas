// 第九十锤:文件树右栏的大小账 —— 文件自己的大小扫描时已带上,
// 文件夹的总和在渲染层现算:分级扫描探开一层树就换一次,烤死在节点上会说谎
import type { ScanDirNode } from './types.ts'

export interface DirSize {
  /** 名下(已扫进树的)文件字节总和 */
  bytes: number
  /** 子孙全都探全了才算得准;只要有一处 lazy / truncated,这个总和就是残账 */
  complete: boolean
}

/**
 * 一趟后序遍历,给每个文件夹算出「名下多大、算不算得准」。
 * 返回 relPath → DirSize 的账本(文件不进账本,自己节点上有 sizeBytes);
 * 根目录 relPath 是 '',也是合法的键
 */
export function computeTreeSizes(root: ScanDirNode): Map<string, DirSize> {
  const sizes = new Map<string, DirSize>()

  const walk = (dir: ScanDirNode): DirSize => {
    let bytes = 0
    // 自己没探全,或者子孙里有谁没探全,总和就只能算残账
    let complete = !(dir.lazy || dir.truncated)
    for (const child of dir.children) {
      if (child.type === 'file') {
        bytes += child.sizeBytes
      } else {
        const sub = walk(child)
        bytes += sub.bytes
        if (!sub.complete) complete = false
      }
    }
    const entry: DirSize = { bytes, complete }
    sizes.set(dir.relPath, entry)
    return entry
  }

  walk(root)
  return sizes
}
