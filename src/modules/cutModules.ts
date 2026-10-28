// 模块切分(模块层):导入图 → 社区发现 → 小社区合并 → 选锚点定 id → 无导入文件就近归属 → 模块间边。
// 纯函数:不读文件、不调用 AI;同一输入无论顺序如何,永远得到同一结果。
import type { DepEdge, ModuleInfo, ModuleLink, ModuleMap, ModuleParams } from '../shared/types.ts'
import { detectCommunities } from './communities.ts'
import { DEFAULT_MODULE_PARAMS, MODULE_ALGORITHM_VERSION } from './moduleConfig.ts'
import { createHomeFinder, mergeSmallCommunities, pickAnchor } from './moduleAssign.ts'
import { byCodeUnit, dirOf, sortedUnique } from './pathOrder.ts'

export const MODULE_ID_PREFIX = 'm:'

export interface ModuleCutInput {
  /** 扫描到的全部文件 relPath(含图片、样式等不可分析文件) */
  files: string[]
  /** 可分析文件 relPath(DepGraphResult.nodes) */
  analyzable: string[]
  edges: DepEdge[]
}

interface ModuleDraft {
  id: string
  anchor: string
  members: string[]
  attached: string[]
}

/** 只留两端都是可分析文件的非自引用边,去重并排序 */
function projectEdges(edges: DepEdge[], analyzable: Set<string>): DepEdge[] {
  const seen = new Map<string, DepEdge>()
  for (const { from, to } of edges) {
    if (from === to || !analyzable.has(from) || !analyzable.has(to)) continue
    seen.set(JSON.stringify([from, to]), { from, to })
  }
  return [...seen.values()].sort((a, b) => byCodeUnit(a.from, b.from) || byCodeUnit(a.to, b.to))
}

function countInDegree(edges: DepEdge[]): Map<string, number> {
  const inDegree = new Map<string, number>()
  for (const { to } of edges) inDegree.set(to, (inDegree.get(to) ?? 0) + 1)
  return inDegree
}

function toModuleInfo(draft: ModuleDraft): ModuleInfo {
  const files = sortedUnique([...draft.members, ...draft.attached])
  return {
    id: draft.id,
    anchor: draft.anchor,
    files,
    attached: sortedUnique(draft.attached),
    folders: sortedUnique(files.map(dirOf))
  }
}

/** 模块间边:成员间导入边按模块聚合,权重为原始引用条数 */
function aggregateLinks(edges: DepEdge[], fileToModule: Record<string, string>): ModuleLink[] {
  const links = new Map<string, ModuleLink>()
  for (const { from, to } of edges) {
    const a = fileToModule[from]
    const b = fileToModule[to]
    if (a === undefined || b === undefined || a === b) continue
    const key = JSON.stringify([a, b])
    const link = links.get(key) ?? { from: a, to: b, weight: 0 }
    link.weight += 1
    links.set(key, link)
  }
  return [...links.values()].sort((x, y) => byCodeUnit(x.from, y.from) || byCodeUnit(x.to, y.to))
}

/** 无导入关系的文件(不可分析文件与孤立的可分析文件)按所在目录就近归入模块;找不到即未归类 */
function attachLooseFiles(drafts: ModuleDraft[], loose: string[]): void {
  const findHome = createHomeFinder(drafts.map((d) => ({ key: d.id, members: d.members })))
  for (const file of loose) {
    const home = findHome(dirOf(file))
    if (home >= 0) drafts[home].attached.push(file)
  }
}

export function cutModules(
  input: ModuleCutInput,
  params: ModuleParams = DEFAULT_MODULE_PARAMS
): ModuleMap {
  const edges = projectEdges(input.edges, new Set(input.analyzable))
  const inDegree = countInDegree(edges)
  const connected = new Set(edges.flatMap((e) => [e.from, e.to]))
  const communities = detectCommunities(sortedUnique(connected), edges, params)
  const drafts = mergeSmallCommunities(communities, inDegree, params.minFiles).map((members) => {
    const anchor = pickAnchor(members, inDegree)
    return { id: MODULE_ID_PREFIX + anchor, anchor, members, attached: [] }
  })
  const loose = sortedUnique([...input.files, ...input.analyzable]).filter((f) => !connected.has(f))
  attachLooseFiles(drafts, loose)
  const modules = drafts
    .map(toModuleInfo)
    .sort((a, b) => b.files.length - a.files.length || byCodeUnit(a.id, b.id))
  // 键按路径排序插入,序列化结果与输入顺序无关
  const fileToModule: Record<string, string> = Object.fromEntries(
    modules
      .flatMap((m) => m.files.map((file) => [file, m.id] as const))
      .sort((x, y) => byCodeUnit(x[0], y[0]))
  )
  return {
    algorithmVersion: MODULE_ALGORITHM_VERSION,
    params: { ...params },
    modules,
    fileToModule,
    links: aggregateLinks(edges, fileToModule)
  }
}
