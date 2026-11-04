// 父页(总览页与根主题页)的下属关系与内容指纹:纯函数,任务与卡片墙共用同一套口径。
// 总览页的下属是本主题的叶子页加子主题的总览页;根主题页的下属是与它共享成员文件的叶子页。
import { createHash } from 'node:crypto'
import type { WikiPlan } from './wikiPlanTypes.ts'
import type { WikiLanguageStateV2, WikiPageRecordV2 } from './wikiStoreV2.ts'

export interface WikiParentChild {
  pageId: string
  title: string
  summary: string
  file: string
  done: boolean
}

/** 每张父页的下属页 id(按规划顺序);键为父页 id */
export function parentChildrenOf(plan: WikiPlan): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const walk = (topics: WikiPlan['topics']): void => {
    for (const topic of topics) {
      if (topic.overviewPageId !== null) {
        const children = [...topic.pageIds]
        for (const child of topic.children) {
          // 子主题有总览页就汇总总览;没有总览页时它的叶子页直接作为下属出现
          if (child.overviewPageId !== null) children.push(child.overviewPageId)
          else children.push(...child.pageIds)
        }
        result.set(topic.overviewPageId, children)
      }
      walk(topic.children)
    }
  }
  walk(plan.topics)
  const leaves = plan.pages.filter((page) => page.kind === 'leaf')
  for (const page of plan.pages) {
    if (page.kind !== 'root') continue
    const own = new Set(page.members.map((member) => member.path))
    result.set(
      page.id,
      leaves
        .filter((leaf) => leaf.members.some((member) => own.has(member.path)))
        .map((leaf) => leaf.id)
    )
  }
  return result
}

/** 父页生成次序键:越深的总览越先(先有子层摘要再汇总上层),根主题页最后 */
export function parentOrderOf(plan: WikiPlan): Map<string, number> {
  const order = new Map<string, number>()
  const walk = (topics: WikiPlan['topics'], depth: number): void => {
    for (const topic of topics) {
      if (topic.overviewPageId !== null) order.set(topic.overviewPageId, depth)
      walk(topic.children, depth + 1)
    }
  }
  walk(plan.topics, 0)
  for (const page of plan.pages) {
    if (page.kind === 'root') order.set(page.id, -1)
  }
  return order
}

/** 按主题 id 在主题树里找标题;根主题页没有主题时返回 null */
export function topicTitleOf(plan: WikiPlan, topicId: string | null): string | null {
  if (topicId === null) return null
  const walk = (topics: WikiPlan['topics']): string | null => {
    for (const topic of topics) {
      if (topic.id === topicId) return topic.title
      const found = walk(topic.children)
      if (found !== null) return found
    }
    return null
  }
  return walk(plan.topics)
}

/** 下属页的现状:名称与摘要以记账为准,还没生成时用规划标题占位 */
export function parentChildInputs(
  plan: WikiPlan,
  language: WikiLanguageStateV2 | undefined,
  childIds: string[]
): WikiParentChild[] {
  const pageById = new Map(plan.pages.map((page) => [page.id, page]))
  return childIds.map((id) => {
    const record: WikiPageRecordV2 | undefined = language?.pages[id]
    const page = pageById.get(id)
    return {
      pageId: id,
      title: record?.name ?? page?.title ?? id,
      summary: record?.summary ?? '',
      file: record?.file ?? '',
      done: record?.status === 'done' || record?.status === 'stale'
    }
  })
}

/** 内容指纹:下属页的名称、状态档与摘要拼串哈希;任一下属变化都会让它变 */
export function parentFingerprint(children: WikiParentChild[]): string {
  const text = children
    .map((child) => `${child.pageId}|${child.done ? 1 : 0}|${child.title}|${child.summary}`)
    .join('\n')
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)
}
