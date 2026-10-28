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

/** 一份样式的查找结果:home 为候选下标(-1 为没找到);hitCycle 表示查找途中撞上了 @import 环 */
interface StyleLookup {
  home: number
  hitCycle: boolean
}

/** 跟着 @import 它的父样式投票;父样式各自递归找归属 */
function resolveViaParents(
  links: StyleLink[],
  ctx: StyleResolver,
  visiting: Set<string>
): StyleLookup {
  const viaParents = new Map<number, number>()
  let hitCycle = false
  for (const link of links) {
    if (link.kind !== 'import' || ctx.home.has(link.from)) continue
    const parent = resolveStyle(link.from, ctx, visiting)
    hitCycle ||= parent.hitCycle
    if (parent.home >= 0) viaParents.set(parent.home, (viaParents.get(parent.home) ?? 0) + 1)
  }
  return { home: pickByVotes(viaParents, ctx.candidates), hitCycle }
}

/** 一份样式的归属;visiting 拦 @import 成环 */
function resolveStyle(style: string, ctx: StyleResolver, visiting: Set<string>): StyleLookup {
  const cached = ctx.memo.get(style)
  if (cached !== undefined) return { home: cached, hitCycle: false }
  if (visiting.has(style)) return { home: -1, hitCycle: true }
  visiting.add(style)
  const links = ctx.incoming.get(style) ?? []
  let found: StyleLookup = {
    home: pickByVotes(tally(ballotsOf(links, 'import'), ctx.home), ctx.candidates),
    hitCycle: false
  }
  if (found.home < 0) {
    found.home = pickByVotes(tally(ballotsOf(links, 'usage'), ctx.home), ctx.candidates)
  }
  if (found.home < 0) found = resolveViaParents(links, ctx, visiting)
  visiting.delete(style)
  // 撞上环得出的 -1 不缓存:环里先到的那份可能还能经别的父样式找到归属。
  // 没撞环的 -1 是定论,必须缓存,否则菱形 @import 链每多一层重走次数就翻一倍
  if (found.home >= 0 || !found.hitCycle) ctx.memo.set(style, found.home)
  return found
}

/** 样式 relPath → 候选下标;找不到归属的样式不出现(交给目录就近归属) */
export function attachStyles(candidates: HomeCandidate[], links: StyleLink[]): Map<string, number> {
  const incoming = new Map<string, StyleLink[]>()
  for (const link of links) {
    const list = incoming.get(link.to)
    if (list) list.push(link)
    else incoming.set(link.to, [link])
  }
  const ctx: StyleResolver = {
    candidates,
    home: indexMembers(candidates),
    incoming,
    memo: new Map()
  }
  const homes = new Map<string, number>()
  for (const style of sortedUnique(incoming.keys())) {
    if (ctx.home.has(style)) continue
    const found = resolveStyle(style, ctx, new Set()).home
    if (found >= 0) homes.set(style, found)
  }
  return homes
}
