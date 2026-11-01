// Wiki 生成请求的入口清洗:渲染层递来的路径与页面清单一律当外部输入,
// 只收项目内相对路径,越界、绝对路径和怪字段直接丢掉;页面 id 去重保序。
import { isAbsolute } from 'node:path'
import { joinRoot } from '../shared/paths.ts'
import type {
  WikiDependencyFact,
  WikiPageFileSource,
  WikiPageSource,
  WikiStartRequest
} from '../shared/wikiTypes.ts'

const MAX_PAGES = 2000
const MAX_FILES_PER_PAGE = 5000
const MAX_TAGS = 40

export type WikiStartParse = { ok: true; request: WikiStartRequest } | { ok: false; error: string }

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value === '' || value.length > max ? null : value
}

/** 只收项目内相对路径;joinRoot 再兜一次越界 */
function relPath(root: string, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const path = raw.trim().replaceAll('\\', '/')
  if (path === '' || path.length > 1024) return null
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) return null
  if (path.split('/').some((part) => part === '..')) return null
  try {
    joinRoot(root, path)
    return path
  } catch {
    return null
  }
}

function count(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : undefined
}

function fileSource(root: string, raw: unknown): WikiPageFileSource | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const path = relPath(root, record.path)
  if (path === null) return null
  const out: WikiPageFileSource = { path }
  const language = text(record.language, 40)
  if (language) out.language = language
  const inCount = count(record.inCount)
  const outCount = count(record.outCount)
  if (inCount !== undefined) out.inCount = inCount
  if (outCount !== undefined) out.outCount = outCount
  return out
}

function dependency(raw: unknown): WikiDependencyFact | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const moduleId = text(record.moduleId, 200)
  if (moduleId === null) return null
  const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name : null
  const weight =
    typeof record.weight === 'number' && Number.isFinite(record.weight) && record.weight >= 0
      ? record.weight
      : 0
  return { moduleId, name, weight }
}

function dependencies(raw: unknown): WikiDependencyFact[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, MAX_FILES_PER_PAGE)
    .map(dependency)
    .filter((item): item is WikiDependencyFact => item !== null)
}

function pageSource(root: string, raw: unknown): WikiPageSource | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const pageId = text(record.pageId, 200)
  const name = text(record.name, 120)
  if (pageId === null || name === null) return null
  if (record.kind !== 'module' && record.kind !== 'group') return null
  if (!Array.isArray(record.files) || record.files.length === 0) return null
  const files = record.files
    .slice(0, MAX_FILES_PER_PAGE)
    .map((file) => fileSource(root, file))
    .filter((file): file is WikiPageFileSource => file !== null)
  if (files.length === 0) return null
  const attachedFiles = Array.isArray(record.attachedFiles)
    ? record.attachedFiles
        .slice(0, MAX_FILES_PER_PAGE)
        .map((path) => relPath(root, path))
        .filter((path): path is string => path !== null)
    : []
  const folders = Array.isArray(record.folders)
    ? record.folders
        .slice(0, 120)
        .map((path) => relPath(root, path))
        .filter((path): path is string => path !== null)
    : []
  return {
    pageId,
    kind: record.kind,
    name,
    files,
    attachedFiles,
    folders,
    dependsOn: dependencies(record.dependsOn),
    usedBy: dependencies(record.usedBy)
  }
}

/** 只保留渲染层真的递上来的页 id;没有 only 字段就是全量 */
function onlyIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .slice(0, MAX_PAGES)
    .map((id) => text(id, 200))
    .filter((id): id is string => id !== null)
}

function knownTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const value of raw.slice(0, MAX_TAGS * 2)) {
    const tag = text(value, 24)
    if (tag === null) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

export function parseWikiStart(raw: unknown): WikiStartParse {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '生成请求不完整' }
  const record = raw as Record<string, unknown>
  const requestId = text(record.requestId, 100)
  const language = text(record.language, 20)
  const projectRoot = text(record.projectRoot, 2048)
  if (requestId === null || language === null || projectRoot === null) {
    return { ok: false, error: '生成请求不完整' }
  }
  if (!Array.isArray(record.pages) || record.pages.length === 0) {
    return { ok: false, error: '没有可生成的模块' }
  }
  const seen = new Set<string>()
  const pages: WikiPageSource[] = []
  for (const item of record.pages.slice(0, MAX_PAGES)) {
    const page = pageSource(projectRoot, item)
    if (page === null || seen.has(page.pageId)) continue
    seen.add(page.pageId)
    pages.push(page)
  }
  if (pages.length === 0) return { ok: false, error: '没有可生成的模块' }
  const only = onlyIds(record.only)
  return {
    ok: true,
    request: {
      requestId,
      projectRoot,
      language,
      pages,
      ...(only ? { only } : {}),
      ...(record.force === true ? { force: true } : {}),
      knownTags: knownTags(record.knownTags)
    }
  }
}

/** 项目根:必须是非空绝对路径;是不是真目录交给调用方 stat */
export function parseProjectRoot(raw: unknown): string | null {
  const value = text(raw, 2048)
  return value !== null && isAbsolute(value) ? value : null
}
