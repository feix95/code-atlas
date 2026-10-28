// 按链接投票挑归属模块:附挂文件(样式、自测脚本)不参与社区发现,只跟着它关系最重的模块走。
import type { HomeCandidate } from './moduleAssign.ts'
import { byCodeUnit } from './pathOrder.ts'

/** 成员文件 → 候选下标 */
export function indexMembers(candidates: HomeCandidate[]): Map<string, number> {
  const home = new Map<string, number>()
  candidates.forEach((c, i) => {
    for (const file of c.members) home.set(file, i)
  })
  return home
}

/** 票数最高的候选下标,平票取 key 字典序小者;没有票返回 -1 */
export function pickByVotes(votes: Map<number, number>, candidates: HomeCandidate[]): number {
  let best = -1
  let bestScore = 0
  for (const i of [...votes.keys()].sort((x, y) =>
    byCodeUnit(candidates[x].key, candidates[y].key)
  )) {
    const score = votes.get(i) ?? 0
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}

/** 把 (投票文件, 权重) 累加到它所属候选的票数上;不属于任何候选的文件不投票 */
export function tally(
  ballots: Iterable<readonly [string, number]>,
  home: Map<string, number>
): Map<number, number> {
  const votes = new Map<number, number>()
  for (const [file, weight] of ballots) {
    const i = home.get(file)
    if (i !== undefined) votes.set(i, (votes.get(i) ?? 0) + weight)
  }
  return votes
}
