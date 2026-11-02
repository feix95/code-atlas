// Wiki 页面规划:把全仓文件切成一棵主题树(A 组需求)。
// 信号按可信度用:目录结构定外层边界,目录内用引用社区细切,强内聚的跨目录社区许打破目录边界;
// 文件归属唯一,P2 模块只作参考不直接当页面。只切分不写字,切分结果单独评审后才进生成阶段。
import type { ModuleParams } from '../shared/types.ts'
import { detectCommunities } from '../modules/communities.ts'
import { byCodeUnit, dirOf } from '../modules/pathOrder.ts'
import {
  PLAN_BYTES_PER_TOKEN,
  PLAN_CROSS_DIR_MAX_FILES,
  PLAN_CROSS_DIR_MIN_COHESION,
  PLAN_LEAF_SOFT_MAX_FILES,
  PLAN_PAGE_EVIDENCE_TOKEN_CAP,
  WIKI_PLAN_VERSION,
  classifyPlanFile,
  type WikiMemberRole,
  type WikiPlan,
  type WikiPlanFileInput,
  type WikiPlanInput,
  type WikiPlanPage
} from './wikiPlanTypes.ts'
import { assembleTopics, buildRootPages, shortHash } from './wikiPlanTree.ts'

function tokensOf(file: WikiPlanFileInput): number {
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

interface DraftGroup {
  primary: string[]
  supporting: string[]
  basis: string[]
  crossDir: boolean
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

export function buildWikiPlan(input: WikiPlanInput): WikiPlan {
  const files = [...input.files].sort((a, b) => byCodeUnit(a.relPath, b.relPath))
  const byPath = new Map(files.map((f) => [f.relPath, f]))
  const inDegree = new Map(files.map((f) => [f.relPath, f.inCount]))
  const kinds = new Map(files.map((f) => [f.relPath, classifyPlanFile(f.relPath)]))
  // 隐藏目录(.git、.husky 等)是工具内部文件,不进规划
  const isHidden = (relPath: string): boolean =>
    relPath.split('/').some((seg) => seg.startsWith('.'))
  const codeFiles = files.filter((f) => kinds.get(f.relPath) === 'code' && !isHidden(f.relPath))

  const groups: DraftGroup[] = []
  const claimed = new Set<string>()

  // 第一步:全仓社区里找强内聚的跨目录社区,许它打破目录边界成页(文件先到先得,按内聚度降序)
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

  // 第二步:其余代码文件按目录成页,目录内过大再按社区细切
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

  // 第三步:每组定锚点、程序名与稳定标识,生成叶子页
  const pages: WikiPlanPage[] = []
  const ownerOf = new Map<string, WikiPlanPage>()
  // 同一目录有多页时,页名改用各自锚点文件名,避免一排同名页
  const anchorDirOfGroup = (group: DraftGroup): string => {
    const anchorPath = [...group.primary].sort(
      (a, b) => (byPath.get(b)?.inCount ?? 0) - (byPath.get(a)?.inCount ?? 0) || byCodeUnit(a, b)
    )[0]!
    return dirOf(anchorPath)
  }
  const groupsPerDir = new Map<string, number>()
  for (const group of groups) {
    const dir = anchorDirOfGroup(group)
    groupsPerDir.set(dir, (groupsPerDir.get(dir) ?? 0) + 1)
  }
  for (const group of groups) {
    const members = [
      ...group.primary.map((path) => ({ path, role: 'primary' as WikiMemberRole })),
      ...group.supporting.map((path) => ({ path, role: 'supporting' as WikiMemberRole }))
    ]
    const anchorFile = [...group.primary]
      .map((p) => byPath.get(p)!)
      .sort(
        (a, b) =>
          b.inCount - a.inCount ||
          b.exports.length - a.exports.length ||
          byCodeUnit(a.relPath, b.relPath)
      )[0]!
    const anchorSymbol =
      anchorFile.exports[0] ?? anchorFile.classes[0] ?? anchorFile.functions[0] ?? null
    const anchorDir = dirOf(anchorFile.relPath)
    const pureDir = group.primary.every((p) => dirOf(p) === anchorDir) && !group.crossDir
    const baseName = anchorDir === '' ? input.projectName : anchorDir.split('/').pop()!
    const fileBase = anchorFile.relPath
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '')
    const page: WikiPlanPage = {
      id: `w:${shortHash(`${anchorDir}|${anchorFile.relPath}|${anchorSymbol ?? ''}`)}`,
      kind: 'leaf',
      title: pureDir && (groupsPerDir.get(anchorDir) ?? 0) <= 1 ? baseName : fileBase,
      anchorDir,
      anchorSymbol,
      topicId: null,
      members,
      evidenceTokens: 0,
      oversized: false,
      basis: group.basis
    }
    pages.push(page)
    for (const member of members) ownerOf.set(member.path, page)
  }

  const unassigned: WikiPlan['unassigned'] = []
  const pageInDir = (dir: string): WikiPlanPage | undefined =>
    pages
      .filter((p) => p.kind === 'leaf' && p.anchorDir === dir)
      .sort((a, b) => b.members.length - a.members.length)[0]
  const bestPageByEdges = (from: string, targets: 'out' | 'in'): WikiPlanPage | undefined => {
    const counts = new Map<WikiPlanPage, number>()
    for (const edge of input.edges) {
      const other =
        targets === 'out'
          ? edge.from === from
            ? edge.to
            : null
          : edge.to === from
            ? edge.from
            : null
      if (other === null) continue
      const owner = ownerOf.get(other)
      if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }

  // 第四步:自测、样式、文档与数据文件按角色挂靠(不占页面主体)
  for (const file of files) {
    const kind = kinds.get(file.relPath)!
    if (isHidden(file.relPath)) {
      unassigned.push({ path: file.relPath, reason: '隐藏目录或点文件,属工具内部配置' })
      continue
    }
    if (kind === 'code') continue
    if (kind === 'asset') {
      unassigned.push({ path: file.relPath, reason: '二进制资源,不进页面' })
      continue
    }
    if (kind === 'doc' && input.rootDocs.includes(file.relPath)) continue // 根文档留给根主题页
    if (file.relPath === input.manifestPath) continue // 清单文件留给根主题页
    let target: WikiPlanPage | undefined
    let role: WikiMemberRole = 'attached'
    if (kind === 'test') {
      target = bestPageByEdges(file.relPath, 'out') ?? pageInDir(dirOf(file.relPath))
    } else if (kind === 'style') {
      target = bestPageByEdges(file.relPath, 'in') ?? pageInDir(dirOf(file.relPath))
      const isUi =
        target?.members.some((m) => (byPath.get(m.path)?.reactComponents.length ?? 0) > 0) ?? false
      role = isUi ? 'supporting' : 'attached'
    } else {
      target = pageInDir(dirOf(file.relPath))
    }
    if (!target) {
      unassigned.push({ path: file.relPath, reason: '没有可归属的代码页' })
      continue
    }
    target.members.push({ path: file.relPath, role })
    ownerOf.set(file.relPath, target)
  }

  // 第五步:根主题页提名(依据见 basis;没有依据的不硬凑)
  const testPaths = new Set(
    files.filter((f) => kinds.get(f.relPath) === 'test').map((f) => f.relPath)
  )
  const rootPages = buildRootPages(input, files, testPaths)
  pages.push(...rootPages)

  // 第六步:按目录前缀建主题树(超深折叠到第 4 层),子项够多的主题生成总览页
  const leafPages = pages.filter((p) => p.kind === 'leaf')
  const { topics: rootTopics, overviewPages } = assembleTopics(input, leafPages)
  pages.push(...overviewPages)

  // 第七步:统一算证据量与超限标记
  for (const page of pages) {
    page.members.sort((a, b) => byCodeUnit(a.path, b.path))
    page.evidenceTokens = page.members
      .filter((m) => m.role !== 'attached')
      .reduce((sum, m) => {
        const member = byPath.get(m.path)
        return sum + (member ? tokensOf(member) : 0)
      }, 0)
    page.oversized = page.kind === 'leaf' && page.evidenceTokens > PLAN_PAGE_EVIDENCE_TOKEN_CAP
  }

  return {
    version: WIKI_PLAN_VERSION,
    projectName: input.projectName,
    topics: rootTopics.sort((a, b) => byCodeUnit(a.dir, b.dir)),
    rootPageIds: rootPages.map((p) => p.id),
    pages,
    unassigned: unassigned.sort((a, b) => byCodeUnit(a.path, b.path)),
    stats: {
      files: files.length,
      codeFiles: codeFiles.length,
      leafPages: leafPages.length,
      overviewPages: overviewPages.length,
      rootPages: rootPages.length,
      oversizedPages: pages.filter((p) => p.oversized).length
    }
  }
}
