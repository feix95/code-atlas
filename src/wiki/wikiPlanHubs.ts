// Wiki 规划的公共文件(hub)与孤立文件处理:从分组主流程拆出,各自守单文件行数闸。
// 公共文件跟谁都近,留在聚类里会把各目录吸成一团、又被随手塞进某个杂物页;
// 所以先请出去按目录单独成页,其余文件分好后,孤立单文件按引用投票就近归属。
import { findHubs } from '../modules/hubs.ts'
import { byCodeUnit, dirOf } from '../modules/pathOrder.ts'
import type { DepEdge } from '../shared/types.ts'
import {
  PLAN_HUB_MIN_IN_DEGREE,
  PLAN_HUB_SHARE,
  type DraftGroup,
  type WikiPlanFileInput
} from './wikiPlanTypes.ts'

/** 进程间通道定义文件:只认通道定义本身(如 ipcChannels.ts),不认各通道的处理器文件 */
export const IPC_DEFINITION_PATTERN = /(^|\/)[^/]*channels?\.ts$/i

/** 公共文件:代码文件里入度超过门槛的,加上通道定义文件(它天然被各端共用) */
export function findPlanHubs(codeFiles: WikiPlanFileInput[]): Set<string> {
  const inDegree = new Map(codeFiles.map((f) => [f.relPath, f.inCount]))
  const hubs = findHubs(inDegree, {
    hubMinInDegree: PLAN_HUB_MIN_IN_DEGREE,
    hubShare: PLAN_HUB_SHARE
  })
  for (const file of codeFiles) {
    if (IPC_DEFINITION_PATTERN.test(file.relPath)) hubs.add(file.relPath)
  }
  return hubs
}

/** 公共文件按所在目录各成一页:它们讲的是全仓共用的定义,不属于任何一个功能 */
export function hubGroups(hubs: Set<string>): DraftGroup[] {
  const byDir = new Map<string, string[]>()
  for (const path of [...hubs].sort(byCodeUnit)) {
    const dir = dirOf(path)
    const list = byDir.get(dir)
    if (list) list.push(path)
    else byDir.set(dir, [path])
  }
  return [...byDir.keys()].sort(byCodeUnit).map((dir) => ({
    primary: byDir.get(dir)!,
    supporting: [],
    basis: ['公共文件按目录成页(被到处引用,不参与聚类)'],
    crossDir: false,
    hub: true
  }))
}

/**
 * 孤立单文件就近归属:按与各组成员的引用条数投票,票最多的组收它当配角;
 * 一票都没有的不硬塞(硬塞曾把整个目录的散文件堆成一张杂物页),自成一页。
 */
export function placeOrphans(orphans: string[], groups: DraftGroup[], edges: DepEdge[]): void {
  const groupOf = new Map<string, DraftGroup>()
  for (const group of groups) {
    for (const path of [...group.primary, ...group.supporting]) groupOf.set(path, group)
  }
  for (const orphan of [...orphans].sort(byCodeUnit)) {
    const votes = new Map<DraftGroup, number>()
    for (const edge of edges) {
      const other = edge.from === orphan ? edge.to : edge.to === orphan ? edge.from : null
      const group = other === null ? undefined : groupOf.get(other)
      if (group) votes.set(group, (votes.get(group) ?? 0) + 1)
    }
    const best = [...votes.entries()].sort(
      (a, b) => b[1] - a[1] || byCodeUnit(a[0].primary[0]!, b[0].primary[0]!)
    )[0]?.[0]
    if (best) {
      best.supporting.push(orphan)
      groupOf.set(orphan, best)
      continue
    }
    const own: DraftGroup = {
      primary: [orphan],
      supporting: [],
      basis: ['孤立文件独立成页(与各组都没有引用)'],
      crossDir: false
    }
    groups.push(own)
    groupOf.set(orphan, own)
  }
}
