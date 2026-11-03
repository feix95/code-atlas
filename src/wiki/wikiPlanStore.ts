// 规划落盘与新页路径:规划文件读写、主题树路径分配、新路径安全校验。
// 规划是独立文件,不塞进记账,避免记账随成员信息膨胀;路径只依赖规划本身,可复现。
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { WikiPlan } from './wikiPlanTypes.ts'
import {
  WIKI_STATE_DIR,
  isObject,
  sanitizeFileName,
  shortProjectCode,
  writeFileAtomic
} from './wikiStore.ts'

export const WIKI_PLAN_FILE = 'plan.json'
/** 自语种目录起算的相对路径上限:给 Wiki 根目录留出 Windows 整路径余量 */
export const MAX_PAGE_FILE_LENGTH = 200

export function wikiPlanFilePath(projectDir: string): string {
  return join(projectDir, WIKI_STATE_DIR, WIKI_PLAN_FILE)
}

/** 新页路径安全校验:语种目录内的任意层级相对路径,不越界、不超长、必须是 Markdown */
export function isSafePageFileV2(file: string): boolean {
  if (file.length === 0 || file.length > MAX_PAGE_FILE_LENGTH) return false
  if (file.includes('\\') || file.startsWith('/')) return false
  const parts = file.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false
  const last = parts[parts.length - 1]!
  return last.endsWith('.md') && last.length > 3
}

/** 一段超长时截短并加短哈希后缀保唯一 */
function shrinkSegment(segment: string, max: number, seed: string): string {
  if (segment.length <= max) return segment
  const suffix = `-${shortProjectCode(seed)}`
  return segment.slice(0, Math.max(4, max - suffix.length)) + suffix
}

/**
 * 按主题树给每页分配文件:根页在语种目录根,总览页以主题名落在父层,
 * 叶子页落在主题目录链下;相对路径超限时逐段截短并加短哈希后缀。
 */
export function allocatePlanFiles(plan: WikiPlan): Map<string, string> {
  const topicById = new Map<string, WikiPlan['topics'][number]>()
  const parentOf = new Map<string, string | null>()
  const walk = (topics: WikiPlan['topics'], parent: string | null): void => {
    for (const topic of topics) {
      topicById.set(topic.id, topic)
      parentOf.set(topic.id, parent)
      walk(topic.children, topic.id)
    }
  }
  walk(plan.topics, null)
  const chainOf = (topicId: string | null): string[] => {
    const chain: string[] = []
    let current = topicId
    while (current !== null) {
      const topic = topicById.get(current)
      if (!topic) break
      chain.unshift(sanitizeFileName(topic.title))
      current = parentOf.get(current) ?? null
    }
    return chain
  }
  const raw = new Map<string, string>()
  for (const page of plan.pages) {
    let parts: string[]
    if (page.kind === 'root') {
      parts = [`${sanitizeFileName(page.title)}.md`]
    } else if (page.kind === 'overview') {
      const topic = page.topicId !== null ? topicById.get(page.topicId) : undefined
      const parentChain = chainOf(
        page.topicId !== null ? (parentOf.get(page.topicId) ?? null) : null
      )
      parts = [...parentChain, `${sanitizeFileName(topic?.title ?? page.title)}.md`]
    } else {
      parts = [...chainOf(page.topicId), `${sanitizeFileName(page.title)}.md`]
    }
    raw.set(page.id, parts.join('/'))
  }
  // 超长处理与撞名处理:逐页确定,结果只依赖规划本身,可复现
  const used = new Map<string, string>()
  const result = new Map<string, string>()
  for (const page of plan.pages) {
    let file = raw.get(page.id)!
    if (file.length > MAX_PAGE_FILE_LENGTH) {
      const parts = file.split('/')
      const shrunk = parts.map((part, i) => {
        if (i < parts.length - 1) return shrinkSegment(part, 28, `${page.id}:${part}`)
        // 文件段先剥扩展名再截短,截完拼回,保证仍以 .md 结尾
        return `${shrinkSegment(part.slice(0, -3), 44, `${page.id}:${part}`)}.md`
      })
      file = shrunk.join('/')
      if (file.length > MAX_PAGE_FILE_LENGTH) {
        // 仍超限:只保留最后两层
        file = shrunk.slice(-2).join('/')
      }
    }
    let candidate = file
    let n = 1
    while (used.has(candidate.toLowerCase()) && used.get(candidate.toLowerCase()) !== page.id) {
      n++
      const suffix = `-${shortProjectCode(page.id)}${n > 2 ? `-${n}` : ''}`
      candidate = file.replace(/\.md$/, `${suffix}.md`)
    }
    used.set(candidate.toLowerCase(), page.id)
    result.set(page.id, candidate)
  }
  return result
}

/** 规划文件读写:结构做基本校验,损坏按记账损坏同等对待 */
export type ReadPlanResult =
  { status: 'missing' } | { status: 'damaged'; reason: string } | { status: 'ok'; plan: WikiPlan }

export async function writeWikiPlanFile(projectDir: string, plan: WikiPlan): Promise<void> {
  await writeFileAtomic(wikiPlanFilePath(projectDir), JSON.stringify(plan, null, 2))
}

export async function readWikiPlanFile(projectDir: string): Promise<ReadPlanResult> {
  const raw = await fs
    .readFile(wikiPlanFilePath(projectDir), 'utf8')
    .catch((err: NodeJS.ErrnoException) => err)
  if (raw instanceof Error) {
    if (raw.code === 'ENOENT') return { status: 'missing' }
    return { status: 'damaged', reason: `规划文件读不了:${raw.code ?? '未知错误'}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'damaged', reason: '规划文件不是合法 JSON' }
  }
  if (!isObject(parsed) || typeof parsed.version !== 'number') {
    return { status: 'damaged', reason: '规划文件结构不认识' }
  }
  if (!Array.isArray(parsed.pages) || !Array.isArray(parsed.topics)) {
    return { status: 'damaged', reason: '规划文件结构不认识' }
  }
  for (const page of parsed.pages as unknown[]) {
    if (!isObject(page) || typeof page.id !== 'string' || typeof page.title !== 'string') {
      return { status: 'damaged', reason: '规划文件页面结构不认识' }
    }
    if (page.kind !== 'leaf' && page.kind !== 'overview' && page.kind !== 'root') {
      return { status: 'damaged', reason: '规划文件页面结构不认识' }
    }
    if (!Array.isArray(page.members)) {
      return { status: 'damaged', reason: '规划文件页面结构不认识' }
    }
  }
  return { status: 'ok', plan: parsed as unknown as WikiPlan }
}
