// 卡片墙数据装配:主题树规划与第二版记账合成卡片,连线只出从属与引用两种。
// 纯函数;规划与记账由调用方读好递入,引用边按成员文件聚合到页级并计权重。
import type { DepEdge } from '../shared/types.ts'
import type { WikiWallCard, WikiWallLink } from '../shared/wikiTypes.ts'
import type { WikiPlan, WikiPlanTopic } from './wikiPlanTypes.ts'
import type { WikiLanguageStateV2 } from './wikiStoreV2.ts'

function topicPaths(plan: WikiPlan): Map<string, string[]> {
  const paths = new Map<string, string[]>()
  const walk = (topic: WikiPlanTopic, chain: string[]): void => {
    const full = [...chain, topic.title]
    // 根主题的标题就是项目名,它是整棵树的伞不是一个板块:
    // 主题链去掉这一段,分区与详情才落在真正的第一层主题上
    const here = full.length > 1 && full[0] === plan.projectName ? full.slice(1) : full
    // 总览页就是本主题的门面,主题链含本主题;叶子页同理
    if (topic.overviewPageId !== null) paths.set(topic.overviewPageId, here)
    for (const pageId of topic.pageIds) paths.set(pageId, here)
    for (const child of topic.children) walk(child, here)
  }
  for (const topic of plan.topics) walk(topic, [])
  return paths
}

function containsLinks(plan: WikiPlan): WikiWallLink[] {
  const links: WikiWallLink[] = []
  const walk = (topic: WikiPlanTopic): void => {
    if (topic.overviewPageId !== null) {
      for (const pageId of topic.pageIds) {
        links.push({ from: topic.overviewPageId, to: pageId, kind: 'contains', weight: 1 })
      }
      for (const child of topic.children) {
        if (child.overviewPageId !== null) {
          links.push({
            from: topic.overviewPageId,
            to: child.overviewPageId,
            kind: 'contains',
            weight: 1
          })
        }
      }
    }
    for (const child of topic.children) walk(child)
  }
  for (const topic of plan.topics) walk(topic)
  return links
}

function referenceLinks(plan: WikiPlan, edges: DepEdge[]): WikiWallLink[] {
  const pageOf = new Map<string, string>()
  for (const page of plan.pages) {
    for (const member of page.members) {
      if (member.role !== 'attached') pageOf.set(member.path, page.id)
    }
  }
  const weights = new Map<string, number>()
  for (const edge of edges) {
    const from = pageOf.get(edge.from)
    const to = pageOf.get(edge.to)
    if (from === undefined || to === undefined || from === to) continue
    const key = `${from}\n${to}`
    weights.set(key, (weights.get(key) ?? 0) + 1)
  }
  return [...weights.entries()].map(([key, weight]) => {
    const [from, to] = key.split('\n') as [string, string]
    return { from, to, kind: 'reference' as const, weight }
  })
}

export function buildWikiWall(
  plan: WikiPlan,
  edges: DepEdge[],
  language: WikiLanguageStateV2 | undefined
): { cards: WikiWallCard[]; links: WikiWallLink[] } {
  const paths = topicPaths(plan)
  const cards: WikiWallCard[] = plan.pages.map((page) => {
    const record = language?.pages[page.id]
    const status =
      record === undefined
        ? 'planned'
        : record.status === 'done' || record.status === 'stale' || record.status === 'failed'
          ? record.status
          : 'planned'
    return {
      pageId: page.id,
      kind: page.kind,
      title: record !== undefined && record.name !== '' ? record.name : page.title,
      status,
      summary: record?.summary ?? '',
      excerpt: record?.excerpt ?? '',
      file: record?.file ?? '',
      keyFiles:
        record?.keyFiles ?? page.members.filter((m) => m.role === 'primary').map((m) => m.path),
      memberCount: page.members.length,
      members: page.members.map((m) => m.path),
      topicPath: paths.get(page.id) ?? []
    }
  })
  return { cards, links: [...containsLinks(plan), ...referenceLinks(plan, edges)] }
}
