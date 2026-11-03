// 解读层:逐段生成结构化阅读笔记(B3),按账本缓存(B4),程序做覆盖校验(B5)。
// 段与段之间不靠模型自由文本传话:上下文由程序拼装,固定带文件结构前缀,
// 并按符号名重合从既有笔记里挑跨段注意一并携带。
import {
  noteCacheKey,
  type WikiCompleter,
  type WikiPageEvidence,
  type WikiSegment,
  type WikiSegmentNote
} from './wikiReadTypes.ts'
import { degradedNote, parseNote, WikiNoteLedger } from './wikiLedger.ts'
export { WikiNoteLedger } from './wikiLedger.ts'

const NOTE_SYSTEM = [
  '你是代码阅读员。只依据给定的代码段做阅读笔记,不推测代码里没有的内容,不使用代码里不存在的标识符。',
  '段内每个符号都要有一条记录,一条都不能漏。role 不超过 30 字,deps 最多 3 个,crossRefs 最多 2 条,写紧凑些。',
  '只输出一个 JSON 对象,不要输出任何其他文字。格式:',
  '{"symbols":[{"name":"符号名","role":"一句话作用","deps":["依赖的符号或模块名"],"sideEffects":"副作用,没有写 无","crossRefs":["需要跨段注意的点,没有留空数组"]}],"summary":"本段一句话摘要"}'
].join('\n')

function structurePrefix(evidence: WikiPageEvidence, segment: WikiSegment): string {
  const path = segment.path
  const file = evidence.files.find((f) => f.path === path)
  if (!file || file.structure === null) return `文件:${path}`
  let ranges = file.symbolRanges
  if (ranges.length > 15) {
    // 符号多的文件只带本段附近符号:整表每段重复携带,预填充成本太高
    const hit = ranges
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.endLine >= segment.startLine && r.startLine <= segment.endLine)
    const from = Math.max(0, (hit[0]?.i ?? 0) - 2)
    const to = Math.min(ranges.length - 1, (hit[hit.length - 1]?.i ?? 0) + 2)
    ranges = ranges.slice(from, to + 1)
  }
  const symbols = ranges.map((r) => `${r.name}(${r.kind} ${r.startLine}-${r.endLine})`).join('、')
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

export interface WikiNotesResult {
  notes: WikiSegmentNote[]
  calls: number
  retries: number
  degraded: number
  /** 账本命中、没有调用模型的段数(复跑成本观察用) */
  cacheHits: number
  /** 笔记失败的段与原因(段 id:调用失败 / 无法解析),供复测定位 */
  failures: string[]
  /** 失败段的原始输出摘录,供定性解析坏在哪一段 */
  rawFailures: { segmentId: string; reason: string; raw: string }[]
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
  let cacheHits = 0
  const failures: string[] = []
  const rawFailures: { segmentId: string; reason: string; raw: string }[] = []
  const fileOf = new Map(evidence.files.map((f) => [f.path, f]))

  const symbolsInside = (
    file: (typeof evidence.files)[number],
    segment: WikiSegment
  ): typeof file.symbolRanges =>
    file.symbolRanges.filter(
      (r) => r.startLine >= segment.startLine && r.endLine <= segment.endLine
    )

  /** 一次笔记尝试:成功返回笔记,失败返回 null 加失败原因与原始输出(调用失败还是解析失败) */
  const attempt = async (
    segment: WikiSegment,
    opts: { hint?: string; boost?: number }
  ): Promise<{ note: WikiSegmentNote | null; failure: string | null; raw: string }> => {
    const file = fileOf.get(segment.path)!
    calls++
    const numbered = segment.text
      .split('\n')
      .map((line, i) => `${segment.startLine + i}: ${line}`)
      .join('\n')
    const user = [
      structurePrefix(evidence, segment),
      `本段:${segment.path} 第 ${segment.startLine}-${segment.endLine} 行${segment.symbolName ? `(主体符号 ${segment.symbolName})` : ''}`,
      relatedNotes(segment, notes),
      '代码:',
      numbered,
      opts.hint ?? ''
    ].join('\n')
    const validNames = new Set(file.symbolRanges.map((r) => r.name))
    // 输出额按段内符号数给:逐符号成条,符号多的段给少了会被截断成废 JSON
    const count = Math.max(1, symbolsInside(file, segment).length)
    const maxTokens = Math.min(3000, Math.round((500 + 120 * count) * (opts.boost ?? 1)))
    let raw: string
    try {
      raw = await deps.complete(NOTE_SYSTEM, user, maxTokens)
    } catch {
      return { note: null, failure: '模型调用失败', raw: '' }
    }
    const parsed = parseNote(raw, segment, validNames)
    return parsed !== null
      ? { note: parsed, failure: null, raw }
      : { note: null, failure: '输出无法解析为结构化笔记', raw }
  }

  const recordFailure = (segmentId: string, failure: string | null, raw: string): void => {
    failures.push(`${segmentId}:${failure ?? '笔记失败'}`)
    rawFailures.push({ segmentId, reason: failure ?? '笔记失败', raw: raw.slice(0, 4000) })
  }

  /** 单符号子段:先查子段缓存,失败带提示加额再试一次;成功按子段键入缓存,失败返回占位 */
  const runSubSegment = async (
    parent: WikiSegment,
    range: (typeof evidence.files)[number]['symbolRanges'][number]
  ): Promise<WikiSegmentNote> => {
    const file = fileOf.get(parent.path)!
    const kindOf = new Map(file.symbolRanges.map((r) => [r.name, r.kind]))
    const lines = parent.text.split('\n')
    const sub: WikiSegment = {
      id: `${parent.id}:${range.name}`,
      path: parent.path,
      kind: 'symbol',
      symbolName: range.name,
      startLine: range.startLine,
      endLine: range.endLine,
      text: lines
        .slice(range.startLine - parent.startLine, range.endLine - parent.startLine + 1)
        .join('\n'),
      estTokens: 0
    }
    const subKey = noteCacheKey(sub.path, file.contentHash ?? '', sub.id, deps.modelId)
    const cachedSub = deps.ledger.get(subKey)
    if (cachedSub) {
      cacheHits++
      return cachedSub
    }
    // 子段成功多一道判定:笔记里必须真有目标符号的条目。
    // 只看能不能解析,会把「读错代码写出的笔记」当成功存进缓存(真机实测教训)
    const hitsTarget = (note: WikiSegmentNote): boolean =>
      note.symbolNotes.some((s) => s.name === range.name && s.degraded !== true)
    retries++
    const first = await attempt(sub, { hint: '只输出 JSON 对象本身,不要输出任何解释文字。' })
    if (first.note !== null && hitsTarget(first.note)) {
      deps.ledger.set(subKey, first.note)
      return first.note
    }
    const firstReason = first.note !== null ? '笔记未包含目标符号' : (first.failure ?? '笔记失败')
    retries++
    const second = await attempt(sub, {
      hint: '只输出 JSON 对象本身,不要输出任何解释文字。',
      boost: 1.5
    })
    if (second.note !== null && hitsTarget(second.note)) {
      deps.ledger.set(subKey, second.note)
      return second.note
    }
    const secondReason =
      second.note !== null ? '笔记未包含目标符号' : (second.failure ?? firstReason)
    recordFailure(sub.id, secondReason, second.raw || first.raw)
    return degradedNote(sub, kindOf)
  }

  const runSegment = async (segment: WikiSegment, isRetry: boolean): Promise<WikiSegmentNote> => {
    const file = fileOf.get(segment.path)!
    const key = noteCacheKey(segment.path, file.contentHash ?? '', segment.id, deps.modelId)
    const cached = deps.ledger.get(key)
    if (cached && !isRetry) {
      cacheHits++
      return cached
    }
    if (isRetry) retries++
    const kindOf = new Map(file.symbolRanges.map((r) => [r.name, r.kind]))
    const first = await attempt(segment, {})
    if (first.note !== null) {
      deps.ledger.set(key, first.note)
      return first.note
    }
    // 首试失败也留一份原始输出:靠拆分兜住时,不留就看不到首试为什么失败
    rawFailures.push({
      segmentId: segment.id,
      reason: `${first.failure ?? '笔记失败'}(整段首试)`,
      raw: first.raw.slice(0, 4000)
    })
    // 升级重试:多符号段拆成单符号子段逐个记(整段反复失败时,小步通常能过),
    // 子段各自缓存、各自成败,合并结果不整段入缓存,免得占位条目混进去冒充读过;
    // 单符号段带格式提示并加五成输出额再试一次。仍失败才降级,原因记入统计。
    const inside = symbolsInside(file, segment)
    if (inside.length >= 2) {
      const subs: WikiSegmentNote[] = []
      for (const range of inside) {
        subs.push(await runSubSegment(segment, range))
      }
      return {
        segmentId: segment.id,
        path: segment.path,
        symbolNotes: subs.flatMap((s) => s.symbolNotes),
        segmentSummary: subs
          .map((s) => s.segmentSummary)
          .filter((s) => s !== '')
          .join('；'),
        degraded: subs.every((s) => s.degraded)
      }
    }
    retries++
    const second = await attempt(segment, {
      hint: '只输出 JSON 对象本身,不要输出任何解释文字。',
      boost: 1.5
    })
    if (second.note !== null) {
      deps.ledger.set(key, second.note)
      return second.note
    }
    recordFailure(segment.id, second.failure ?? first.failure, second.raw || first.raw)
    return degradedNote(segment, kindOf)
  }

  for (const file of evidence.files) {
    if (file.tier !== 'full' && file.tier !== 'slice') continue
    for (const segment of file.segments) {
      notes.push(await runSegment(segment, false))
    }
  }

  // 覆盖校验(B5):按符号条目判断,程序占位条目不算覆盖;
  // 缺口符号(不分导出与否)逐个用单符号子段补记,单页补记设上限,不整段重跑
  const coveredOf = (path: string): Set<string> => {
    const covered = new Set<string>()
    for (const note of notes) {
      if (note.path !== path) continue
      for (const symbol of note.symbolNotes) {
        if (symbol.degraded !== true) covered.add(symbol.name)
      }
    }
    return covered
  }
  let symbolsTotal = 0
  let symbolsCovered = 0
  let repairsLeft = 8
  const coverageGaps: string[] = []
  for (const file of evidence.files) {
    if (file.tier !== 'full' && file.tier !== 'slice') continue
    // 嵌套在其他符号内部的函数折叠进父符号,不单独计覆盖(父符号的笔记应一并讲它)
    const topLevel = file.symbolRanges.filter(
      (r) =>
        !file.symbolRanges.some(
          (o) =>
            o !== r &&
            o.startLine <= r.startLine &&
            o.endLine >= r.endLine &&
            (o.startLine < r.startLine || o.endLine > r.endLine)
        )
    )
    const required = [...new Set(topLevel.map((r) => r.name))]
    symbolsTotal += required.length
    let covered = coveredOf(file.path)
    const missing = required.filter((name) => !covered.has(name))
    for (const name of missing) {
      if (repairsLeft <= 0) break
      const range = topLevel.find((r) => r.name === name)
      const parent = file.segments.find(
        (s) => range !== undefined && range.startLine >= s.startLine && range.endLine <= s.endLine
      )
      if (range === undefined || parent === undefined) continue
      repairsLeft--
      const repaired = await runSubSegment(parent, range)
      if (!repaired.degraded) {
        notes.push(repaired)
        covered = coveredOf(file.path)
      }
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
    cacheHits,
    failures: [...new Set(failures)],
    rawFailures,
    symbolsTotal,
    symbolsCovered,
    coverageGaps
  }
}
