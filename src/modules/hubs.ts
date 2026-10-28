// 公共文件(hub):被到处引用的文件(类型表、IPC 通道表、图标册)。它跟谁都近,参与社区发现会把各目录的文件
// 吸成一团、自己却被随手塞进某个小模块;所以先请出去,其余文件分好后再按它所在目录放回,当正式成员。
import type { DepEdge, ModuleParams } from '../shared/types.ts'
import { createHomeFinder, pickAnchor } from './moduleAssign.ts'
import { indexMembers, pickByVotes, tally } from './linkVotes.ts'
import { byCodeUnit, dirOf } from './pathOrder.ts'

type HubParams = Pick<ModuleParams, 'hubMinInDegree' | 'hubShare'>

/** 门槛按项目规模走:有入度文件数的 hubShare,但不低于 hubMinInDegree(小项目不至于人人都算公共文件) */
export function hubThreshold(filesWithInDegree: number, params: HubParams): number {
  return Math.max(params.hubMinInDegree, params.hubShare * filesWithInDegree)
}

/** 入度严格大于门槛的文件,按路径排序 */
export function findHubs(inDegree: Map<string, number>, params: HubParams): Set<string> {
  let withInDegree = 0
  for (const degree of inDegree.values()) if (degree > 0) withInDegree++
  const threshold = hubThreshold(withInDegree, params)
  const hubs = [...inDegree].filter(([, degree]) => degree > threshold).map(([file]) => file)
  return new Set(hubs.sort(byCodeUnit))
}

/**
 * 把公共文件放回社区(原地追加,组内重新排序):先按所在目录就近归属;目录里找不到模块时,
 * 跟引用它最多的模块走;都没有就单独成组。候选在放回前冻结,结果与放回顺序无关。
 */
export function insertHubs(
  groups: string[][],
  hubs: string[],
  edges: DepEdge[],
  inDegree: Map<string, number>
): string[][] {
  const candidates = groups.map((members) => ({
    key: pickAnchor(members, inDegree),
    members: [...members]
  }))
  const findHome = createHomeFinder(candidates)
  const home = indexMembers(candidates)
  const importers = new Map<string, [string, number][]>(hubs.map((h) => [h, []]))
  for (const { from, to } of edges) importers.get(to)?.push([from, 1])
  const alone: string[][] = []
  for (const hub of hubs) {
    let target = findHome(dirOf(hub))
    if (target < 0) target = pickByVotes(tally(importers.get(hub) ?? [], home), candidates)
    if (target < 0) alone.push([hub])
    else groups[target].push(hub)
  }
  return [...groups.map((g) => g.sort(byCodeUnit)), ...alone]
}
