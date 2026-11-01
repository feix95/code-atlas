// 跨次匹配(模块层):重新切分后,按成员 Jaccard 相似度给新模块沿用上次落盘的 id,
// 避免锚点变化让 AI 说明全部失效。纯函数;只在已有落盘记录时调用。
import type { ModuleMap } from '../shared/types.ts'
import { MODULE_MATCH_JACCARD } from './moduleConfig.ts'
import { byCodeUnit } from './pathOrder.ts'

/** 上次落盘的模块:只认 id 与成员清单,说明、标签等由 P3 另存 */
export interface PreviousModule {
  id: string
  files: readonly string[]
}

interface Candidate {
  nextIndex: number
  previousId: string
  score: number
}

function jaccard(next: ReadonlySet<string>, previous: ReadonlySet<string>): number {
  if (next.size === 0 || previous.size === 0) return 0
  let shared = 0
  for (const file of next) if (previous.has(file)) shared += 1
  return shared / (next.size + previous.size - shared)
}

function remapMap(map: ModuleMap, rename: ReadonlyMap<number, string>): ModuleMap {
  const matched = new Set(rename.keys())
  const usedIds = new Set(map.modules.filter((_, index) => !matched.has(index)).map((m) => m.id))
  const applied = new Map<number, string>()
  for (const [index, id] of rename) {
    // 与未匹配模块的新 id 撞名时放弃沿用,宁可说明重写也不出现两个同 id 模块
    if (usedIds.has(id)) continue
    usedIds.add(id)
    applied.set(index, id)
  }
  if (applied.size === 0) return map

  const modules = map.modules
    .map((module, index) => {
      const id = applied.get(index)
      return id === undefined || id === module.id ? module : { ...module, id }
    })
    .sort((a, b) => b.files.length - a.files.length || byCodeUnit(a.id, b.id))
  const fileToModule: Record<string, string> = Object.fromEntries(
    modules
      .flatMap((m) => m.files.map((file) => [file, m.id] as const))
      .sort((a, b) => byCodeUnit(a[0], b[0]))
  )
  const idOfOld = new Map(
    map.modules.map((module, index) => [module.id, applied.get(index) ?? module.id])
  )
  const links = map.links.map((link) => ({
    ...link,
    from: idOfOld.get(link.from) ?? link.from,
    to: idOfOld.get(link.to) ?? link.to
  }))
  return { ...map, modules, fileToModule, links }
}

export function matchModuleIds(
  next: ModuleMap,
  previous: readonly PreviousModule[],
  threshold: number = MODULE_MATCH_JACCARD
): ModuleMap {
  const previousById = new Map<string, ReadonlySet<string>>()
  for (const module of previous) {
    if (module.files.length === 0 || previousById.has(module.id)) continue
    previousById.set(module.id, new Set(module.files))
  }
  if (previousById.size === 0) return next

  const candidates: Candidate[] = []
  next.modules.forEach((module, nextIndex) => {
    const files = new Set(module.files)
    for (const [previousId, previousFiles] of previousById) {
      const score = jaccard(files, previousFiles)
      if (score >= threshold) candidates.push({ nextIndex, previousId, score })
    }
  })
  candidates.sort(
    (a, b) =>
      b.score - a.score || a.nextIndex - b.nextIndex || byCodeUnit(a.previousId, b.previousId)
  )
  const usedNext = new Set<number>()
  const usedPrevious = new Set<string>()
  const rename = new Map<number, string>()
  for (const candidate of candidates) {
    if (usedNext.has(candidate.nextIndex) || usedPrevious.has(candidate.previousId)) continue
    usedNext.add(candidate.nextIndex)
    usedPrevious.add(candidate.previousId)
    rename.set(candidate.nextIndex, candidate.previousId)
  }
  return remapMap(next, rename)
}
