// 样式附挂:样式文件不参与社区发现,按 代码直接导入 → 类名使用 → 被别的样式 @import 的顺序找归属。
// 「跟着父样式走」沿 @import 图传递;图里可能成环,所以先把强连通分量缩成点(Tarjan),
// 再按拓扑序一次算完:每份样式只算一次,线性时间,结果与遍历顺序无关。
import type { StyleLink } from './cutModules.ts'
import type { HomeCandidate } from './moduleAssign.ts'
import { indexMembers, pickByVotes, tally } from './linkVotes.ts'
import { byCodeUnit, sortedUnique } from './pathOrder.ts'

/** 样式 @import 图:只含不是模块成员的样式;parents 为 @import 了它的样式(按路径排序) */
interface StyleGraph {
  styles: string[]
  parents: Map<string, string[]>
  /** 自身线索(被成员直接导入,其次类名使用)定下的归属;-1 为没有 */
  own: Map<string, number>
}

function ballotsOf(links: StyleLink[], kind: StyleLink['kind']): [string, number][] {
  return links.filter((l) => l.kind === kind).map((l) => [l.from, l.weight])
}

function buildStyleGraph(candidates: HomeCandidate[], links: StyleLink[]): StyleGraph {
  const home = indexMembers(candidates)
  const incoming = new Map<string, StyleLink[]>()
  for (const link of links) {
    if (home.has(link.to)) continue
    const list = incoming.get(link.to)
    if (list) list.push(link)
    else incoming.set(link.to, [link])
  }
  const parentOf = (l: StyleLink): boolean => l.kind === 'import' && !home.has(l.from)
  const styles = sortedUnique([
    ...incoming.keys(),
    ...links.filter((l) => parentOf(l) && !home.has(l.to)).map((l) => l.from)
  ])
  const parents = new Map<string, string[]>()
  const own = new Map<string, number>()
  for (const style of styles) {
    const list = incoming.get(style) ?? []
    parents.set(
      style,
      list.filter(parentOf).map((l) => l.from)
    )
    let found = pickByVotes(tally(ballotsOf(list, 'import'), home), candidates)
    if (found < 0) found = pickByVotes(tally(ballotsOf(list, 'usage'), home), candidates)
    own.set(style, found)
  }
  return { styles, parents, own }
}

/**
 * Tarjan 强连通分量(迭代写法,不怕深链爆栈);沿「样式 → 父样式」走,
 * 产出顺序即父样式所在分量在前,正好是逐个定归属的顺序。
 */
function stronglyConnected(graph: StyleGraph): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const out: string[][] = []
  let counter = 0
  const enter = (v: string): void => {
    index.set(v, counter)
    low.set(v, counter++)
    stack.push(v)
    onStack.add(v)
  }
  for (const root of graph.styles) {
    if (index.has(root)) continue
    enter(root)
    const frames: [string, number][] = [[root, 0]]
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      const [v, next] = frame
      const parents = graph.parents.get(v) ?? []
      if (next < parents.length) {
        frame[1]++
        const w = parents[next]
        if (!index.has(w)) {
          enter(w)
          frames.push([w, 0])
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0))
        continue
      }
      frames.pop()
      const caller = frames[frames.length - 1]
      if (caller) low.set(caller[0], Math.min(low.get(caller[0]) ?? 0, low.get(v) ?? 0))
      if (low.get(v) !== index.get(v)) continue
      const component: string[] = []
      for (let w = stack.pop(); w !== undefined; w = w === v ? undefined : stack.pop()) {
        onStack.delete(w)
        component.push(w)
      }
      out.push(component)
    }
  }
  return out
}

/**
 * 一个分量里自身线索定不下的样式,共同跟票:分量外已定的父样式、分量内有自身归属的父样式,
 * 每条 @import 一票。单份样式(无环)时就是「跟着父样式投票」。
 */
function resolveComponent(
  component: string[],
  graph: StyleGraph,
  homes: Map<string, number>,
  candidates: HomeCandidate[]
): void {
  const inside = new Set(component)
  const votes = new Map<number, number>()
  const pending: string[] = []
  for (const style of component) {
    const own = graph.own.get(style) ?? -1
    if (own >= 0) homes.set(style, own)
    else pending.push(style)
  }
  for (const style of pending) {
    for (const parent of graph.parents.get(style) ?? []) {
      const vote = inside.has(parent) ? (graph.own.get(parent) ?? -1) : (homes.get(parent) ?? -1)
      if (vote >= 0) votes.set(vote, (votes.get(vote) ?? 0) + 1)
    }
  }
  const shared = pickByVotes(votes, candidates)
  for (const style of pending) homes.set(style, shared)
}

/** 样式 relPath → 候选下标;找不到归属的样式不出现(交给目录就近归属) */
export function attachStyles(candidates: HomeCandidate[], links: StyleLink[]): Map<string, number> {
  const graph = buildStyleGraph(candidates, links)
  const homes = new Map<string, number>()
  for (const component of stronglyConnected(graph)) {
    resolveComponent(component, graph, homes, candidates)
  }
  return new Map([...homes].filter(([, home]) => home >= 0).sort(([a], [b]) => byCodeUnit(a, b)))
}
