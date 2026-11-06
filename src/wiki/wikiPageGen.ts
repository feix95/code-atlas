// 正文生成(原型版):文件职责表由程序列行、模型填句;正文分节生成,每节只喂所需证据,
// 节后做标识符白名单校验(C6);图由程序按引用边生成(C4);出处由程序标注(C5);
// 人话摘要在全部分节完成后按三个固定问题生成(C2)。
import { byCodeUnit } from '../modules/pathOrder.ts'
import type { WikiCompleter, WikiPageEvidence, WikiSegmentNote } from './wikiReadTypes.ts'
import { balanceInlineCode, checkWhitelist, knownNamesOf, mermaidOf } from './wikiPageCheck.ts'
import { fillDuties } from './wikiDuties.ts'

const SECTION_SYSTEM =
  '你是技术文档作者,面向不看代码的读者写中文文档。只依据给定证据写作,不使用证据里不存在的文件、函数、类或常量名;引用标识符时用反引号包住。行文具体、克制,不写空话套话,不复述证据原文。称呼页面用"本页",不要把页面称作"节"。不要在正文里重复输出节标题。'

export interface WikiGenResult {
  markdown: string
  sectionCalls: number
  retries: number
  checkFailedSections: string[]
  /** 校验未过的具体违规名,逐节记录,便于复测定位(节名:违规名) */
  checkDetails: string[]
  /** 开头总述来源:模型生成且过校验为 model,走了程序兜底为 fallback */
  introSource: 'model' | 'fallback'
}

/** 兜底总述:从各节正文里挑第一句点名了主角核心导出符号的句子,挑不到才退回首节摘要 */
function pickIntroFallback(
  sections: SectionOutcome[],
  evidence: WikiPageEvidence,
  summaries: string[]
): string {
  const coreNames = new Set(
    evidence.files.filter((f) => f.role === 'primary').flatMap((f) => f.structure?.exports ?? [])
  )
  for (const section of sections) {
    for (const sentence of section.text.split(/(?<=[。.!?])\s*/)) {
      const trimmed = sentence.trim()
      if (trimmed === '') continue
      for (const match of trimmed.matchAll(/`([^`]+)`/g)) {
        if (coreNames.has(match[1]!)) return trimmed.slice(0, 200)
      }
    }
  }
  return summaries.find((s) => s !== '') ?? '本页内容见下文各节。'
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
  // 先修行内代码再校验:漏写右反引号会把真实路径与中文粘成假名称,误判整节不合格
  const knownNames = knownNamesOf(ctx.evidence, ctx.planPaths)
  text = balanceInlineCode(text, knownNames)
  let violations =
    text === '' ? ['模型未返回内容'] : checkWhitelist(text, ctx.evidence, ctx.planPaths)
  if (violations.length > 0) {
    stats.retries++
    try {
      const retry = balanceInlineCode(
        await ask(
          `上一稿不合格:出现了证据里不存在的名称(${violations.join('、')})。重写本节,只使用证据中真实存在的名称。`
        ),
        knownNames
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
    text: balanceInlineCode(stripOwnHeading(text, title), knownNames),
    sources,
    ok: text !== '' && violations.length === 0,
    violations
  }
}

/** 模型偶尔在正文开头重复输出节标题:首个非空行若是与节名相同的标题行,剥掉 */
function stripOwnHeading(text: string, title: string): string {
  const lines = text.split('\n')
  const firstIndex = lines.findIndex((line) => line.trim() !== '')
  if (firstIndex < 0) return text
  const heading = lines[firstIndex]!.trim().replace(/^#+\s*/, '')
  if (heading !== title) return text
  lines.splice(firstIndex, 1)
  return lines.join('\n').trim()
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
    '说明页内文件如何分工协作、引用关系说明了什么结构。谁调用谁、谁依赖谁,只能依据下面给出的引用边陈述;没有引用边的两个文件,不要断言它们之间存在调用或依赖关系。用 1 到 3 段写清,图由程序附在本节末尾,你只写文字。',
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
  const primaryDuties = evidence.files
    .filter((f) => f.role === 'primary')
    .map((f) => `${f.path}:${duties.get(f.path) ?? ''}`)
    .join('；')
  const askIntro = async (extra: string): Promise<string> => {
    stats.calls++
    return (
      await deps.complete(
        '你面向完全不看代码的读者写产品说明。只依据给定的分节摘要回答,不引入新名词,不复述原文句子。',
        [
          `主题:「${evidence.pageTitle}」`,
          `各节摘要:${summaries.filter((s) => s !== '').join(' ')}`,
          `主角文件职责:${primaryDuties}`,
          '用一段话依次回答三个问题:这个部分解决什么问题、谁会用到它、没有它会怎样。不超过 200 字。必须点名至少一个主角文件的核心导出符号(用反引号包住),说清它具体负责什么,不许只写"供用户使用""影响体验"这类空话。',
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
    // 生成失败保持空,下面走程序兜底
  }
  if (intro !== '' && checkWhitelist(intro, evidence, deps.planPaths).length > 0) {
    try {
      const retry = await askIntro('注意:只使用分节摘要里真实出现的名称,不要引入任何新名称。')
      intro = checkWhitelist(retry, evidence, deps.planPaths).length === 0 ? retry : ''
    } catch {
      intro = ''
    }
  }
  const introSource: 'model' | 'fallback' = intro !== '' ? 'model' : 'fallback'
  if (intro === '') intro = pickIntroFallback(sections, evidence, summaries)
  intro = balanceInlineCode(intro, knownNamesOf(evidence, deps.planPaths))

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
      duties.get(file.path) ??
      (file.role === 'attached' || file.role === 'reference'
        ? '引用或附属,未单独阅读'
        : '本页成员文件')
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
    checkDetails,
    introSource
  }
}
