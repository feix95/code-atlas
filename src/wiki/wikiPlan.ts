// Wiki 页面规划:把全仓文件切成一棵主题树(A 组需求)。
// 信号按可信度用:目录结构定外层边界,目录内用引用社区细切,强内聚的跨目录社区许打破目录边界;
// 文件归属唯一,P2 模块只作参考不直接当页面。只切分不写字,切分结果单独评审后才进生成阶段。
import { byCodeUnit, dirOf } from '../modules/pathOrder.ts'
import {
  PLAN_PAGE_EVIDENCE_TOKEN_CAP,
  WIKI_PLAN_VERSION,
  classifyPlanFile,
  memberOwnsEvidence,
  type WikiMemberRole,
  type WikiPlan,
  type WikiPlanInput,
  type WikiPlanPage
} from './wikiPlanTypes.ts'
import { buildDraftGroups, tokensOf, type DraftGroup } from './wikiPlanGroups.ts'
import { nameTokens } from './wikiPlanFeatures.ts'
import { findPlanHubs } from './wikiPlanHubs.ts'
import { assembleTopics, shortHash } from './wikiPlanTree.ts'
import { mergeTinyPages } from './wikiPlanMerge.ts'
import { buildSkeleton } from './wikiSkeleton.ts'
import { assembleThemeTopics } from './wikiThemeTree.ts'
import type { WikiCatalog } from './wikiCatalogStore.ts'

export function buildWikiPlan(input: WikiPlanInput, catalog: WikiCatalog | null = null): WikiPlan {
  const files = [...input.files].sort((a, b) => byCodeUnit(a.relPath, b.relPath))
  const byPath = new Map(files.map((f) => [f.relPath, f]))
  const inDegree = new Map(files.map((f) => [f.relPath, f.inCount]))
  const kinds = new Map(files.map((f) => [f.relPath, classifyPlanFile(f.relPath)]))
  // 隐藏目录(.git、.husky 等)是工具内部文件,不进规划;CI 工作流是例外,它正是构建与部署要讲的内容
  const isHidden = (relPath: string): boolean =>
    !relPath.startsWith('.github/workflows/') &&
    relPath.split('/').some((seg) => seg.startsWith('.'))
  const codeFiles = files.filter((f) => kinds.get(f.relPath) === 'code' && !isHidden(f.relPath))

  // 公共文件先认出来:分组时请出聚类,挂靠与引用线都不再把它们当亲戚
  const hubs = findPlanHubs(codeFiles)
  const finalGroups = buildDraftGroups(input.edges, byPath, inDegree, codeFiles, hubs)

  // 第三步:每组定锚点、程序名与稳定标识,生成叶子页
  const pages: WikiPlanPage[] = []
  const featurePageIds = new Set<string>()
  const ownerOf = new Map<string, WikiPlanPage>()
  // 同一目录有多页时,页名改用各自锚点文件名,避免一排同名页
  const anchorDirOfGroup = (group: DraftGroup): string => {
    const anchorPath = [...group.primary].sort(
      (a, b) => (byPath.get(b)?.inCount ?? 0) - (byPath.get(a)?.inCount ?? 0) || byCodeUnit(a, b)
    )[0]!
    return dirOf(anchorPath)
  }
  const atomPaths = new Set<string>()
  for (const group of finalGroups) {
    if (group.hub) continue
    for (const path of group.primary) atomPaths.add(path)
  }
  const groupsPerDir = new Map<string, number>()
  for (const group of finalGroups) {
    if (group.hub) continue
    const dir = anchorDirOfGroup(group)
    groupsPerDir.set(dir, (groupsPerDir.get(dir) ?? 0) + 1)
  }
  const groupsPerTopicKey = new Map<string, number>()
  for (const group of finalGroups) {
    if (group.hub) continue
    if (group.topicKey)
      groupsPerTopicKey.set(group.topicKey, (groupsPerTopicKey.get(group.topicKey) ?? 0) + 1)
  }
  for (const group of finalGroups) {
    if (group.hub) continue
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
      title:
        group.feature && (groupsPerTopicKey.get(group.topicKey!) ?? 0) <= 1
          ? group.feature
          : pureDir && (groupsPerDir.get(anchorDir) ?? 0) <= 1
            ? baseName
            : fileBase,
      topicDir: group.topicKey ?? null,
      anchorDir,
      anchorSymbol,
      topicId: null,
      members,
      evidenceTokens: 0,
      oversized: false,
      basis: group.basis
    }
    pages.push(page)
    if (group.feature) featurePageIds.add(page.id)
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
      if (other === null || hubs.has(other)) continue
      const owner = ownerOf.get(other)
      if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }

  // 根主题页先提名:它的成员(CI 工作流、构建配置、根文档等)不再参与普通挂靠
  const testPaths = new Set(
    files.filter((f) => kinds.get(f.relPath) === 'test').map((f) => f.relPath)
  )
  const skeleton = buildSkeleton(input, files, testPaths, hubs, atomPaths)
  const rootPages = skeleton.roots
  const rootMemberPaths = skeleton.owned

  // 第四步:自测、样式、文档与数据文件按角色挂靠(不占页面主体)
  // 根主题成员不再重复挂靠;自测例外:测试策略页只是引用它,它的正职仍是挂到被测页当附属
  for (const file of files) {
    if (rootMemberPaths.has(file.relPath) && kinds.get(file.relPath) !== 'test') continue
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
      // 先按名找被测文件:selftest-wikiX 对 wikiX,名字对上的归属比引用计数可靠
      // (自测会顺手引一堆公共文件,按引用数算会被公共文件的大页抢走)
      const testTokens = new Set(nameTokens(file.relPath))
      // 自测名常把被测名连写(selftest-wikicleanup 对 wikiCleanup),再备一份去分隔符的整名比对
      const flat = (p: string): string =>
        p
          .split('/')
          .pop()!
          .replace(/\.[^.]+$/, '')
          .replace(/[^a-z0-9]/gi, '')
          .toLowerCase()
      const testFlat = flat(file.relPath).replace(/^selftest/, '')
      const nameScores = new Map<WikiPlanPage, number>()
      for (const page of pages) {
        if (page.kind !== 'leaf') continue
        for (const member of page.members) {
          if (member.role !== 'primary') continue
          if (flat(member.path) === testFlat) {
            nameScores.set(page, (nameScores.get(page) ?? 0) + 2)
          } else if (nameTokens(member.path).some((t) => testTokens.has(t))) {
            nameScores.set(page, (nameScores.get(page) ?? 0) + 1)
          }
        }
      }
      const byName = [...nameScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      target = byName ?? bestPageByEdges(file.relPath, 'out') ?? pageInDir(dirOf(file.relPath))
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

  // 第五步:根主题页入列
  pages.push(...rootPages)

  // 薄页先并,再把骨架章自己的叶子(公共类型、测试索引)放进来,最后按主题成树
  mergeTinyPages(pages, byPath, featurePageIds, new Set())
  pages.push(...skeleton.leaves)
  const atoms = pages.filter((page) => page.kind === 'leaf' && !skeleton.leaves.includes(page))
  let rootTopics: WikiPlan['topics']
  let overviewPages: WikiPlanPage[]
  try {
    const assembled = assembleThemeTopics(
      input,
      atoms,
      skeleton.chapters,
      skeleton.leaves,
      input.edges,
      hubs,
      catalog
    )
    rootTopics = assembled.topics
    overviewPages = assembled.overviewPages
  } catch {
    // 主题组装整体失败时退回旧的目录树,至少还能摆出卡片
    const fallback = assembleTopics(
      input,
      pages.filter((page) => page.kind === 'leaf')
    )
    rootTopics = fallback.topics
    overviewPages = fallback.overviewPages
  }
  pages.push(...overviewPages)
  const leafPages = pages.filter((page) => page.kind === 'leaf')

  for (const page of pages) {
    page.members.sort((a, b) => byCodeUnit(a.path, b.path))
    page.evidenceTokens = page.members
      .filter((member) => memberOwnsEvidence(member.role))
      .reduce((sum, member) => {
        const file = byPath.get(member.path)
        return sum + (file ? tokensOf(file) : 0)
      }, 0)
    page.oversized = page.kind === 'leaf' && page.evidenceTokens > PLAN_PAGE_EVIDENCE_TOKEN_CAP
  }

  return {
    version: WIKI_PLAN_VERSION,
    projectName: input.projectName,
    topics: rootTopics,
    rootPageIds: rootPages.map((p) => p.id),
    pages,
    hubs: [...hubs].sort(byCodeUnit),
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
