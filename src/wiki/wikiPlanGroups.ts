// Wiki 规划的分组阶段:把代码文件分成一组组(跨目录社区、功能名成页、目录成页、大组再切)。
// 从 wikiPlan.ts 拆出,各自守单文件行数闸;分组口径见《Wiki生成改造-需求》定稿 A3。
import type { ModuleParams } from '../shared/types.ts'
import { detectCommunities } from '../modules/communities.ts'
import { byCodeUnit, dirOf } from '../modules/pathOrder.ts'
import {
  PLAN_BYTES_PER_TOKEN,
  PLAN_CROSS_DIR_MAX_FILES,
  PLAN_CROSS_DIR_MIN_COHESION,
  PLAN_FEATURE_MAX_FILES,
  PLAN_FEATURE_MIN_COHESION,
  PLAN_FEATURE_MIN_FILES,
  PLAN_LEAF_MAX_PRIMARY,
  PLAN_LEAF_SOFT_MAX_FILES,
  PLAN_PAGE_EVIDENCE_TOKEN_CAP,
  PLAN_SPLIT_TOKEN_TARGET,
  type WikiPlanFileInput,
  type WikiPlanInput
} from './wikiPlanTypes.ts'

export function tokensOf(file: WikiPlanFileInput): number {
  return Math.ceil(file.sizeBytes / PLAN_BYTES_PER_TOKEN)
}

function planParams(folderAffinity: number, resolution: number): ModuleParams {
  return {
    resolution,
    seed: 42,
    folderAffinity,
    minFiles: 1,
    hubMinInDegree: 10,
    hubShare: 0.05
  }
}

export interface DraftGroup {
  primary: string[]
  supporting: string[]
  basis: string[]
  crossDir: boolean
  /** 功能名成页的标记词;有值表示整组属于同一功能 */
  feature?: string
  /** 功能主题键(如 feature:wiki):同功能拆出的多页靠它归到同一主题下 */
  topicKey?: string
}

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
function cohesionOf(members: Set<string>, edges: WikiPlanInput['edges']): number {
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

function splitDirGroup(
  dirFiles: WikiPlanFileInput[],
  input: WikiPlanInput,
  inDegree: Map<string, number>
): DraftGroup[] {
  const paths = dirFiles.map((f) => f.relPath)
  const totalTokens = dirFiles.reduce((sum, f) => sum + tokensOf(f), 0)
  if (paths.length <= PLAN_LEAF_SOFT_MAX_FILES && totalTokens <= PLAN_PAGE_EVIDENCE_TOKEN_CAP) {
    return [{ primary: paths, supporting: [], basis: ['目录成页'], crossDir: false }]
  }
  // 分辨率取 0.8:链式引用(文件串成一条线)不该被从中切断,断开的组靠无边自然分开
  const communities = detectCommunities(paths, input.edges, inDegree, planParams(0, 0.8))
  const groups: DraftGroup[] = communities.map((members) => ({
    primary: [...members].sort(byCodeUnit),
    supporting: [],
    basis: ['目录内按引用社区细切'],
    crossDir: false
  }))
  // 与本目录其他文件毫无引用的孤立单文件不自成一页,挂到最大的一组当配角
  const dirEdgePairs = new Set<string>()
  for (const edge of input.edges) {
    if (paths.includes(edge.from) && paths.includes(edge.to)) {
      dirEdgePairs.add(edge.from)
      dirEdgePairs.add(edge.to)
    }
  }
  const largest = groups.reduce((a, b) => (b.primary.length > a.primary.length ? b : a), groups[0]!)
  for (const group of groups) {
    if (group !== largest && group.primary.length === 1 && !dirEdgePairs.has(group.primary[0]!)) {
      largest.supporting.push(group.primary[0]!)
      group.primary = []
      group.basis = []
    }
  }
  return groups.filter((g) => g.primary.length > 0)
}

/** 分组主流程:跨目录社区、功能名成页、目录成页,最后一轮过大再切 */
export function buildDraftGroups(
  input: WikiPlanInput,
  byPath: Map<string, WikiPlanFileInput>,
  inDegree: Map<string, number>,
  codeFiles: WikiPlanFileInput[]
): DraftGroup[] {
  const groups: DraftGroup[] = []
  const claimed = new Set<string>()

  // 第一步:功能名成页。全仓社区在真实仓库里会被公共文件稀释、体积失控,单靠引用聚类
  // 切不出「功能散在多目录」的一页;文件名里的功能标记词是另一路信号,有引用支撑才认。
  const tokenFiles = new Map<string, string[]>()
  for (const file of codeFiles) {
    for (const token of new Set(nameTokens(file.relPath))) {
      const list = tokenFiles.get(token)
      if (list) list.push(file.relPath)
      else tokenFiles.set(token, [file.relPath])
    }
  }
  const featureCandidates = [...tokenFiles.entries()]
    .filter(
      ([, paths]) =>
        paths.length >= PLAN_FEATURE_MIN_FILES && paths.length <= PLAN_FEATURE_MAX_FILES
    )
    .sort((a, b) => b[1].length - a[1].length || byCodeUnit(a[0], b[0]))
  for (const [token, paths] of featureCandidates) {
    const free = paths.filter((p) => !claimed.has(p))
    if (free.length < PLAN_FEATURE_MIN_FILES || free.length !== paths.length) continue
    if (new Set(free.map((p) => dirOf(p))).size < 2) continue
    const memberSet = new Set(free)
    const linked = new Set<string>()
    for (const edge of input.edges) {
      if (memberSet.has(edge.from) && memberSet.has(edge.to)) {
        linked.add(edge.from)
        linked.add(edge.to)
      }
    }
    // 双门槛:内聚不能太低,组内互引的文件占比不能太低,防同名巧合把不相干文件凑成页
    if (cohesionOf(memberSet, input.edges) < PLAN_FEATURE_MIN_COHESION) continue
    if (linked.size < Math.ceil(free.length * 0.5)) continue
    for (const p of free) claimed.add(p)
    if (free.length <= PLAN_LEAF_MAX_PRIMARY) {
      groups.push({
        primary: [...free].sort(byCodeUnit),
        supporting: [],
        basis: [`按功能名跨目录成页(标记词 ${token})`],
        crossDir: true,
        feature: token,
        topicKey: `feature:${token}`
      })
    } else {
      // 大功能(如 Wiki 本身横跨三十个文件)不硬塞一页:按所在目录拆成同主题的几页
      const byDirInFeature = new Map<string, string[]>()
      for (const p of free) {
        const dir = dirOf(p)
        const list = byDirInFeature.get(dir)
        if (list) list.push(p)
        else byDirInFeature.set(dir, [p])
      }
      for (const dir of [...byDirInFeature.keys()].sort(byCodeUnit)) {
        groups.push({
          primary: [...byDirInFeature.get(dir)!].sort(byCodeUnit),
          supporting: [],
          basis: [`按功能名跨目录成页(标记词 ${token})`, `功能内按目录分片(${dir || '根'})`],
          crossDir: true,
          feature: token,
          topicKey: `feature:${token}`
        })
      }
    }
  }

  // 第二步:全仓社区里找强内聚的跨目录社区,许它打破目录边界成页(文件先到先得,按内聚度降序)
  // 这一遍专找跨目录社区:目录偏置关掉,只看引用本身,内聚度门槛负责把关
  const allCommunities = detectCommunities(
    codeFiles.map((f) => f.relPath),
    input.edges,
    inDegree,
    planParams(0, 1.0)
  )
  const candidates = allCommunities
    .map((members) => ({ members, cohesion: cohesionOf(new Set(members), input.edges) }))
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
  for (const file of codeFiles) {
    if (claimed.has(file.relPath)) continue
    const dir = dirOf(file.relPath)
    const list = byDir.get(dir)
    if (list) list.push(file)
    else byDir.set(dir, [file])
  }
  for (const dir of [...byDir.keys()].sort(byCodeUnit)) {
    groups.push(...splitDirGroup(byDir.get(dir)!, input, inDegree))
  }

  // 第四步:大组再切。社区与目录给出的组仍可能过大(主角数或证据量超线),
  // 对组内文件提高分辨率再跑一轮社区;功能组不再切,保持功能完整。
  const groupTokens = (group: DraftGroup): number =>
    group.primary.reduce((sum, p) => sum + tokensOf(byPath.get(p)!), 0)
  let finalGroups = groups
  for (let round = 0; round < 2; round++) {
    const next: DraftGroup[] = []
    let changed = false
    for (const group of finalGroups) {
      // 功能组以保持功能完整为先,只在主角数超硬线时再切;普通组主角数与证据量任一超线都切
      const overPrimary = group.primary.length > PLAN_LEAF_MAX_PRIMARY
      const tooBig = group.feature
        ? overPrimary
        : overPrimary || groupTokens(group) > PLAN_SPLIT_TOKEN_TARGET
      if (!tooBig) {
        next.push(group)
        continue
      }
      const communities = detectCommunities(
        group.primary,
        input.edges,
        inDegree,
        planParams(0, 1.4)
      )
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
