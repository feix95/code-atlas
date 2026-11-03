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

export const BUILD_CONFIG_PATTERN =
  /(^|\/)(electron-builder[^/]*|vite\.config\.[^/]+|webpack[^/]*|rollup\.config\.[^/]+|Dockerfile|Makefile)$/

/** 进程间通道定义文件:只认通道定义本身(如 ipcChannels.ts),不认各通道的处理器文件 */
const IPC_DEFINITION_PATTERN = /(^|\/)[^/]*channels?\.ts$/i

/** 根主题页提名:项目概述常设,其余有信号才提名,不硬凑 */
export function buildRootPages(
  input: WikiPlanInput,
  files: WikiPlanFileInput[],
  testPaths: Set<string>
): WikiPlanPage[] {
  const draft = (title: string, memberPaths: string[], basis: string[]): WikiPlanPage => ({
    id: `w:${shortHash(`|root|${title}`)}`,
    kind: 'root',
    topicDir: null,
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
  const workflows = files
    .filter((f) => f.relPath.startsWith('.github/workflows/'))
    .map((f) => f.relPath)
  if (
    buildConfigs.length > 0 ||
    workflows.length > 0 ||
    input.manifestScripts.some((s) => ['build', 'pack', 'dist'].includes(s))
  ) {
    rootPages.push(
      draft('构建与部署', [...workflows, ...buildConfigs].slice(0, 6), [
        '存在构建配置、CI 工作流或构建脚本'
      ])
    )
  }
  const ipcFiles = files.filter((f) => IPC_DEFINITION_PATTERN.test(f.relPath)).map((f) => f.relPath)
  if (ipcFiles.length > 0) {
    rootPages.push(draft('数据流设计', ipcFiles.slice(0, 4), ['存在进程间通道定义文件']))
  }
  // 架构设计:一级子系统不少于 3 个时提名,成员取各子系统被引最多的文件。
  // 子系统只认目录:有 src 时只看 src 下一级目录,根级散文件与脚本目录不算子系统。
  const hasSrc = files.some((f) => f.relPath.startsWith('src/'))
  const topDirs = new Map<string, WikiPlanFileInput[]>()
  for (const file of files) {
    if (file.languageId === '' || testPaths.has(file.relPath)) continue
    const parts = file.relPath.split('/')
    if (parts.length < 2) continue
    if (hasSrc && parts[0] !== 'src') continue
    const top = parts.length >= 3 && parts[0] === 'src' ? `src/${parts[1]}` : parts[0]!
    const list = topDirs.get(top)
    if (list) list.push(file)
    else topDirs.set(top, [file])
  }
  if (topDirs.size >= 3) {
    const anchors = [...topDirs.values()]
      .map((list) => [...list].sort((a, b) => b.inCount - a.inCount)[0]!.relPath)
      .slice(0, 8)
    rootPages.push(draft('架构设计', anchors, ['一级子系统不少于 3 个']))
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
        // 末段是 src 这类通用名时取上一段作显示名,免得与上层同名主题撞名(src/renderer/src 显示 renderer)
        title:
          dir === ''
            ? input.projectName
            : dir.split('/').pop() === 'src' && dir.split('/').length >= 2
              ? dir.split('/')[dir.split('/').length - 2]!
              : dir.split('/').pop()!,
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
    const dir = page.topicDir ?? cappedDir(page.anchorDir)
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
  // 链式折叠:自己没有页、只有一个子主题的中间层不占一层(如 src/renderer 只有 src 一个子目录)
  const collapseTopic = (topic: WikiPlanTopic): WikiPlanTopic => {
    topic.children = topic.children.map(collapseTopic)
    if (topic.dir !== '' && topic.pageIds.length === 0 && topic.children.length === 1) {
      return topic.children[0]!
    }
    return topic
  }
  const collapsedRoots = rootTopics.map(collapseTopic)
  // 最深层收尾:目录已到第 4 段、又只有一页的主题不再单独占层,页并入父主题
  const foldDeep = (topic: WikiPlanTopic, parent: WikiPlanTopic | null): WikiPlanTopic | null => {
    topic.children = topic.children
      .map((child) => foldDeep(child, topic))
      .filter((child): child is WikiPlanTopic => child !== null)
    const segs =
      topic.dir === '' || topic.dir.startsWith('feature:') ? 0 : topic.dir.split('/').length
    if (
      parent &&
      segs >= PLAN_TREE_MAX_DEPTH &&
      topic.children.length === 0 &&
      topic.pageIds.length <= 1
    ) {
      parent.pageIds.push(...topic.pageIds)
      return null
    }
    return topic
  }
  const foldedRoots = collapsedRoots
    .map((topic) => foldDeep(topic, null))
    .filter((topic): topic is WikiPlanTopic => topic !== null)
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
      topicDir: null,
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
  return { topics: foldedRoots.sort((a, b) => byCodeUnit(a.dir, b.dir)), overviewPages }
}
