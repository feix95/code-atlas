// 阅读账本与笔记形状处理:账本按缓存键存取结构化笔记(B4),落盘为 JSON;
// parseNote 把模型输出收敛成结构化笔记,degradedNote 是模型失败时按事实层兜底的登记。
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { WikiSegment, WikiSegmentNote, WikiSymbolNote } from './wikiReadTypes.ts'

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

export function parseNote(
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
export function degradedNote(segment: WikiSegment, kindOf: Map<string, string>): WikiSegmentNote {
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
      crossRefs: [],
      degraded: true
    })),
    segmentSummary: names.size > 0 ? `包含符号 ${[...names].join(', ')}` : '导入与声明段',
    degraded: true
  }
}
