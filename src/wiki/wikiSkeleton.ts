// 固定骨架:按仓库里看得到的信号提名章和根文,信号没有就不提名。
// 章名是文档结构(架构、核心功能、API),不是这个仓库的目录名。
import type { WikiPlanFileInput, WikiPlanInput, WikiPlanPage } from './wikiPlanTypes.ts'
import { IPC_DEFINITION_PATTERN } from './wikiPlanHubs.ts'
import { BUILD_CONFIG_PATTERN, shortHash } from './wikiPlanTree.ts'
import { addApiChapter, addComponentChapter, addTestChapter } from './wikiSkeletonExtra.ts'

export { COMPONENT_CHAPTER_MIN } from './wikiSkeletonExtra.ts'

export const CHAPTERS = {
  architecture: { slug: 'architecture', title: '架构设计' },
  features: { slug: 'features', title: '核心功能' },
  components: { slug: 'components', title: '组件架构' },
  api: { slug: 'api', title: 'API 参考文档' },
  tests: { slug: 'tests', title: '测试策略' }
} as const

export type ChapterSlug = keyof typeof CHAPTERS

const DEV_CONFIG =
  /(^|\/)(tsconfig(\.[^/]+)?\.json|eslint\.config\.[^/]+|\.eslintrc[^/]*|\.prettierrc[^/]*|prettier\.config\.[^/]+|lint-staged(\.config)?\.[^/]*)$/i
const ERROR_BASE = /(err|error|rescue|devlog|diagnos)/i
const ENTRY_BASE = /^(index|main|preload)\.(ts|tsx|js|mjs|cjs)$/
const SECURITY_NAME = /(codec|secret|encrypt|safeStorage)/i
const PRELOAD_DIR = /(^|\/)preload(\/|$)/i
const IPC_HANDLER = /(^|\/)ipc[A-Z0-9][^/]*\.(ts|tsx|js|mjs)$/
const REQUEST_SCOPE = /requestScope/i
const STATE_FILE = /(^|\/)[^/]*(Store|store|State)\.(ts|tsx)$/
const ELECTRON_ENTRY = /(^|\/)electron\.vite\.config\.[^/]+$/

export interface SkeletonChapter {
  slug: string
  title: string
  pageIds: string[]
}

export interface SkeletonPlan {
  roots: WikiPlanPage[]
  leaves: WikiPlanPage[]
  chapters: SkeletonChapter[]
  /** 骨架章真正拥有的文件;已经落在功能原子里的只引用、不抢走 */
  owned: Set<string>
}

export function isShellPath(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? ''
  return PRELOAD_DIR.test(relPath) || SECURITY_NAME.test(base) || ENTRY_BASE.test(base)
}

function pageOf(
  title: string,
  kind: WikiPlanPage['kind'],
  members: WikiPlanPage['members'],
  basis: string[],
  idSeed: string
): WikiPlanPage {
  return {
    id: `w:${shortHash(idSeed)}`,
    kind,
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

function ownedMembers(paths: string[], role: 'primary' | 'supporting'): WikiPlanPage['members'] {
  return paths.map((path) => ({ path, role }))
}

function refMembers(paths: string[]): WikiPlanPage['members'] {
  return paths.map((path) => ({ path, role: 'reference' as const }))
}

function subsystemKey(relPath: string, hasSrc: boolean): string | null {
  const parts = relPath.split('/')
  if (parts.length < 2) return null
  if (hasSrc && parts[0] !== 'src') return null
  return parts.length >= 3 && parts[0] === 'src' ? `src/${parts[1]}` : parts[0]!
}

function isErrorFile(file: WikiPlanFileInput): boolean {
  const base = file.relPath.split('/').pop() ?? ''
  if (ERROR_BASE.test(base)) return true
  return [...file.exports, ...file.classes, ...file.functions].includes('ErrorBoundary')
}

/** 按信号提名根文、骨架章,以及章自己拥有的叶子(公共文件、配置、测试索引) */
export function buildSkeleton(
  input: WikiPlanInput,
  files: WikiPlanFileInput[],
  testPaths: Set<string>,
  hubs: Set<string>,
  atomPaths: Set<string>
): SkeletonPlan {
  const roots: WikiPlanPage[] = []
  const leaves: WikiPlanPage[] = []
  const chapters: SkeletonChapter[] = []
  const owned = new Set<string>()
  const claim = (paths: string[]): string[] => {
    const kept: string[] = []
    for (const path of paths) {
      if (atomPaths.has(path) || owned.has(path)) continue
      owned.add(path)
      kept.push(path)
    }
    return kept
  }
  const cite = (paths: string[]): string[] => paths.filter((path) => !owned.has(path)).slice(0, 12)

  const readme = input.rootDocs.find((path) => /readme/i.test(path)) ?? input.rootDocs[0]
  const overviewMembers = claim(
    [readme, input.manifestPath].filter((path): path is string => typeof path === 'string')
  )
  roots.push(
    pageOf(
      '项目概述',
      'root',
      ownedMembers(overviewMembers, 'supporting'),
      readme ? ['根目录文档提名'] : ['无根文档,后续由全仓结构生成'],
      '|root|项目概述'
    )
  )
  if (
    input.manifestScripts.some((script) => ['dev', 'start', 'serve', 'preview'].includes(script))
  ) {
    // 清单同时出现在项目概述里:两篇根文都要引用它,但都不是主角,不抢功能页
    const quick = input.manifestPath ? [input.manifestPath] : []
    roots.push(
      pageOf(
        '快速开始',
        'root',
        ownedMembers(quick, 'supporting'),
        ['清单文件含启动脚本'],
        '|root|快速开始'
      )
    )
  }
  const devConfigs = files
    .filter((file) => DEV_CONFIG.test(file.relPath))
    .map((file) => file.relPath)
  const devOwned = claim(devConfigs)
  if (devOwned.length > 0 || cite(devConfigs).length > 0) {
    const members = [...ownedMembers(devOwned, 'supporting'), ...refMembers(cite(devConfigs))]
    roots.push(
      pageOf('开发指南', 'root', members, ['存在工程配置(类型、检查或格式)'], '|root|开发指南')
    )
  }
  const buildConfigs = files
    .filter((file) => BUILD_CONFIG_PATTERN.test(file.relPath))
    .map((file) => file.relPath)
  const workflows = files
    .filter((file) => file.relPath.startsWith('.github/workflows/'))
    .map((file) => file.relPath)
  if (
    buildConfigs.length > 0 ||
    workflows.length > 0 ||
    input.manifestScripts.some((script) => ['build', 'pack', 'dist'].includes(script))
  ) {
    const paths = [...workflows, ...buildConfigs].slice(0, 6)
    const buildOwned = claim(paths)
    roots.push(
      pageOf(
        '构建与部署',
        'root',
        [...ownedMembers(buildOwned, 'supporting'), ...refMembers(cite(paths))],
        ['存在构建配置、CI 工作流或构建脚本'],
        '|root|构建与部署'
      )
    )
  }

  const channelFiles = files
    .filter((file) => IPC_DEFINITION_PATTERN.test(file.relPath))
    .map((file) => file.relPath)
  const scopeFiles = files
    .filter((file) => REQUEST_SCOPE.test(file.relPath))
    .map((file) => file.relPath)
  const stateFiles = files
    .filter((file) => STATE_FILE.test(file.relPath))
    .map((file) => file.relPath)
  if (channelFiles.length > 0 || scopeFiles.length > 0 || stateFiles.length > 0) {
    const flow = [...channelFiles, ...scopeFiles, ...stateFiles].slice(0, 8)
    roots.push(
      pageOf(
        '数据流设计',
        'root',
        refMembers(cite(flow)),
        ['存在通道定义、请求作用域或状态模块'],
        '|root|数据流设计'
      )
    )
  }
  const errorFiles = files.filter((file) => isErrorFile(file)).map((file) => file.relPath)
  if (errorFiles.length > 0) {
    const errorOwned = claim(errorFiles.slice(0, 8))
    roots.push(
      pageOf(
        '故障排除',
        'root',
        [...ownedMembers(errorOwned, 'supporting'), ...refMembers(cite(errorFiles.slice(0, 8)))],
        ['存在错误处理、补救或诊断文件'],
        '|root|故障排除'
      )
    )
  }

  chapters.push({ ...CHAPTERS.features, pageIds: [] })
  addArchitecture(files, testPaths, leaves, chapters, cite)
  addApiChapter(files, hubs, channelFiles, leaves, chapters, claim, cite)
  addComponentChapter(files, hubs, leaves, chapters, claim)
  addTestChapter(files, testPaths, leaves, chapters)
  return { roots, leaves, chapters, owned }
}

function addArchitecture(
  files: WikiPlanFileInput[],
  testPaths: Set<string>,
  leaves: WikiPlanPage[],
  chapters: SkeletonChapter[],
  cite: (paths: string[]) => string[]
): void {
  const hasSrc = files.some((file) => file.relPath.startsWith('src/'))
  const topDirs = new Set<string>()
  for (const file of files) {
    if (file.languageId === '' || testPaths.has(file.relPath)) continue
    const key = subsystemKey(file.relPath, hasSrc)
    if (key) topDirs.add(key)
  }
  if (topDirs.size < 3) return
  const pages: WikiPlanPage[] = []
  const entries = new Map<string, WikiPlanFileInput>()
  for (const file of files) {
    const base = file.relPath.split('/').pop() ?? ''
    const key = subsystemKey(file.relPath, hasSrc)
    if (!key || !ENTRY_BASE.test(base)) continue
    const prev = entries.get(key)
    if (!prev || file.inCount > prev.inCount) entries.set(key, file)
  }
  const electron = files
    .filter((file) => ELECTRON_ENTRY.test(file.relPath))
    .map((file) => file.relPath)
  const entryPaths = [...entries.values()].map((file) => file.relPath).concat(electron)
  if (entryPaths.length > 0) {
    pages.push(
      pageOf(
        '进程与入口',
        'leaf',
        refMembers(cite(entryPaths)),
        ['骨架:各子系统入口'],
        '|skeleton|entry'
      )
    )
  }
  const bridge = files
    .filter(
      (file) =>
        PRELOAD_DIR.test(file.relPath) || SECURITY_NAME.test(file.relPath.split('/').pop() ?? '')
    )
    .map((file) => file.relPath)
  if (bridge.length > 0) {
    pages.push(
      pageOf(
        '安全桥接',
        'leaf',
        refMembers(cite(bridge)),
        ['骨架:预加载或加密相关文件'],
        '|skeleton|bridge'
      )
    )
  }
  const ipc = files.filter(
    (file) => IPC_HANDLER.test(file.relPath) || IPC_DEFINITION_PATTERN.test(file.relPath)
  )
  if (ipc.length > 0) {
    pages.push(
      pageOf(
        '跨进程通信',
        'leaf',
        refMembers(cite(ipc.map((file) => file.relPath))),
        ['骨架:通道定义或通道处理器'],
        '|skeleton|ipc-arch'
      )
    )
  }
  leaves.push(...pages)
  chapters.push({ ...CHAPTERS.architecture, pageIds: pages.map((page) => page.id) })
}
