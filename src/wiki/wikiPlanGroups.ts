// Wiki 规划的分组阶段:把代码文件分成一组组(跨目录社区、功能名成页、目录成页、大组再切)。
// 从 wikiPlan.ts 拆出,各自守单文件行数闸;分组口径见《Wiki生成改造-需求》定稿 A3。
import type { DepEdge, ModuleParams } from '../shared/types.ts'
import { detectCommunities } from '../modules/communities.ts'
import { byCodeUnit, dirOf } from '../modules/pathOrder.ts'
import { buildFeatureGroups, cohesionOf } from './wikiPlanFeatures.ts'
import { hubGroups, placeOrphans } from './wikiPlanHubs.ts'
import {
  PLAN_BYTES_PER_TOKEN,
  PLAN_CROSS_DIR_MAX_FILES,
  PLAN_CROSS_DIR_MIN_COHESION,
  PLAN_HUB_MIN_IN_DEGREE,
  PLAN_HUB_SHARE,
  PLAN_LEAF_MAX_PRIMARY,
  PLAN_LEAF_SOFT_MAX_FILES,
  PLAN_PAGE_EVIDENCE_TOKEN_CAP,
  PLAN_SPLIT_TOKEN_TARGET,
  type DraftGroup,
  type WikiPlanFileInput
} from './wikiPlanTypes.ts'

export type { DraftGroup } from './wikiPlanTypes.ts'

export function tokensOf(file: WikiPlanFileInput): number {
  return Math.ceil(file.sizeBytes / PLAN_BYTES_PER_TOKEN)
}

function planParams(folderAffinity: number, resolution: number): ModuleParams {
  return {
    resolution,
    seed: 42,
    folderAffinity,
    minFiles: 1,
    hubMinInDegree: PLAN_HUB_MIN_IN_DEGREE,
    hubShare: PLAN_HUB_SHARE
  }
}

/** 目录成页;过大的目录按引用社区细切,与本目录毫无引用的孤立单文件交回主流程就近归属 */
function splitDirGroup(
  dirFiles: WikiPlanFileInput[],
  edges: DepEdge[],
  inDegree: Map<string, number>
): { groups: DraftGroup[]; orphans: string[] } {
  const paths = dirFiles.map((f) => f.relPath)
  const totalTokens = dirFiles.reduce((sum, f) => sum + tokensOf(f), 0)
  if (paths.length <= PLAN_LEAF_SOFT_MAX_FILES && totalTokens <= PLAN_PAGE_EVIDENCE_TOKEN_CAP) {
    return {
      groups: [{ primary: paths, supporting: [], basis: ['目录成页'], crossDir: false }],
      orphans: []
    }
  }
  // 分辨率取 0.8:链式引用(文件串成一条线)不该被从中切断,断开的组靠无边自然分开
  const communities = detectCommunities(paths, edges, inDegree, planParams(0, 0.8))
  const inDir = new Set(paths)
  const linked = new Set<string>()
  for (const edge of edges) {
    if (inDir.has(edge.from) && inDir.has(edge.to)) {
      linked.add(edge.from)
      linked.add(edge.to)
    }
  }
  const groups: DraftGroup[] = []
  const orphans: string[] = []
  for (const members of communities) {
    if (members.length === 1 && !linked.has(members[0]!)) {
      orphans.push(members[0]!)
      continue
    }
    groups.push({
      primary: [...members].sort(byCodeUnit),
      supporting: [],
      basis: ['目录内按引用社区细切'],
      crossDir: false
    })
  }
  return { groups, orphans }
}

/**
 * 分组主流程:公共文件先请出去单独成页,其余文件走功能名成页、跨目录社区、目录成页,
 * 孤立单文件按引用就近归属,最后一轮过大再切。聚类只看去掉公共文件后的引用。
 */
export function buildDraftGroups(
  allEdges: DepEdge[],
  byPath: Map<string, WikiPlanFileInput>,
  inDegree: Map<string, number>,
  codeFiles: WikiPlanFileInput[],
  hubs: Set<string>
): DraftGroup[] {
  const edges = allEdges.filter((e) => !hubs.has(e.from) && !hubs.has(e.to))
  const claimed = new Set<string>(hubs)
  const restFiles = codeFiles.filter((f) => !hubs.has(f.relPath))

  // 第一步:功能名成页(见 wikiPlanFeatures.ts)
  const groups: DraftGroup[] = buildFeatureGroups(restFiles, edges, claimed)

  // 第二步:全仓社区里找强内聚的跨目录社区,许它打破目录边界成页(文件先到先得,按内聚度降序)
  // 这一遍专找跨目录社区:目录偏置关掉,只看引用本身,内聚度门槛负责把关
  const allCommunities = detectCommunities(
    restFiles.map((f) => f.relPath),
    edges,
    inDegree,
    planParams(0, 1.0)
  )
  const candidates = allCommunities
    .map((members) => ({ members, cohesion: cohesionOf(new Set(members), edges) }))
    .filter(
      (c) =>
        c.members.length >= 2 &&
        c.members.length <= PLAN_CROSS_DIR_MAX_FILES &&
        new Set(c.members.map((p) => dirOf(p))).size >= 2 &&
        c.cohesion >= PLAN_CROSS_DIR_MIN_COHESION
    )
    .sort((a, b) => b.cohesion - a.cohesion)
  for (const candidate of candidates) {
    if (candidate.members.some((p) => claimed.has(p))) continue
    for (const p of candidate.members) claimed.add(p)
    groups.push({
      primary: [...candidate.members].sort(byCodeUnit),
      supporting: [],
      basis: [`跨目录社区成页(内聚度 ${candidate.cohesion.toFixed(2)})`],
      crossDir: true
    })
  }

  // 第三步:其余代码文件按目录成页,目录内过大再按社区细切
  const byDir = new Map<string, WikiPlanFileInput[]>()
  for (const file of restFiles) {
    if (claimed.has(file.relPath)) continue
    const dir = dirOf(file.relPath)
    const list = byDir.get(dir)
    if (list) list.push(file)
    else byDir.set(dir, [file])
  }
  const orphans: string[] = []
  for (const dir of [...byDir.keys()].sort(byCodeUnit)) {
    const split = splitDirGroup(byDir.get(dir)!, edges, inDegree)
    groups.push(...split.groups)
    orphans.push(...split.orphans)
  }
  // 孤立单文件:不再一律塞进本目录最大的一组(那会堆出杂物页),按全仓引用投票就近归属
  placeOrphans(orphans, groups, edges)
  groups.push(...hubGroups(hubs))

  // 第四步:大组再切。社区与目录给出的组仍可能过大(主角数或证据量超线),
  // 对组内文件提高分辨率再跑一轮社区;功能组不再切,保持功能完整。
  const groupTokens = (group: DraftGroup): number =>
    group.primary.reduce((sum, p) => sum + tokensOf(byPath.get(p)!), 0)
  let finalGroups = groups
  for (let round = 0; round < 2; round++) {
    const next: DraftGroup[] = []
    let changed = false
    for (const group of finalGroups) {
      if (group.hub) {
        next.push(group)
        continue
      }
      // 功能组以保持功能完整为先,只在主角数超硬线时再切;普通组主角数与证据量任一超线都切
      const overPrimary = group.primary.length > PLAN_LEAF_MAX_PRIMARY
      const tooBig = group.feature
        ? overPrimary
        : overPrimary || groupTokens(group) > PLAN_SPLIT_TOKEN_TARGET
      if (!tooBig) {
        next.push(group)
        continue
      }
      const communities = detectCommunities(group.primary, edges, inDegree, planParams(0, 1.4))
      const maxSize = Math.max(...communities.map((c) => c.length))
      if (communities.length < 2 || maxSize >= group.primary.length) {
        next.push(group)
        continue
      }
      changed = true
      communities.forEach((members, index) => {
        next.push({
          primary: [...members].sort(byCodeUnit),
          supporting: index === 0 ? group.supporting : [],
          basis: [...group.basis, '过大再切'],
          crossDir: group.crossDir,
          feature: group.feature,
          topicKey: group.topicKey
        })
      })
    }
    finalGroups = next
    if (!changed) break
  }
  return finalGroups
}
