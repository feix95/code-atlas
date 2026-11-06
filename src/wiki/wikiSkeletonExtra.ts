// 骨架章里靠引用凑出来的子页:API、组件、测试。从 wikiSkeleton 拆出,各自守行数闸。
import type { WikiPlanFileInput, WikiPlanPage } from './wikiPlanTypes.ts'
import { shortHash } from './wikiPlanTree.ts'

/** 界面组件多到这个数,才单开「组件架构」一章 */
export const COMPONENT_CHAPTER_MIN = 20

const API = { slug: 'api', title: 'API 参考文档' }
const COMPONENTS = { slug: 'components', title: '组件架构' }
const TESTS = { slug: 'tests', title: '测试策略' }

interface ChapterList {
  slug: string
  title: string
  pageIds: string[]
}

const IPC_HANDLER = /(^|\/)ipc[A-Z0-9][^/]*\.(ts|tsx|js|mjs)$/
const HTTP_ROUTE = /(^|\/)(routes?|router)\.(ts|tsx|js|mjs)$/i
const ERROR_CODE = /(^|\/)(errorCodes?|errText|errors)\.(ts|tsx)$/i
const TYPE_FILE = /(^|\/)[^/]*types?\.(ts|tsx)$/i

function pageOf(
  title: string,
  members: WikiPlanPage['members'],
  basis: string[],
  idSeed: string
): WikiPlanPage {
  return {
    id: `w:${shortHash(idSeed)}`,
    kind: 'leaf',
    topicDir: null,
    title,
    anchorDir: '',
    anchorSymbol: null,
    topicId: null,
    members,
    evidenceTokens: 0,
    oversized: false,
    basis
  }
}

function owned(paths: string[], role: 'primary' | 'supporting'): WikiPlanPage['members'] {
  return paths.map((path) => ({ path, role }))
}

function refs(paths: string[]): WikiPlanPage['members'] {
  return paths.map((path) => ({ path, role: 'reference' as const }))
}

export function addApiChapter(
  files: WikiPlanFileInput[],
  hubs: Set<string>,
  channelFiles: string[],
  leaves: WikiPlanPage[],
  chapters: ChapterList[],
  claim: (paths: string[]) => string[],
  cite: (paths: string[]) => string[]
): void {
  const typeHubs = files
    .filter((file) => hubs.has(file.relPath) && TYPE_FILE.test(file.relPath))
    .map((file) => file.relPath)
  const otherHubs = [...hubs].filter(
    (path) => !typeHubs.includes(path) && !channelFiles.includes(path)
  )
  const routes = files.filter((file) => HTTP_ROUTE.test(file.relPath)).map((file) => file.relPath)
  const codes = files.filter((file) => ERROR_CODE.test(file.relPath)).map((file) => file.relPath)
  if (typeHubs.length + channelFiles.length + otherHubs.length + routes.length + codes.length === 0)
    return
  const pages: WikiPlanPage[] = []
  const typeOwned = claim(typeHubs)
  if (typeOwned.length > 0 || cite(typeHubs).length > 0) {
    pages.push(
      pageOf(
        '共享类型',
        [...owned(typeOwned, 'primary'), ...refs(cite(typeHubs))],
        ['骨架:公共类型文件归入共享类型'],
        '|skeleton|types'
      )
    )
  }
  const channelOwned = claim(channelFiles)
  if (channelOwned.length > 0 || cite(channelFiles).length > 0) {
    pages.push(
      pageOf(
        '通道定义',
        [...owned(channelOwned, 'primary'), ...refs(cite(channelFiles))],
        ['骨架:通道定义文件'],
        '|skeleton|channels'
      )
    )
  }
  const restOwned = claim(otherHubs.filter((path) => !path.endsWith('.tsx')))
  if (restOwned.length > 0) {
    pages.push(
      pageOf('公共模块', owned(restOwned, 'primary'), ['骨架:其余公共文件'], '|skeleton|hubs')
    )
  }
  const handlers = files
    .filter((file) => IPC_HANDLER.test(file.relPath))
    .map((file) => file.relPath)
  if (handlers.length > 0 && handlers.length <= 8) {
    handlers.forEach((path, index) => {
      const base = path
        .split('/')
        .pop()!
        .replace(/\.[^.]+$/, '')
      pages.push(
        pageOf(base, refs([path]), ['骨架:通道处理器引用'], `|skeleton|handler|${index}|${path}`)
      )
    })
  } else if (handlers.length > 8) {
    pages.push(
      pageOf('通道处理器', refs(cite(handlers)), ['骨架:通道处理器引用'], '|skeleton|handlers')
    )
  }
  if (routes.length > 0)
    pages.push(pageOf('HTTP 路由', refs(cite(routes)), ['骨架:路由文件'], '|skeleton|routes'))
  if (codes.length > 0) {
    const codeOwned = claim(codes)
    pages.push(
      pageOf(
        '错误码',
        [...owned(codeOwned, 'supporting'), ...refs(cite(codes))],
        ['骨架:错误码'],
        '|skeleton|codes'
      )
    )
  }
  leaves.push(...pages)
  chapters.push({ ...API, pageIds: pages.map((page) => page.id) })
}

export function addComponentChapter(
  files: WikiPlanFileInput[],
  hubs: Set<string>,
  leaves: WikiPlanPage[],
  chapters: ChapterList[],
  claim: (paths: string[]) => string[]
): void {
  const reactFiles = files.filter(
    (file) => file.reactComponents.length > 0 || file.relPath.endsWith('.tsx')
  )
  const uiHubs = [...hubs].filter((path) => path.endsWith('.tsx'))
  if (reactFiles.length < COMPONENT_CHAPTER_MIN && uiHubs.length === 0) return
  const pages: WikiPlanPage[] = []
  const kept = claim(uiHubs)
  if (kept.length > 0)
    pages.push(pageOf('通用控件', owned(kept, 'primary'), ['骨架:公共界面元件'], '|skeleton|icons'))
  leaves.push(...pages)
  chapters.push({ ...COMPONENTS, pageIds: pages.map((page) => page.id) })
}

export function addTestChapter(
  files: WikiPlanFileInput[],
  testPaths: Set<string>,
  leaves: WikiPlanPage[],
  chapters: ChapterList[]
): void {
  const tests = files.filter((file) => testPaths.has(file.relPath)).map((file) => file.relPath)
  if (tests.length === 0) return
  const buckets: Record<'unit' | 'e2e' | 'fixture', string[]> = { unit: [], e2e: [], fixture: [] }
  for (const path of tests) {
    if (/journey|e2e|playwright/i.test(path)) buckets.e2e.push(path)
    else if (/fixture/i.test(path)) buckets.fixture.push(path)
    else buckets.unit.push(path)
  }
  const titles = { unit: '自测脚本', e2e: '端到端', fixture: '夹具与替身' } as const
  const pages: WikiPlanPage[] = []
  for (const key of ['unit', 'e2e', 'fixture'] as const) {
    if (buckets[key].length === 0) continue
    pages.push(
      pageOf(
        titles[key],
        refs(buckets[key].slice(0, 12)),
        ['骨架:自测归入测试策略,仍挂在被测页'],
        `|skeleton|test|${key}`
      )
    )
  }
  leaves.push(...pages)
  chapters.push({ ...TESTS, pageIds: pages.map((page) => page.id) })
}
