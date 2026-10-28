// 公共文件(hub):被到处引用的文件(类型表、IPC 通道表、图标册)。它跟谁都近,参与社区发现会把各目录的文件
// 吸成一团、自己却被随手塞进某个小模块;所以先请出去,其余文件分好后再按它所在目录放回,当正式成员。
import type { DepEdge, ModuleParams } from '../shared/types.ts'
import { createHomeFinder, pickAnchor, type HomeCandidate } from './moduleAssign.ts'
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
 * 只被别的公共文件引用的公共文件:跟着引用它的公共文件的落点投票,一轮一轮往外传。
 * 每轮只用上一轮结束时的落点,结果与处理顺序无关。
 */
function followImportingHubs(
  pending: string[],
  placed: Map<string, number>,
  importers: Map<string, [string, number][]>,
  candidates: HomeCandidate[]
): void {
  let rest = pending
  while (rest.length > 0) {
    const round = new Map<string, number>()
    for (const hub of rest) {
      const target = pickByVotes(tally(importers.get(hub) ?? [], placed), candidates)
      if (target >= 0) round.set(hub, target)
    }
    if (round.size === 0) return
    for (const [hub, target] of round) placed.set(hub, target)
    rest = rest.filter((hub) => !round.has(hub))
  }
}

/** 仍找不到归属的公共文件:同目录(不含项目根)凑够 minFiles 个时合成一个模块,否则未归类 */
function groupLeftovers(leftovers: string[], minFiles: number): string[][] {
  const byDir = new Map<string, string[]>()
  for (const hub of leftovers) {
    if (dirOf(hub) === '') continue
    byDir.set(dirOf(hub), [...(byDir.get(dirOf(hub)) ?? []), hub])
  }
  return [...byDir.values()].filter((group) => group.length >= minFiles)
}

/**
 * 把公共文件放回社区(原地追加,组内重新排序):先按所在目录就近归属;目录里找不到模块时,
 * 跟引用它最多的模块走,只被别的公共文件引用时跟着那些公共文件走;都没有时同目录凑够数自成模块,
 * 凑不够就不放回(未归类),不产生 1 个文件的模块。候选在放回前冻结,结果与放回顺序无关。
 */
export function insertHubs(
  groups: string[][],
  hubs: string[],
  edges: DepEdge[],
  inDegree: Map<string, number>,
  minFiles: number
): string[][] {
  const candidates = groups.map((members) => ({
    key: pickAnchor(members, inDegree),
    members: [...members]
  }))
  const findHome = createHomeFinder(candidates)
  const home = indexMembers(candidates)
  const importers = new Map<string, [string, number][]>(hubs.map((h) => [h, []]))
  for (const { from, to } of edges) importers.get(to)?.push([from, 1])
  const placed = new Map(home)
  const pending: string[] = []
  for (const hub of hubs) {
    let target = findHome(dirOf(hub))
    if (target < 0) target = pickByVotes(tally(importers.get(hub) ?? [], home), candidates)
    if (target < 0) pending.push(hub)
    else placed.set(hub, target)
  }
  followImportingHubs(pending, placed, importers, candidates)
  const formed = groupLeftovers(
    pending.filter((hub) => !placed.has(hub)),
    minFiles
  )
  for (const group of formed) {
    candidates.push({ key: pickAnchor(group, inDegree), members: group })
    for (const hub of group) placed.set(hub, candidates.length - 1)
  }
  followImportingHubs(
    pending.filter((hub) => !placed.has(hub)),
    placed,
    importers,
    candidates
  )
  const out = [...groups, ...formed.map((): string[] => [])]
  for (const hub of hubs) {
    const target = placed.get(hub)
    if (target !== undefined) out[target].push(hub)
  }
  return out.map((g) => g.sort(byCodeUnit))
}
