// 样式附挂:样式文件不参与社区发现,按 代码直接导入 → 类名使用 → 被别的样式 @import 的顺序找归属。
import type { StyleLink } from './cutModules.ts'
import type { HomeCandidate } from './moduleAssign.ts'
import { indexMembers, pickByVotes, tally } from './linkVotes.ts'
import { sortedUnique } from './pathOrder.ts'

interface StyleResolver {
  candidates: HomeCandidate[]
  home: Map<string, number>
  incoming: Map<string, StyleLink[]>
  memo: Map<string, number>
}

function ballotsOf(links: StyleLink[], kind: StyleLink['kind']): [string, number][] {
  return links.filter((l) => l.kind === kind).map((l) => [l.from, l.weight])
}

/** 一份样式的归属下标;-1 表示三条规则都没找到。visiting 拦 @import 成环 */
function resolveStyle(style: string, ctx: StyleResolver, visiting: Set<string>): number {
  const cached = ctx.memo.get(style)
  if (cached !== undefined) return cached
  if (visiting.has(style)) return -1
  visiting.add(style)
  const links = ctx.incoming.get(style) ?? []
  let found = pickByVotes(tally(ballotsOf(links, 'import'), ctx.home), ctx.candidates)
  if (found < 0) found = pickByVotes(tally(ballotsOf(links, 'usage'), ctx.home), ctx.candidates)
  if (found < 0) {
    const viaParents = new Map<number, number>()
    for (const link of links) {
      if (link.kind !== 'import' || ctx.home.has(link.from)) continue
      const parent = resolveStyle(link.from, ctx, visiting)
      if (parent >= 0) viaParents.set(parent, (viaParents.get(parent) ?? 0) + 1)
    }
    found = pickByVotes(viaParents, ctx.candidates)
  }
  visiting.delete(style)
  // 成环途中算出的 -1 不缓存:环里先到的那份可能还能经别的父样式找到归属
  if (found >= 0 || visiting.size === 0) ctx.memo.set(style, found)
  return found
}

/** 样式 relPath → 候选下标;找不到归属的样式不出现(交给目录就近归属) */
export function attachStyles(candidates: HomeCandidate[], links: StyleLink[]): Map<string, number> {
  const incoming = new Map<string, StyleLink[]>()
  for (const link of links) incoming.set(link.to, [...(incoming.get(link.to) ?? []), link])
  const ctx: StyleResolver = {
    candidates,
    home: indexMembers(candidates),
    incoming,
    memo: new Map()
  }
  const homes = new Map<string, number>()
  for (const style of sortedUnique(incoming.keys())) {
    if (ctx.home.has(style)) continue
    const found = resolveStyle(style, ctx, new Set())
    if (found >= 0) homes.set(style, found)
  }
  return homes
}
