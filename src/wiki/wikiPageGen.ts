// 正文生成(原型版):文件职责表由程序列行、模型填句;正文分节生成,每节只喂所需证据,
// 节后做标识符白名单校验(C6);图由程序按引用边生成(C4);出处由程序标注(C5);
// 人话摘要在全部分节完成后按三个固定问题生成(C2)。
import { byCodeUnit } from '../modules/pathOrder.ts'
import type { WikiCompleter, WikiPageEvidence, WikiSegmentNote } from './wikiReadTypes.ts'

const SECTION_SYSTEM =
  '你是技术文档作者,面向不看代码的读者写中文文档。只依据给定证据写作,不使用证据里不存在的文件、函数、类或常量名;引用标识符时用反引号包住。行文具体、克制,不写空话套话,不复述证据原文。'

export interface WikiGenResult {
  markdown: string
  sectionCalls: number
  retries: number
  checkFailedSections: string[]
}

interface SectionOutcome {
  title: string
  text: string
  sources: string
  ok: boolean
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const match = /^[^。.!?]+[。.!?]?/.exec(flat)
  return (match ? match[0] : flat).slice(0, 120)
}

function dutyFallback(path: string, evidence: WikiPageEvidence, notes: WikiSegmentNote[]): string {
  const file = evidence.files.find((f) => f.path === path)
  if (!file) return '本页成员文件'
  if (file.dataFacts && file.dataFacts.length > 0) return file.dataFacts[0]!
  const names = [...new Set(file.symbolRanges.map((r) => r.name))].slice(0, 4)
  void notes
  return names.length > 0 ? `包含 ${names.join('、')} 等符号` : '本页成员文件'
}

/** 一次调用填完全页文件的一句话职责(C5:按文件加页面类型缓存的口径,原型先整页一批) */
async function fillDuties(
  evidence: WikiPageEvidence,
  notes: WikiSegmentNote[],
  complete: WikiCompleter,
  stats: { calls: number }
): Promise<Map<string, string>> {
  const duties = new Map<string, string>()
  const readable = evidence.files.filter((f) => f.tier !== 'list')
  if (readable.length === 0) return duties
  const lines = readable.map((file) => {
    const summary = notes
      .filter((n) => n.path === file.path)
      .map((n) => n.segmentSummary)
      .join(' ')
      .slice(0, 160)
    const facts = file.dataFacts ? file.dataFacts.join(';') : ''
    return `- ${file.path}(角色 ${file.role}):${summary || facts || '无笔记'}`
  })
  const user = [
    `页面「${evidence.pageTitle}」的文件清单与阅读摘要:`,
    ...lines,
    '为每个文件写一句话职责(不超过 40 字,说清它干什么,不复述文件名)。只输出 JSON:{"duties":[{"path":"文件路径","duty":"一句话职责"}]}'
  ].join('\n')
  stats.calls++
  try {
    const raw = await complete(
      '你是文档作者。只依据给定摘要写作,不使用摘要里不存在的标识符。只输出 JSON,不要输出其他文字。',
      user,
      1200
    )
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        duties?: { path?: unknown; duty?: unknown }[]
      }
      for (const item of parsed.duties ?? []) {
        if (typeof item.path === 'string' && typeof item.duty === 'string') {
          duties.set(item.path, item.duty)
        }
      }
    }
  } catch {
    // 填句失败不阻塞:全部走程序兜底
  }
  for (const file of readable) {
    if (!duties.has(file.path)) duties.set(file.path, dutyFallback(file.path, evidence, notes))
  }
  return duties
}

/** C6 白名单:路径必须能在规划内定位;大写开头的标识符必须在本页证据内 */
function checkWhitelist(
  text: string,
  evidence: WikiPageEvidence,
  planPaths: Set<string>
): string[] {
  const allowedIdents = new Set<string>()
  for (const file of evidence.files) {
    for (const range of file.symbolRanges) allowedIdents.add(range.name)
    for (const name of file.structure?.exports ?? []) allowedIdents.add(name)
    for (const name of file.structure?.functions ?? []) allowedIdents.add(name)
    for (const name of file.structure?.classes ?? []) allowedIdents.add(name)
    for (const name of file.structure?.interfaces ?? []) allowedIdents.add(name)
  }
  const memberPaths = new Set(evidence.files.map((f) => f.path))
  const basenames = new Set([...memberPaths, ...planPaths].map((p) => p.split('/').pop() ?? p))
  const violations: string[] = []
  for (const match of text.matchAll(/`([^`]{1,120})`/g)) {
    const span = match[1]!.trim()
    if (span.includes('/') || /\.(ts|tsx|js|jsx|json|md|css|py|go|rs)$/.test(span)) {
      // 只写文件名的按文件名定位;写全路径的必须能在规划内找到
      const located = span.includes('/')
        ? memberPaths.has(span) || planPaths.has(span)
        : basenames.has(span)
      if (!located) violations.push(span)
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(span) && /[A-Z]/.test(span)) {
      if (!allowedIdents.has(span)) violations.push(span)
    }
  }
  return [...new Set(violations)]
}

async function runSection(
  title: string,
  brief: string,
  evidenceText: string,
  sources: string,
  ctx: { complete: WikiCompleter; evidence: WikiPageEvidence; planPaths: Set<string> },
  stats: { calls: number; retries: number }
): Promise<SectionOutcome> {
  const ask = async (extra: string): Promise<string> => {
    stats.calls++
    return ctx.complete(
      SECTION_SYSTEM,
      [
        `页面「${ctx.evidence.pageTitle}」,本节标题:「${title}」。`,
        brief,
        '证据:',
        evidenceText,
        extra
      ].join('\n'),
      1600
    )
  }
  let text = ''
  try {
    text = (await ask('')).trim()
  } catch {
    // 调用失败保持空稿,下面按未通过处理
  }
  let violations =
    text === '' ? ['模型未返回内容'] : checkWhitelist(text, ctx.evidence, ctx.planPaths)
  if (violations.length > 0) {
    stats.retries++
    try {
      const retry = await ask(
        `上一稿不合格:出现了证据里不存在的名称(${violations.join('、')})。重写本节,只使用证据中真实存在的名称。`
      )
      const retryViolations = checkWhitelist(retry, ctx.evidence, ctx.planPaths)
      if (retry.trim() !== '' && retryViolations.length < violations.length) {
        text = retry.trim()
        violations = retryViolations
      }
    } catch {
      // 重写失败保留首稿与校验结论
    }
  }
  return { title, text, sources, ok: text !== '' && violations.length === 0 }
}

function mermaidOf(evidence: WikiPageEvidence): string {
  const nodes = evidence.files.filter((f) => f.role !== 'attached')
  const idOf = new Map(nodes.map((f, i) => [f.path, `f${i}`]))
  const lines = ['```mermaid', 'flowchart LR']
  for (const file of nodes) {
    const label = file.path.split('/').pop()!.replace(/"/g, "'")
    lines.push(`  ${idOf.get(file.path)}["${label}"]`)
  }
  const seen = new Set<string>()
  for (const edge of evidence.internalEdges) {
    if (!idOf.has(edge.from) || !idOf.has(edge.to)) continue
    const key = `${edge.from}->${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    if (seen.size > 20) break
    lines.push(`  ${idOf.get(edge.from)} --> ${idOf.get(edge.to)}`)
  }
  lines.push('```')
  return lines.join('\n')
}

export async function generateWikiPageMarkdown(
  evidence: WikiPageEvidence,
  notes: WikiSegmentNote[],
  deps: { complete: WikiCompleter; planPaths: Set<string>; generatedAt: string }
): Promise<WikiGenResult> {
  const stats = { calls: 0, retries: 0 }
  const checkFailedSections: string[] = []
  const duties = await fillDuties(evidence, notes, deps.complete, stats)
  const ctx = { complete: deps.complete, evidence, planPaths: deps.planPaths }
  const summaries: string[] = []

  const noteLines = (filter: (n: WikiSegmentNote) => boolean): string =>
    notes
      .filter(filter)
      .map(
        (n) =>
          `- ${n.path}:${n.segmentSummary}${n.symbolNotes.length > 0 ? `(${n.symbolNotes.map((s) => `${s.name}:${s.role}`).join(';')})` : ''}`
      )
      .join('\n')

  const sections: SectionOutcome[] = []
  const secA = await runSection(
    '职责与定位',
    '说明这一页负责什么、在项目里处于什么位置、主要由哪些文件构成。用 2 到 4 段写清,不要逐个文件列清单(清单另有表格)。',
    noteLines(() => true),
    evidence.files.map((f) => f.path).join('、'),
    ctx,
    stats
  )
  sections.push(secA)
  summaries.push(firstSentence(secA.text))

  const edgeText =
    evidence.internalEdges.map((e) => `${e.from} -> ${e.to}`).join('\n') || '页内无直接引用边'
  const secB = await runSection(
    '结构与协作',
    '说明页内文件如何分工协作、引用关系说明了什么结构。用 1 到 3 段写清,图由程序附在本节末尾,你只写文字。',
    `${noteLines(() => true)}\n引用边:\n${edgeText}`,
    '页内引用关系与各文件笔记',
    ctx,
    stats
  )
  sections.push(secB)
  summaries.push(firstSentence(secB.text))

  const exportedNames = new Set(evidence.files.flatMap((f) => f.structure?.exports ?? []))
  const secC = await runSection(
    '关键流程与对外接口',
    '说明这一页对外提供什么(导出符号及其作用)、内部有哪些值得注意的流程与副作用。用 2 到 4 段写清,没有对外接口就如实说以内部协作为主。',
    noteLines((n) => n.symbolNotes.some((s) => exportedNames.has(s.name))),
    '导出符号的阅读笔记',
    ctx,
    stats
  )
  sections.push(secC)
  summaries.push(firstSentence(secC.text))

  // 人话摘要(C2):全部分节完成后,按三个固定问题生成
  let intro = ''
  stats.calls++
  try {
    intro = (
      await deps.complete(
        '你面向完全不看代码的读者写产品说明。只依据给定的分节摘要回答,不引入新名词,不复述原文句子。',
        [
          `主题:「${evidence.pageTitle}」`,
          `各节摘要:${summaries.filter((s) => s !== '').join(' ')}`,
          '用一段话依次回答三个问题:这个部分解决什么问题、谁会用到它、没有它会怎样。不超过 200 字。'
        ].join('\n'),
        700
      )
    ).trim()
  } catch {
    // 生成失败保持空,下面用首节摘要兜底
  }
  if (intro === '') intro = summaries.find((s) => s !== '') ?? '本页内容见下文各节。'

  for (const section of sections) {
    if (!section.ok) checkFailedSections.push(section.title)
  }

  const out: string[] = []
  out.push(`# ${evidence.pageTitle}`)
  out.push('')
  out.push(intro)
  out.push('')
  for (const section of sections) {
    out.push(`## ${section.title}`)
    out.push('')
    out.push(section.text === '' ? '（本节证据不足，未能生成。）' : section.text)
    out.push('')
    if (section.title === '结构与协作') {
      out.push(mermaidOf(evidence))
      out.push('')
    }
    out.push(`> 出处:${section.sources}`)
    out.push('')
  }
  out.push('## 文件职责')
  out.push('')
  out.push('| 文件 | 角色 | 一句话职责 |')
  out.push('| --- | --- | --- |')
  for (const file of [...evidence.files].sort((a, b) => byCodeUnit(a.path, b.path))) {
    const duty =
      duties.get(file.path) ?? (file.role === 'attached' ? '附属文件,未单独阅读' : '本页成员文件')
    out.push(`| ${file.path} | ${file.role} | ${duty.replace(/\|/g, ' ')} |`)
  }
  out.push('')
  out.push('## 出处总览')
  out.push('')
  for (const file of evidence.files) {
    const ranges = file.symbolRanges
      .slice(0, 12)
      .map((r) => `${r.name}(${r.startLine}-${r.endLine})`)
      .join('、')
    out.push(
      `- ${file.path}${ranges ? `:${ranges}` : ''}${file.evidenceNote ? `(注:${file.evidenceNote})` : ''}`
    )
  }
  out.push('')
  out.push(`（生成时点:${deps.generatedAt};行号为生成时点的源码行号。）`)
  return {
    markdown: out.join('\n'),
    sectionCalls: stats.calls,
    retries: stats.retries,
    checkFailedSections
  }
}
