// 单页全链路编排(实施顺序第 2 步):证据装配 -> 分段笔记 -> 分节生成 -> 拼装,
// 全程计时并汇总失败与缺口,供真机实测端到端耗时与失败率(D4)。
import type { DepEdge } from '../shared/types.ts'
import { buildPageEvidence, type WikiEvidenceDeps } from './wikiEvidence.ts'
import { generateSegmentNotes, WikiNoteLedger } from './wikiNotes.ts'
import { generateWikiPageMarkdown } from './wikiPageGen.ts'
import type { WikiPlan, WikiPlanPage } from './wikiPlanTypes.ts'
import type { WikiCompleter, WikiPageRunResult } from './wikiReadTypes.ts'

export interface WikiPageRunDeps extends WikiEvidenceDeps {
  complete: WikiCompleter
  modelId: string
  ledger: WikiNoteLedger
  now?: () => Date
}

export async function runWikiPage(
  input: {
    page: WikiPlanPage
    topicTitle: string | null
    plan: WikiPlan
    edges: DepEdge[]
    contextSize: number
  },
  deps: WikiPageRunDeps
): Promise<WikiPageRunResult> {
  const started = performance.now()
  const evidenceStart = performance.now()
  const evidence = await buildPageEvidence(input, deps)
  const evidenceMs = performance.now() - evidenceStart

  const notesStart = performance.now()
  const notesResult = await generateSegmentNotes(evidence, {
    complete: deps.complete,
    modelId: deps.modelId,
    ledger: deps.ledger
  })
  const notesMs = performance.now() - notesStart

  const sectionsStart = performance.now()
  const planPaths = new Set(input.plan.pages.flatMap((p) => p.members.map((m) => m.path)))
  const generated = await generateWikiPageMarkdown(evidence, notesResult.notes, {
    complete: deps.complete,
    planPaths,
    generatedAt: (deps.now ? deps.now() : new Date()).toISOString(),
    coverageGaps: notesResult.coverageGaps
  })
  const sectionsMs = performance.now() - sectionsStart

  const failures: string[] = [
    ...evidence.budget.decisions,
    ...notesResult.failures.map((failure) => `笔记失败:${failure}`),
    ...notesResult.coverageGaps.map((gap) => `覆盖缺口:${gap}`),
    ...generated.checkDetails.map((detail) => `节校验未过:${detail}`)
  ]
  return {
    markdown: generated.markdown,
    evidence,
    notes: notesResult.notes,
    stats: {
      evidenceMs: Math.round(evidenceMs),
      notesMs: Math.round(notesMs),
      sectionsMs: Math.round(sectionsMs),
      totalMs: Math.round(performance.now() - started),
      noteCalls: notesResult.calls,
      sectionCalls: generated.sectionCalls,
      retries: notesResult.retries + generated.retries,
      symbolsTotal: notesResult.symbolsTotal,
      symbolsCovered: notesResult.symbolsCovered,
      coverageGaps: notesResult.coverageGaps,
      checkFailedSections: generated.checkFailedSections,
      degradedNotes: notesResult.degraded,
      cacheHits: notesResult.cacheHits,
      failures
    }
  }
}
