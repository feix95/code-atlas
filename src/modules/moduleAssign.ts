// 社区 → 模块的归属规则:选锚点、小社区并入就近模块、无导入文件按目录就近归属。
import { byCodeUnit, dirOf } from './pathOrder.ts'

/** 归属候选:key 用于平票(取字典序小者),members 为它的可分析成员 */
export interface HomeCandidate {
  key: string
  members: string[]
}

/** 锚点:入度最高的成员,平票取 relPath 字典序最小者 */
export function pickAnchor(members: string[], inDegree: Map<string, number>): string {
  let best = members[0]
  for (const file of members) {
    const diff = (inDegree.get(file) ?? 0) - (inDegree.get(best) ?? 0)
    if (diff > 0 || (diff === 0 && file < best)) best = file
  }
  return best
}

/** 目录 → (候选下标 → 该目录下的直接成员数) */
function indexByDir(candidates: HomeCandidate[]): Map<string, Map<number, number>> {
  const index = new Map<string, Map<number, number>>()
  candidates.forEach((candidate, i) => {
    for (const file of candidate.members) {
      const dir = dirOf(file)
      const counts = index.get(dir) ?? new Map<number, number>()
      counts.set(i, (counts.get(i) ?? 0) + 1)
      index.set(dir, counts)
    }
  })
  return index
}

/**
 * 生成「就近归属」查找函数:从起始目录向上,找该目录直接成员最多的候选;平票取 key 字典序小者。
 * 不进入项目根:根目录下的文件彼此多半无关,不能凭同在根下就归到一起。找不到返回 -1。
 * 候选成员在创建时冻结,查找结果与查找顺序无关。
 */
export function createHomeFinder(candidates: HomeCandidate[]): (startDir: string) => number {
  const index = indexByDir(candidates)
  return (startDir) => {
    for (let dir = startDir; dir !== ''; dir = dirOf(dir)) {
      let best = -1
      let bestCount = 0
      for (const [i, count] of index.get(dir) ?? []) {
        const wins =
          count > bestCount || (count === bestCount && candidates[i].key < candidates[best].key)
        if (wins) {
          best = i
          bestCount = count
        }
      }
      if (best >= 0) return best
    }
    return -1
  }
}

/**
 * 成员数低于 minFiles 的社区,按其锚点所在目录并入就近的大社区;找不到就单独成模块。
 * 只并入大社区(不在小社区之间互并),结果与处理顺序无关。
 */
export function mergeSmallCommunities(
  communities: string[][],
  inDegree: Map<string, number>,
  minFiles: number
): string[][] {
  const large = communities.filter((c) => c.length >= minFiles).map((c) => [...c])
  const small = communities.filter((c) => c.length < minFiles)
  const findHome = createHomeFinder(
    large.map((members) => ({ key: pickAnchor(members, inDegree), members: [...members] }))
  )
  const alone: string[][] = []
  for (const group of small) {
    const home = findHome(dirOf(pickAnchor(group, inDegree)))
    if (home < 0) alone.push([...group])
    else large[home].push(...group)
  }
  return [...large, ...alone].map((c) => c.sort(byCodeUnit))
}
