// Wiki 规划的根主题提名与主题树组装:从 wikiPlan.ts 拆出,各自守单文件行数闸。
// 根主题不写死清单:有依据才提名(依据写进页面 basis);主题树按目录前缀建,超深折叠到第 4 层。
import { createHash } from 'node:crypto'
import { byCodeUnit, dirOf } from '../modules/pathOrder.ts'
import {
  PLAN_TREE_MAX_DEPTH,
  type WikiMemberRole,
  type WikiPlanFileInput,
  type WikiPlanInput,
  type WikiPlanPage,
  type WikiPlanTopic
} from './wikiPlanTypes.ts'

export function shortHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 10)
}

const BUILD_CONFIG_PATTERN =
  /(^|\/)(electron-builder[^/]*|vite\.config\.[^/]+|webpack[^/]*|rollup\.config\.[^/]+|Dockerfile|Makefile|tsconfig[^/]*)$/

/** 根主题页提名:项目概述常设,其余有信号才提名,不硬凑 */
export function buildRootPages(
  input: WikiPlanInput,
  files: WikiPlanFileInput[],
  testPaths: Set<string>
): WikiPlanPage[] {
  const draft = (title: string, memberPaths: string[], basis: string[]): WikiPlanPage => ({
    id: `w:${shortHash(`|root|${title}`)}`,
    kind: 'root',
    title,
    anchorDir: '',
    anchorSymbol: null,
    topicId: null,
    members: memberPaths.map((path) => ({ path, role: 'supporting' as WikiMemberRole })),
    evidenceTokens: 0,
    oversized: false,
    basis
  })
  const rootPages: WikiPlanPage[] = []
  const readme = input.rootDocs.find((p) => /readme/i.test(p)) ?? input.rootDocs[0]
  rootPages.push(
    draft(
      '项目概述',
      [readme, input.manifestPath].filter((p): p is string => typeof p === 'string'),
      readme ? ['根目录文档提名'] : ['无根文档,后续由全仓结构生成']
    )
  )
  if (input.manifestScripts.some((s) => ['dev', 'start', 'serve', 'preview'].includes(s))) {
    rootPages.push(
      draft('快速开始', input.manifestPath ? [input.manifestPath] : [], ['清单文件含启动脚本'])
    )
  }
  const buildConfigs = files
    .filter((f) => BUILD_CONFIG_PATTERN.test(f.relPath))
    .map((f) => f.relPath)
  if (
    buildConfigs.length > 0 ||
    input.manifestScripts.some((s) => ['build', 'pack', 'dist'].includes(s))
  ) {
    rootPages.push(draft('构建与部署', buildConfigs.slice(0, 6), ['存在构建配置或构建脚本']))
  }
  const testFiles = files.filter((f) => testPaths.has(f.relPath))
  if (testFiles.length > 0) {
    rootPages.push(
      draft(
        '测试策略',
        testFiles.slice(0, 8).map((f) => f.relPath),
        ['存在自测文件']
      )
    )
  }
  return rootPages
}

/** 按叶子页的锚点目录建主题树;子项合计不少于 2 的主题生成总览页 */
export function assembleTopics(
  input: WikiPlanInput,
  leafPages: WikiPlanPage[]
): { topics: WikiPlanTopic[]; overviewPages: WikiPlanPage[] } {
  const topicByDir = new Map<string, WikiPlanTopic>()
  const topicOf = (dir: string): WikiPlanTopic => {
    let topic = topicByDir.get(dir)
    if (!topic) {
      topic = {
        id: `t:${shortHash(dir || '.')}`,
        title: dir === '' ? input.projectName : dir.split('/').pop()!,
        dir,
        overviewPageId: null,
        pageIds: [],
        children: []
      }
      topicByDir.set(dir, topic)
    }
    return topic
  }
  const cappedDir = (dir: string): string => {
    const parts = dir === '' ? [] : dir.split('/')
    return parts.slice(0, PLAN_TREE_MAX_DEPTH).join('/')
  }
  for (const page of leafPages) {
    const dir = cappedDir(page.anchorDir)
    const topic = topicOf(dir)
    topic.pageIds.push(page.id)
    page.topicId = topic.id
    let parent = dirOf(dir)
    while (true) {
      topicOf(parent)
      if (parent === '') break
      parent = dirOf(parent)
    }
  }
  const rootTopics: WikiPlanTopic[] = []
  for (const topic of topicByDir.values()) {
    if (topic.dir === '') {
      rootTopics.push(topic)
      continue
    }
    topicByDir.get(dirOf(topic.dir))!.children.push(topic)
  }
  const pageById = new Map(leafPages.map((p) => [p.id, p]))
  const overviewPages: WikiPlanPage[] = []
  for (const topic of [...topicByDir.values()].sort((a, b) => byCodeUnit(a.dir, b.dir))) {
    topic.pageIds.sort(byCodeUnit)
    topic.children.sort((a, b) => byCodeUnit(a.dir, b.dir))
    if (topic.pageIds.length + topic.children.length < 2) continue
    const anchorMembers = topic.pageIds
      .map((id) => pageById.get(id)!)
      .map((p) => p.members.find((m) => m.role === 'primary')?.path)
      .filter((p): p is string => typeof p === 'string')
      .slice(0, 12)
    const overview: WikiPlanPage = {
      id: `w:${shortHash(`${topic.dir}|overview`)}`,
      kind: 'overview',
      title: topic.title,
      anchorDir: topic.dir,
      anchorSymbol: null,
      topicId: topic.id,
      members: anchorMembers.map((path) => ({ path, role: 'supporting' as WikiMemberRole })),
      evidenceTokens: 0,
      oversized: false,
      basis: ['子页总览']
    }
    topic.overviewPageId = overview.id
    overviewPages.push(overview)
  }
  return { topics: rootTopics.sort((a, b) => byCodeUnit(a.dir, b.dir)), overviewPages }
}
