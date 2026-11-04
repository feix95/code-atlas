// Wiki 规划的功能名成页:文件名里的功能标记词配合真实引用,把散在多目录的同功能代码收成一页。
// 从 wikiPlanGroups.ts 拆出,各自守单文件行数闸。
import { byCodeUnit, dirOf } from '../modules/pathOrder.ts'
import type { DepEdge } from '../shared/types.ts'
import {
  PLAN_FEATURE_MAX_FILES,
  PLAN_FEATURE_MIN_COHESION,
  PLAN_FEATURE_MIN_FILES,
  PLAN_LEAF_MAX_PRIMARY,
  type DraftGroup,
  type WikiPlanFileInput
} from './wikiPlanTypes.ts'

/** 通用词不作功能标记:它们出现在太多文件名里,说明不了功能归属 */
const FEATURE_STOP_TOKENS = new Set([
  'index',
  'main',
  'app',
  'types',
  'type',
  'utils',
  'util',
  'helper',
  'helpers',
  'common',
  'base',
  'misc',
  'core',
  'shared',
  'components',
  'component',
  'hooks',
  'hook'
])

/** 文件名拆词:驼峰、连字符、下划线与点都算分隔,取小写词元 */
export function nameTokens(relPath: string): string[] {
  const base = relPath
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')
    .replace(/^(selftest)-/, '')
  const spaced = base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  return spaced
    .split(/[-_\s.]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3 && !FEATURE_STOP_TOKENS.has(token))
}

/** 社区内聚度:内部引用占全部相关引用的比例;没有外部引用时为 1 */
export function cohesionOf(members: Set<string>, edges: DepEdge[]): number {
  let internal = 0
  let boundary = 0
  for (const edge of edges) {
    const inFrom = members.has(edge.from)
    const inTo = members.has(edge.to)
    if (inFrom && inTo) internal += 1
    else if (inFrom || inTo) boundary += 1
  }
  return internal + boundary === 0 ? 0 : internal / (internal + boundary)
}

/**
 * 同名文件里真正连在一起的那一团:按组内引用求连通块,取最大的一块。
 * 同一个词常被不相干的文件共用(如各处的 menu),只有互相引用的才算同一个功能。
 */
function largestLinkedPart(paths: string[], edges: DepEdge[]): string[] {
  const members = new Set(paths)
  const neighbors = new Map<string, string[]>(paths.map((p) => [p, []]))
  for (const edge of edges) {
    if (!members.has(edge.from) || !members.has(edge.to) || edge.from === edge.to) continue
    neighbors.get(edge.from)!.push(edge.to)
    neighbors.get(edge.to)!.push(edge.from)
  }
  const seen = new Set<string>()
  let best: string[] = []
  for (const start of [...paths].sort(byCodeUnit)) {
    if (seen.has(start)) continue
    const part: string[] = []
    const queue = [start]
    seen.add(start)
    while (queue.length > 0) {
      const current = queue.shift()!
      part.push(current)
      for (const next of neighbors.get(current)!) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    if (part.length > best.length) best = part
  }
  return best.sort(byCodeUnit)
}

function featureGroupsOf(token: string, members: string[]): DraftGroup[] {
  const basis = `按功能名跨目录成页(标记词 ${token})`
  const base = { supporting: [], crossDir: true, feature: token, topicKey: `feature:${token}` }
  if (members.length <= PLAN_LEAF_MAX_PRIMARY) {
    return [{ ...base, primary: members, supporting: [], basis: [basis] }]
  }
  // 大功能(如 Wiki 本身横跨三十个文件)不硬塞一页:按所在目录拆成同主题的几页
  const byDir = new Map<string, string[]>()
  for (const path of members) {
    const list = byDir.get(dirOf(path))
    if (list) list.push(path)
    else byDir.set(dirOf(path), [path])
  }
  return [...byDir.keys()].sort(byCodeUnit).map((dir) => ({
    ...base,
    primary: byDir.get(dir)!,
    supporting: [],
    basis: [basis, `功能内按目录分片(${dir || '根'})`]
  }))
}

/**
 * 功能名成页。全仓社区会被公共文件稀释、体积失控,单靠引用聚类切不出「功能散在多目录」的一页;
 * 文件名里的功能标记词是另一路信号,只收同名文件里互相引用连成一团的部分,其余留给目录成页。
 */
export function buildFeatureGroups(
  codeFiles: WikiPlanFileInput[],
  edges: DepEdge[],
  claimed: Set<string>
): DraftGroup[] {
  const tokenFiles = new Map<string, string[]>()
  for (const file of codeFiles) {
    if (claimed.has(file.relPath)) continue
    for (const token of new Set(nameTokens(file.relPath))) {
      const list = tokenFiles.get(token)
      if (list) list.push(file.relPath)
      else tokenFiles.set(token, [file.relPath])
    }
  }
  const candidates = [...tokenFiles.entries()]
    .filter(([, paths]) => paths.length >= PLAN_FEATURE_MIN_FILES)
    .filter(([, paths]) => paths.length <= PLAN_FEATURE_MAX_FILES)
    .sort((a, b) => b[1].length - a[1].length || byCodeUnit(a[0], b[0]))
  const groups: DraftGroup[] = []
  for (const [token, paths] of candidates) {
    if (paths.some((p) => claimed.has(p))) continue
    const members = largestLinkedPart(paths, edges)
    if (members.length < PLAN_FEATURE_MIN_FILES) continue
    if (new Set(members.map((p) => dirOf(p))).size < 2) continue
    // 内聚不能太低:防同名巧合把不相干文件凑成页
    if (cohesionOf(new Set(members), edges) < PLAN_FEATURE_MIN_COHESION) continue
    for (const p of members) claimed.add(p)
    groups.push(...featureGroupsOf(token, members))
  }
  return groups
}
