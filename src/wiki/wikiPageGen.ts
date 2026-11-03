// 正文生成(原型版):文件职责表由程序列行、模型填句;正文分节生成,每节只喂所需证据,
// 节后做标识符白名单校验(C6);图由程序按引用边生成(C4);出处由程序标注(C5);
// 人话摘要在全部分节完成后按三个固定问题生成(C2)。
import { byCodeUnit } from '../modules/pathOrder.ts'
import type { WikiCompleter, WikiPageEvidence, WikiSegmentNote } from './wikiReadTypes.ts'
import { balanceInlineCode, checkWhitelist, mermaidOf } from './wikiPageCheck.ts'

const SECTION_SYSTEM =
  '你是技术文档作者,面向不看代码的读者写中文文档。只依据给定证据写作,不使用证据里不存在的文件、函数、类或常量名;引用标识符时用反引号包住。行文具体、克制,不写空话套话,不复述证据原文。'

export interface WikiGenResult {
  markdown: string
  sectionCalls: number
  retries: number
  checkFailedSections: string[]
  /** 校验未过的具体违规名,逐节记录,便于复测定位(节名:违规名) */
  checkDetails: string[]
}

interface SectionOutcome {
  title: string
  text: string
  sources: string
  ok: boolean
  violations: string[]
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
    // 全段摘要都要进:只取开头一段会把多段文件的职责写成首段的样子(真机实测教训)
    const summary = notes
      .filter((n) => n.path === file.path)
      .map((n) => n.segmentSummary.slice(0, 70))
      .join('；')
      .slice(0, 800)
    const exportRoles = notes
      .filter((n) => n.path === file.path)
      .flatMap((n) => n.symbolNotes)
      .filter((s) => (file.structure?.exports ?? []).includes(s.name))
      .map((s) => `${s.name}:${s.role}`)
      .join('；')
      .slice(0, 300)
    const facts = file.dataFacts ? file.dataFacts.join(';') : ''
    return `- ${file.path}(角色 ${file.role}):${[summary, exportRoles, facts].filter((s) => s !== '').join(' | ') || '无笔记'}`
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
  return {
    title,
    text: balanceInlineCode(text),
    sources,
    ok: text !== '' && violations.length === 0,
    violations
  }
}

export async function generateWikiPageMarkdown(
  evidence: WikiPageEvidence,
  notes: WikiSegmentNote[],
  deps: {
    complete: WikiCompleter
    planPaths: Set<string>
    generatedAt: string
    coverageGaps?: string[]
  }
): Promise<WikiGenResult> {
  const stats = { calls: 0, retries: 0 }
  const checkFailedSections: string[] = []
  const checkDetails: string[] = []
  const duties = await fillDuties(evidence, notes, deps.complete, stats)
  const ctx = { complete: deps.complete, evidence, planPaths: deps.planPaths }
  const summaries: string[] = []

  // 证据排序:主角文件在前,同角色按符号数多的在前,免得配角证据排在前面带偏正文
  const fileRank = new Map(
    [...evidence.files]
      .sort((a, b) => {
        const roleDiff = (a.role === 'primary' ? 0 : 1) - (b.role === 'primary' ? 0 : 1)
        return roleDiff !== 0 ? roleDiff : b.symbolRanges.length - a.symbolRanges.length
      })
      .map((f, i) => [f.path, i])
  )
  const noteLines = (filter: (n: WikiSegmentNote) => boolean): string =>
    notes
      .filter(filter)
      .sort((a, b) => (fileRank.get(a.path) ?? 99) - (fileRank.get(b.path) ?? 99))
      .map(
        (n) =>
          `- ${n.path}:${n.segmentSummary}${n.symbolNotes.length > 0 ? `(${n.symbolNotes.map((s) => `${s.name}:${s.role}`).join(';')})` : ''}`
      )
      .join('\n')
  const primaryPaths = evidence.files
    .filter((f) => f.role === 'primary')
    .map((f) => f.path)
    .join('、')

  const sections: SectionOutcome[] = []
  const secA = await runSection(
    '职责与定位',
    `说明这一页负责什么、在项目里处于什么位置、主要由哪些文件构成。本页主角文件是:${primaryPaths}。正文必须以主角文件为中心,配角只作补充。用 2 到 4 段写清,不要逐个文件列清单(清单另有表格)。`,
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
    `逐个讲清主角文件(${primaryPaths})的导出符号及其作用,再写内部值得注意的流程与副作用。某个主角文件的证据不足时,如实写该文件证据不足,不许拿别的文件的内容替它凑篇幅。用 2 到 4 段写清,没有对外接口就如实说以内部协作为主。`,
    noteLines((n) => n.symbolNotes.some((s) => exportedNames.has(s.name))),
    '导出符号的阅读笔记',
    ctx,
    stats
  )
  sections.push(secC)
  summaries.push(firstSentence(secC.text))

  // 人话摘要(C2):全部分节完成后,按三个固定问题生成;同样过白名单,不过关宁可不用
  const askIntro = async (extra: string): Promise<string> => {
    stats.calls++
    return (
      await deps.complete(
        '你面向完全不看代码的读者写产品说明。只依据给定的分节摘要回答,不引入新名词,不复述原文句子。',
        [
          `主题:「${evidence.pageTitle}」`,
          `各节摘要:${summaries.filter((s) => s !== '').join(' ')}`,
          '用一段话依次回答三个问题:这个部分解决什么问题、谁会用到它、没有它会怎样。不超过 200 字。',
          extra
        ].join('\n'),
        700
      )
    ).trim()
  }
  let intro = ''
  try {
    intro = await askIntro('')
  } catch {
    // 生成失败保持空,下面用首节摘要兜底
  }
  if (intro !== '' && checkWhitelist(intro, evidence, deps.planPaths).length > 0) {
    try {
      const retry = await askIntro('注意:只使用分节摘要里真实出现的名称,不要引入任何新名称。')
      intro = checkWhitelist(retry, evidence, deps.planPaths).length === 0 ? retry : ''
    } catch {
      intro = ''
    }
  }
  if (intro === '') intro = summaries.find((s) => s !== '') ?? '本页内容见下文各节。'
  intro = balanceInlineCode(intro)

  for (const section of sections) {
    if (!section.ok) {
      checkFailedSections.push(section.title)
      checkDetails.push(`${section.title}:${section.violations.join('、')}`)
    }
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
    const ranges = file.symbolRanges.map((r) => `${r.name}(${r.startLine}-${r.endLine})`).join('、')
    out.push(
      `- ${file.path}${ranges ? `:${ranges}` : ''}${file.evidenceNote ? `(注:${file.evidenceNote})` : ''}`
    )
  }
  const gaps = deps.coverageGaps ?? []
  if (gaps.length > 0) {
    out.push('')
    out.push('## 阅读覆盖说明')
    out.push('')
    out.push(
      `本轮有 ${gaps.length} 个符号未取得可靠阅读笔记,正文对这些部分只能依据结构清单,不作细节断言:${gaps.join('、')}。`
    )
  }
  out.push('')
  out.push(`（生成时点:${deps.generatedAt};行号为生成时点的源码行号。）`)
  return {
    markdown: out.join('\n'),
    sectionCalls: stats.calls,
    retries: stats.retries,
    checkFailedSections,
    checkDetails
  }
}
