// 自测附挂:自测文件不参与社区发现,按它导入的被测文件投票,挂到导入最多的模块。
import type { DepEdge } from '../shared/types.ts'
import type { HomeCandidate } from './moduleAssign.ts'
import { MODULE_TEST_CODE_EXT, MODULE_TEST_FILE_PATTERNS } from './moduleConfig.ts'
import { indexMembers, pickByVotes, tally } from './linkVotes.ts'

export function isTestFile(relPath: string): boolean {
  return (
    MODULE_TEST_CODE_EXT.test(relPath) &&
    MODULE_TEST_FILE_PATTERNS.some((pattern) => pattern.test(relPath))
  )
}

/**
 * 自测 relPath → 候选下标。edges 为已排序去重的项目内导入边;
 * 只有指向社区成员的导入算票(导入别的自测或无导入文件不算)。没有票的自测不出现。
 */
export function attachTests(
  tests: string[],
  candidates: HomeCandidate[],
  edges: DepEdge[]
): Map<string, number> {
  const home = indexMembers(candidates)
  const importsByTest = new Map<string, [string, number][]>(tests.map((t) => [t, []]))
  for (const { from, to } of edges) importsByTest.get(from)?.push([to, 1])
  const homes = new Map<string, number>()
  for (const test of tests) {
    const ballots = importsByTest.get(test) ?? []
    const found = pickByVotes(tally(ballots, home), candidates)
    if (found >= 0) homes.set(test, found)
  }
  return homes
}
