// 解读层:逐段生成结构化阅读笔记(B3),按账本缓存(B4),程序做覆盖校验(B5)。
// 段与段之间不靠模型自由文本传话:上下文由程序拼装,固定带文件结构前缀,
// 并按符号名重合从既有笔记里挑跨段注意一并携带。
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  noteCacheKey,
  type WikiCompleter,
  type WikiPageEvidence,
  type WikiSegment,
  type WikiSegmentNote,
  type WikiSymbolNote
} from './wikiReadTypes.ts'

const NOTE_SYSTEM = [
  '你是代码阅读员。只依据给定的代码段做阅读笔记,不推测代码里没有的内容,不使用代码里不存在的标识符。',
  '只输出一个 JSON 对象,不要输出任何其他文字。格式:',
  '{"symbols":[{"name":"符号名","role":"一句话作用","deps":["依赖的符号或模块名"],"sideEffects":"副作用,没有写 无","crossRefs":["需要跨段注意的点,没有留空数组"]}],"summary":"本段一句话摘要"}'
].join('\n')

export class WikiNoteLedger {
  private entries = new Map<string, WikiSegmentNote>()

  get(key: string): WikiSegmentNote | undefined {
    return this.entries.get(key)
  }

  set(key: string, note: WikiSegmentNote): void {
    this.entries.set(key, note)
  }

  get size(): number {
    return this.entries.size
  }

  static async load(dir: string): Promise<WikiNoteLedger> {
    const ledger = new WikiNoteLedger()
    try {
      const raw = await fs.readFile(join(dir, 'wiki-note-ledger.json'), 'utf8')
      const parsed = JSON.parse(raw) as { entries?: Record<string, WikiSegmentNote> }
      for (const [key, note] of Object.entries(parsed.entries ?? {})) ledger.entries.set(key, note)
    } catch {
      // 没有账本文件就从空账本开始
    }
    return ledger
  }

  async save(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
    const entries: Record<string, WikiSegmentNote> = {}
    for (const [key, note] of this.entries) entries[key] = note
    await fs.writeFile(
      join(dir, 'wiki-note-ledger.json'),
      JSON.stringify({ version: 1, entries }, null, 2),
      'utf8'
    )
  }
}

function structurePrefix(evidence: WikiPageEvidence, path: string): string {
  const file = evidence.files.find((f) => f.path === path)
  if (!file || file.structure === null) return `文件:${path}`
  const symbols = file.symbolRanges
    .map((r) => `${r.name}(${r.kind} ${r.startLine}-${r.endLine})`)
    .join('、')
  return [
    `文件:${path}(${file.languageId || '未知语言'})`,
    `导出:${file.structure.exports.join(', ') || '无'}`,
    `符号清单:${symbols || '无'}`
  ].join('\n')
}

/** 程序挑跨段注意:同文件既有笔记中,符号名出现在本段代码里的,取前 3 条 */
function relatedNotes(segment: WikiSegment, prior: WikiSegmentNote[]): string {
  const picked: string[] = []
  for (const note of prior) {
    if (note.path !== segment.path) continue
    for (const symbol of note.symbolNotes) {
      if (picked.length >= 3) break
      if (segment.text.includes(symbol.name)) {
        picked.push(
          `- ${symbol.name}:${symbol.role}${symbol.crossRefs.length > 0 ? `(注意:${symbol.crossRefs.join(';')})` : ''}`
        )
      }
    }
  }
  return picked.length > 0 ? `\n相关既有笔记:\n${picked.join('\n')}` : ''
}

function parseNote(
  raw: string,
  segment: WikiSegment,
  validNames: Set<string>
): WikiSegmentNote | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      symbols?: unknown
      summary?: unknown
    }
    if (!Array.isArray(parsed.symbols)) return null
    const symbolNotes: WikiSymbolNote[] = []
    for (const item of parsed.symbols) {
      const entry = item as Record<string, unknown>
      const name = typeof entry.name === 'string' ? entry.name : ''
      if (name === '' || !validNames.has(name)) continue
      symbolNotes.push({
        name,
        role: typeof entry.role === 'string' ? entry.role : '',
        deps: Array.isArray(entry.deps)
          ? entry.deps.filter((d): d is string => typeof d === 'string')
          : [],
        sideEffects: typeof entry.sideEffects === 'string' ? entry.sideEffects : '',
        crossRefs: Array.isArray(entry.crossRefs)
          ? entry.crossRefs.filter((c): c is string => typeof c === 'string')
          : []
      })
    }
    return {
      segmentId: segment.id,
      path: segment.path,
      symbolNotes,
      segmentSummary: typeof parsed.summary === 'string' ? parsed.summary : '',
      degraded: false
    }
  } catch {
    return null
  }
}

/** 模型失败时的兜底笔记:只按事实层登记符号,不冒充读过 */
function degradedNote(segment: WikiSegment, kindOf: Map<string, string>): WikiSegmentNote {
  const names = new Set<string>()
  if (segment.symbolName !== null) names.add(segment.symbolName)
  return {
    segmentId: segment.id,
    path: segment.path,
    symbolNotes: [...names].map((name) => ({
      name,
      role: `${kindOf.get(name) ?? '符号'} ${name}(程序按结构登记,模型笔记缺失)`,
      deps: [],
      sideEffects: '未确认',
      crossRefs: []
    })),
    segmentSummary: names.size > 0 ? `包含符号 ${[...names].join(', ')}` : '导入与声明段',
    degraded: true
  }
}

export interface WikiNotesResult {
  notes: WikiSegmentNote[]
  calls: number
  retries: number
  degraded: number
  symbolsTotal: number
  symbolsCovered: number
  coverageGaps: string[]
}

export async function generateSegmentNotes(
  evidence: WikiPageEvidence,
  deps: { complete: WikiCompleter; modelId: string; ledger: WikiNoteLedger }
): Promise<WikiNotesResult> {
  const notes: WikiSegmentNote[] = []
  let calls = 0
  let retries = 0
  const fileOf = new Map(evidence.files.map((f) => [f.path, f]))

  const runSegment = async (segment: WikiSegment, isRetry: boolean): Promise<WikiSegmentNote> => {
    const file = fileOf.get(segment.path)!
    const cached = deps.ledger.get(
      noteCacheKey(segment.path, file.contentHash ?? '', segment.id, deps.modelId)
    )
    if (cached && !isRetry) return cached
    calls++
    if (isRetry) retries++
    const numbered = segment.text
      .split('\n')
      .map((line, i) => `${segment.startLine + i}: ${line}`)
      .join('\n')
    const user = [
      structurePrefix(evidence, segment.path),
      `本段:${segment.path} 第 ${segment.startLine}-${segment.endLine} 行${segment.symbolName ? `(主体符号 ${segment.symbolName})` : ''}`,
      relatedNotes(segment, notes),
      '代码:',
      numbered
    ].join('\n')
    const validNames = new Set(file.symbolRanges.map((r) => r.name))
    let note: WikiSegmentNote | null = null
    try {
      note = parseNote(await deps.complete(NOTE_SYSTEM, user, 1100), segment, validNames)
    } catch {
      // 调用失败保持 null,下面走降级笔记
    }
    if (note === null) {
      const kindOf = new Map(file.symbolRanges.map((r) => [r.name, r.kind]))
      return degradedNote(segment, kindOf)
    }
    deps.ledger.set(
      noteCacheKey(segment.path, file.contentHash ?? '', segment.id, deps.modelId),
      note
    )
    return note
  }

  for (const file of evidence.files) {
    if (file.tier !== 'full' && file.tier !== 'slice') continue
    for (const segment of file.segments) {
      notes.push(await runSegment(segment, false))
    }
  }

  // 覆盖校验(B5):重要符号(导出符号)未入笔记的,对其所在段补跑一次
  const coveredOf = (path: string): Set<string> => {
    const covered = new Set<string>()
    for (const note of notes) {
      if (note.path !== path || note.degraded) continue
      for (const symbol of note.symbolNotes) covered.add(symbol.name)
    }
    return covered
  }
  let symbolsTotal = 0
  let symbolsCovered = 0
  const coverageGaps: string[] = []
  for (const file of evidence.files) {
    if (file.tier !== 'full' && file.tier !== 'slice') continue
    const required = [...new Set(file.symbolRanges.map((r) => r.name))]
    symbolsTotal += required.length
    let covered = coveredOf(file.path)
    const important = required.filter((name) => (file.structure?.exports ?? []).includes(name))
    const missingImportant = important.filter((name) => !covered.has(name))
    if (missingImportant.length > 0) {
      for (const segment of file.segments) {
        const segmentSymbols = file.symbolRanges
          .filter((r) => r.startLine >= segment.startLine && r.endLine <= segment.endLine)
          .map((r) => r.name)
        if (!segmentSymbols.some((name) => missingImportant.includes(name))) continue
        const index = notes.findIndex((n) => n.segmentId === segment.id)
        const fresh = await runSegment(segment, true)
        if (index >= 0) notes[index] = fresh
      }
      covered = coveredOf(file.path)
    }
    for (const name of required) {
      if (covered.has(name)) symbolsCovered++
      else coverageGaps.push(`${file.path}:${name}`)
    }
  }

  return {
    notes,
    calls,
    retries,
    degraded: notes.filter((n) => n.degraded).length,
    symbolsTotal,
    symbolsCovered,
    coverageGaps
  }
}
