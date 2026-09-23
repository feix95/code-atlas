// 扫描树纯工具:子树嫁接/统计累加/按 relPath 找节点/面包屑/父目录链。
// 全是纯函数;路径契约照旧 —— 只认 relPath,不手拼绝对路径。
import type { ScanDirNode, ScanFileNode, ScanResult, ScanTreeNode } from '@shared/types'
import type { Crumb } from './components/DetailHeader'

// 分级扫描:把点开探测到的子树接进地图。沿 relPath 一路浅拷贝(其余节点原样复用),落到目标就换内容
export function spliceSubtree(root: ScanDirNode, relPath: string, sub: ScanDirNode): ScanDirNode {
  const parts = relPath === '' ? [] : relPath.split('/')
  if (parts.length === 0) {
    // 重探根:换内容,身份(rootPath 相关的字段)照旧;truncated 照实透传,子目录没探完不许装完整
    return {
      ...root,
      children: sub.children,
      summary: sub.summary,
      lazy: undefined,
      truncated: sub.truncated
    }
  }
  const walk = (node: ScanDirNode, i: number): ScanDirNode => {
    if (i === parts.length) {
      return {
        ...node,
        children: sub.children,
        summary: sub.summary,
        lazy: undefined,
        truncated: sub.truncated
      }
    }
    return {
      ...node,
      children: node.children.map((c) =>
        c.type === 'directory' && c.name === parts[i] ? walk(c, i + 1) : c
      )
    }
  }
  return walk(root, 0)
}

// 分级扫描:把子树探出来的一份统计累加进总账(各项都是纯增量,直接加)
export function mergeStats(
  base: ScanResult['stats'],
  add: ScanResult['stats']
): ScanResult['stats'] {
  const byExt = { ...base.byExt }
  for (const [k, v] of Object.entries(add.byExt)) byExt[k] = (byExt[k] ?? 0) + v
  const byLanguage = { ...base.byLanguage }
  for (const [k, v] of Object.entries(add.byLanguage)) {
    byLanguage[k] = { name: v.name, count: (byLanguage[k]?.count ?? 0) + v.count }
  }
  return {
    fileCount: base.fileCount + add.fileCount,
    dirCount: base.dirCount + add.dirCount,
    byExt,
    byLanguage,
    ignoredCount: base.ignoredCount + add.ignoredCount,
    skippedCount: base.skippedCount + add.skippedCount,
    // 目标目录自己从"没探"变成"探了",减回它那一份
    lazyCount: base.lazyCount + add.lazyCount - 1
  }
}

// 按路径契约在扫描树里找文件节点:关系卡跳转只认 relPath,不手拼任何路径
export function findFile(node: ScanTreeNode, relPath: string): ScanFileNode | null {
  if (node.type === 'file') return node.relPath === relPath ? node : null
  for (const child of node.children) {
    const hit = findFile(child, relPath)
    if (hit) return hit
  }
  return null
}

/** 收齐全树的 relPath,给聊天文件链接建索引用:AI 提到谁,就拿这份花名册查户口 */
export function collectRelPaths(node: ScanTreeNode): string[] {
  const out: string[] = []
  const walk = (n: ScanTreeNode): void => {
    if (n.type === 'file') {
      out.push(n.relPath)
      return
    }
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out
}

/** 按 relPath 找目录节点:功能定位指中文件夹时,跳转走这里 */
export function findDir(node: ScanTreeNode, relPath: string): ScanDirNode | null {
  if (node.type === 'directory') {
    if (node.relPath === relPath) return node
    for (const child of node.children) {
      const hit = findDir(child, relPath)
      if (hit) return hit
    }
  }
  return null
}

/** 面包屑分段:rootName + relPath 的每一层;最后一段由调用方自己标成当前 */
export function buildCrumbs(rootName: string, rootPath: string, relPath: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: rootName, title: rootPath }]
  const parts = relPath === '' ? [] : relPath.split('/')
  for (const part of parts) crumbs.push({ label: part, title: relPath })
  return crumbs
}

/** 从树根下钻到目标文件的父目录链(reveal 联动用):这些目录要在树里强制展开。
 *  中途撞到没扫描的目录就到那为止 —— 文件能被找到,链上目录必然都已扫实 */
export function dirChainOf(root: ScanDirNode, relPath: string): string[] {
  if (relPath === '') return []
  const chain: string[] = []
  let cur: ScanDirNode = root
  const parts = relPath.split('/')
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur.children.find((c) => c.type === 'directory' && c.name === parts[i])
    if (!next || next.type !== 'directory') return chain
    chain.push(next.relPath)
    cur = next
  }
  return chain
}
