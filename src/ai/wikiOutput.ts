// Wiki 输出校验与 Markdown 组装:模型的 JSON 只是解析载体,通过校验才落成给人看的文档。
// 校验失败只回报错误清单(英文,回喂给模型),重试次数由任务层控制。
import {
  WIKI_DOC_MAX_CHARS,
  type WikiPageContent,
  type WikiTruncated
} from '../shared/wikiTypes.ts'
import { isAbsoluteWikiPath, scrubWikiLocalPaths, withWikiRetryNote } from './wikiPrompt.ts'
import type { WikiPromptMessages } from './wikiPrompt.ts'
import { wikiCopy, wikiLanguageLabel } from './wikiCopy.ts'

export interface WikiOutputInput {
  /** 当前页 files/attachedFiles 里的相对路径,keyFiles 只认这些 */
  files: readonly string[]
  attachedFiles?: readonly string[]
  /** 项目里已有的标签,大小写与写法优先沿用 */
  knownTags?: readonly string[]
}

export type WikiOutputResult =
  { ok: true; content: WikiPageContent } | { ok: false; errors: string[] }

export interface WikiMarkdownMeta {
  language: string
  model: string
  /** 记账里的 ISO 时间 */
  generatedAt: string
  truncated: WikiTruncated
}

function charLength(text: string): number {
  return [...text].length
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').replace(/\s+/g, ' ')
}

/** 从整段回复里抠出 JSON 对象:容忍代码围栏与前后废话,只认第一个 { 到最后一个 } */
function extractJsonObject(raw: string): unknown {
  const text = raw.trim().replace(/^\uFEFF/, '')
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  try {
    return JSON.parse(text.slice(first, last + 1))
  } catch {
    return null
  }
}

function normalizeInputPath(relPath: string): string {
  return relPath.trim().replaceAll('\\', '/')
}

function pickTags(record: Record<string, unknown>, knownTags: readonly string[]): string[] {
  const known = new Map<string, string>()
  for (const tag of knownTags) {
    const normalized = normalizeTag(tag)
    if (normalized) known.set(normalized.toLowerCase(), normalized)
  }
  const tags: string[] = []
  const seen = new Set<string>()
  const rawTags = Array.isArray(record.tags) ? record.tags : []
  for (const raw of rawTags) {
    if (typeof raw !== 'string') continue
    const normalized = normalizeTag(raw)
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key) || charLength(normalized) > 12) continue
    seen.add(key)
    tags.push(known.get(key) ?? scrubWikiLocalPaths(normalized))
    if (tags.length === 5) break
  }
  return tags
}

function pickKeyFiles(record: Record<string, unknown>, input: WikiOutputInput): string[] {
  const allowed = new Set([...input.files, ...(input.attachedFiles ?? [])].map(normalizeInputPath))
  const keyFiles: string[] = []
  const rawFiles = Array.isArray(record.keyFiles) ? record.keyFiles : []
  for (const raw of rawFiles) {
    if (typeof raw !== 'string') continue
    const relPath = normalizeInputPath(raw)
    if (!allowed.has(relPath) || isAbsoluteWikiPath(relPath) || keyFiles.includes(relPath)) continue
    keyFiles.push(relPath)
    if (keyFiles.length === 5) break
  }
  return keyFiles
}

/**
 * 逐字段校验(纯函数):name 2-16 字、summary 必填 ≤60、tags 1-5 个且每个 ≤12、
 * keyFiles 只留输入里的路径、doc 必填并在超长时截断标注;其他字段一律丢弃。
 */
export function parseWikiOutput(raw: string, input: WikiOutputInput): WikiOutputResult {
  const parsed = extractJsonObject(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ['the output is not a JSON object'] }
  }
  const record = parsed as Record<string, unknown>
  const errors: string[] = []

  const rawName = typeof record.name === 'string' ? record.name.trim().replace(/\s+/g, ' ') : ''
  const name = scrubWikiLocalPaths(rawName)
  if (!name) errors.push('name is required')
  else if (charLength(name) < 2 || charLength(name) > 16)
    errors.push('name must be 2-16 characters')

  const rawSummary =
    typeof record.summary === 'string' ? record.summary.trim().replace(/\s+/g, ' ') : ''
  const summary = scrubWikiLocalPaths(rawSummary)
  if (!summary) errors.push('summary is required')
  else if (charLength(summary) > 60) errors.push('summary must be at most 60 characters')

  const tags = pickTags(record, input.knownTags ?? [])
  if (tags.length === 0) errors.push('tags must contain 1-5 labels of at most 12 characters each')

  const keyFiles = pickKeyFiles(record, input)

  const rawDoc = typeof record.doc === 'string' ? record.doc.trim() : ''
  let doc = scrubWikiLocalPaths(rawDoc)
  let docTruncated = false
  if (!doc) errors.push('doc is required')
  else if (charLength(doc) > WIKI_DOC_MAX_CHARS) {
    doc = [...doc].slice(0, WIKI_DOC_MAX_CHARS).join('')
    docTruncated = true
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, content: { name, summary, tags, keyFiles, doc, docTruncated } }
}

export type WikiModelRequest = (
  messages: WikiPromptMessages,
  signal?: AbortSignal
) => Promise<string>

export type WikiContentAttempt =
  | { ok: true; content: WikiPageContent; attempts: 1 | 2 }
  | { ok: false; errors: string[]; attempts: 1 | 2 }

/**
 * 一次生成只给两次机会:首答失败时把错误垫进 program_note 再问一遍,
 * 第二遍仍不合规则原样交回错误,由任务层记失败,不再纠缠模型。
 */
export async function requestWikiContent(
  messages: WikiPromptMessages,
  input: WikiOutputInput,
  request: WikiModelRequest,
  signal?: AbortSignal
): Promise<WikiContentAttempt> {
  const first = parseWikiOutput(await request(messages, signal), input)
  if (first.ok) return { ok: true, content: first.content, attempts: 1 }
  const second = parseWikiOutput(
    await request(withWikiRetryNote(messages, first.errors), signal),
    input
  )
  if (second.ok) return { ok: true, content: second.content, attempts: 2 }
  return { ok: false, errors: second.errors, attempts: 2 }
}

const EXCERPT_MAX_CHARS = 140

/** 标题、代码围栏与分隔线不是正文,摘录时跳过 */
function isExcerptNoise(line: string): boolean {
  return (
    line === '' || line.startsWith('#') || /^(`{3,}|~{3,})/.test(line) || /^[-*_]{3,}$/.test(line)
  )
}

/** 侧栏摘要:跳过标题、代码围栏与空行,取正文第一段,压成一行;超出上限按字截断 */
export function wikiDocExcerpt(doc: string): string {
  const paragraph = doc
    .split('\n')
    .map((line) => line.trim())
    .find((line) => !isExcerptNoise(line))
  if (paragraph === undefined) return ''
  const text = paragraph.replace(/^[\s>#*+-]+/, '').replace(/\s+/g, ' ')
  const chars = [...text]
  return chars.length > EXCERPT_MAX_CHARS ? `${chars.slice(0, EXCERPT_MAX_CHARS).join('')}…` : text
}

function formatWikiTime(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso)
  return match ? `${match[1]} ${match[2]}` : iso
}

function codeSpan(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``
}

/** 把校验后的内容写成固定结构的 Markdown;固定文案查 8 语种表 */
export function renderWikiMarkdown(content: WikiPageContent, meta: WikiMarkdownMeta): string {
  const copy = wikiCopy(meta.language)
  const tagLine = content.tags.length > 0 ? content.tags.join(' · ') : '—'
  const keyLine = content.keyFiles.length > 0 ? content.keyFiles.map(codeSpan).join(' · ') : '—'
  const lines = [
    `# ${content.name}`,
    '',
    `> ${content.summary}`,
    '',
    `- ${copy.tags}: ${tagLine}`,
    `- ${copy.keyFiles}: ${keyLine}`,
    `- ${copy.generatedAt}: ${formatWikiTime(meta.generatedAt)} · ${copy.model}: ${meta.model} · ${copy.language}: ${wikiLanguageLabel(meta.language)}`
  ]
  const truncated = meta.truncated
  if (truncated.files > 0 || truncated.symbols > 0 || truncated.excerpts > 0) {
    lines.push(
      `- ${copy.truncated}: ${copy.truncatedFiles} ${truncated.files} · ${copy.truncatedSymbols} ${truncated.symbols} · ${copy.truncatedExcerpts} ${truncated.excerpts}`
    )
  }
  if (content.docTruncated) lines.push(`- ${copy.truncatedDoc}`)
  lines.push('', content.doc, '')
  return lines.join('\n')
}
