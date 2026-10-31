// 展开集合与可见图之间的纯逻辑:候选挑选、加入展开、级联收起、lazy 目录先扫描。
// 原地展开不再按可见图上限拒绝;额度分配在 visibleGraph 内完成,这里只维护集合。
import type { ScanDirNode } from './types.ts'
import type { GroupTree } from './hierarchy.ts'
import type { VisibleNode } from './visibleGraph.ts'

export type ExpandOutcome =
  { kind: 'expanded'; ids: ReadonlySet<string> } | { kind: 'ignored' } | { kind: 'scanFailed' }

/** 单个文件夹展开:合法文件夹一律加入;文件、不存在与已展开的返回 ignored */
export function tryExpand(
  tree: GroupTree,
  expanded: ReadonlySet<string>,
  id: string
): ExpandOutcome {
  if (expanded.has(id) || !tree.has(id) || tree.kindOf(id) !== 'folder') return { kind: 'ignored' }
  return { kind: 'expanded', ids: new Set(expanded).add(id) }
}

/** 批量展开:合法文件夹全部加入,整页统一粒度,不做逐个上限试算 */
export function expandIds(
  tree: GroupTree,
  expanded: ReadonlySet<string>,
  ids: readonly string[]
): ReadonlySet<string> {
  let next = expanded
  for (const id of ids) {
    const outcome = tryExpand(tree, next, id)
    if (outcome.kind === 'expanded') next = outcome.ids
  }
  return next
}

/** lazy 目录先扫描再展开;扫描失败不展开。扫描成功时树的新数据要等下一次渲染才到 */
export async function expandFolder(
  tree: GroupTree,
  expanded: ReadonlySet<string>,
  id: string,
  expandLazy: (relPath: string) => Promise<ScanDirNode | null>
): Promise<ExpandOutcome> {
  if (expanded.has(id) || !tree.has(id) || tree.kindOf(id) !== 'folder') return { kind: 'ignored' }
  if (tree.isLazy(id)) {
    const scanned = await expandLazy(id)
    if (!scanned) return { kind: 'scanFailed' }
  }
  return tryExpand(tree, expanded, id)
}

/** 收起某文件夹时连带收掉它内部的所有展开,重新展开不会突然冒出深层容器 */
export function collapseSubtree(
  tree: GroupTree,
  expanded: ReadonlySet<string>,
  id: string
): ReadonlySet<string> {
  const next = new Set<string>()
  for (const candidate of expanded) {
    let current: string | null = candidate
    let inside = false
    while (current !== null) {
      if (current === id) {
        inside = true
        break
      }
      current = tree.parentOf(current)
    }
    if (!inside) next.add(candidate)
  }
  return next
}

/** 「展开两级」的本轮候选:可见、未展开、浅于自动展开深度的文件夹;未扫描的跳过 */
export function expandCandidates(
  nodes: readonly VisibleNode[],
  expanded: ReadonlySet<string>,
  maxDepth: number
): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (node.kind !== 'folder' || node.isContainer || node.lazy) continue
    if (node.depth >= maxDepth || expanded.has(node.id)) continue
    ids.push(node.id)
  }
  return ids
}
