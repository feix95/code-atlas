// Wiki 生成任务(第二版):按落盘规划逐个叶子页生成,笔记账本落在项目账本区,
// 记账首次生成时升为第二版;旧页在全量完成前保留可读,全量完成后才清退。
// 模型调用与文件读取都从 deps 注入,自测用替身把流程跑全。
import { promises as fs } from 'node:fs'
import type { WikiEvidenceDeps } from './wikiEvidence.ts'
import type { WikiJobSummary } from './wikiJob.ts'
import { WikiNoteLedger } from './wikiLedger.ts'
import { buildWikiPlan } from './wikiPlan.ts'
import type { WikiPlanInput, WikiPlanPage } from './wikiPlanTypes.ts'
import type { WikiCompleter } from './wikiReadTypes.ts'
import { runWikiPage } from './wikiPageRun.ts'
import { runParentPages } from './wikiParentGen.ts'
import { registerPlanPages } from './wikiJobRegister.ts'
import { parentOrderOf, topicTitleOf } from './wikiParentTree.ts'
import { allocatePlanFiles, writeWikiPlanFile } from './wikiPlanStore.ts'
import { languageDirLabel, pageFileExists, removePageFile, writeFileAtomic } from './wikiStore.ts'
import {
  createWikiStateV2,
  pageFilePathV2,
  readWikiStateAny,
  removePageFileV2,
  upgradeStateV1toV2,
  wikiLedgerDirPath,
  writeWikiStateV2,
  type WikiLanguageStateV2,
  type WikiMemberSnapshot,
  type WikiPageKindV2,
  type WikiStateV2
} from './wikiStoreV2.ts'
import { writeWikiIndexV2 } from './wikiIndexV2.ts'

export interface WikiPageProgressV2 {
  pageId: string
  kind: WikiPageKindV2
  name: string
  status: 'running' | 'done' | 'skipped' | 'failed' | 'cancelled'
  file?: string
  error?: string
}

export interface WikiJobV2Deps extends WikiEvidenceDeps {
  complete: WikiCompleter
  now?: () => string
  emit?: (event: {
    projectRoot: string
    language: string
    total: number
    processed: number
    page: WikiPageProgressV2
  }) => void
  /** 项目切走后返回 false:迟到结果一律不落盘 */
  isActive?: () => boolean
}

export interface WikiJobV2Options {
  projectRoot: string
  projectName: string
  projectDir: string
  language: string
  /** 展示用模型名,写进记账 */
  model: string
  /** 模型标识,进笔记缓存键 */
  modelId: string
  contextSize: number
  planInput: WikiPlanInput
  force?: boolean
  signal?: AbortSignal
  /** 只生成这些页(卡片墙单页生成,叶子与父页都可);不传为全部页 */
  onlyPageIds?: ReadonlySet<string>
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Wiki 生成失败'
}

/** 当前成员哈希:附属成员不读内容,其余按事实层哈希,取不到记 null */
function currentMemberHashes(
  page: WikiPlanPage,
  deps: WikiJobV2Deps
): { path: string; role: WikiMemberSnapshot['role']; contentHash: string | null }[] {
  return page.members.map((member) => ({
    path: member.path,
    role: member.role,
    contentHash: member.role === 'attached' ? null : (deps.factOf(member.path)?.sha256 ?? null)
  }))
}

/** 按路径比对成员哈希快照:两边顺序可能不同(证据按路径排序,规划按角色排列) */
function sameMembers(
  snapshot: { path: string; contentHash: string | null }[],
  current: { path: string; contentHash: string | null }[]
): boolean {
  if (snapshot.length !== current.length) return false
  const byPath = new Map(current.map((m) => [m.path, m.contentHash]))
  return snapshot.every((member) => byPath.get(member.path) === member.contentHash)
}

export async function runWikiJobV2(
  options: WikiJobV2Options,
  deps: WikiJobV2Deps
): Promise<WikiJobSummary> {
  let processed = 0
  let done = 0
  let skipped = 0
  let failed = 0
  let cancelled = 0
  const summary = (status: WikiJobSummary['status'], error?: string): WikiJobSummary => ({
    status,
    processed,
    done,
    skipped,
    failed,
    cancelled,
    ...(error ? { error } : {})
  })
  const active = (): boolean => options.signal?.aborted !== true && deps.isActive?.() !== false

  const read = await readWikiStateAny(options.projectDir)
  if (read.status === 'damaged') return summary('failed', 'Wiki 记账损坏,先重建记账再生成')
  let state: WikiStateV2
  if (read.status === 'ok' && read.version === 2) state = read.state
  else if (read.status === 'ok') state = upgradeStateV1toV2(read.state)
  else state = createWikiStateV2(options.projectRoot, options.projectDir)
  if (state.projectRoot !== options.projectRoot) {
    return summary('failed', 'Wiki 记账属于别的项目')
  }

  const plan = buildWikiPlan(options.planInput)
  const files = allocatePlanFiles(plan)
  state.planRef = { path: '.codeatlas/plan.json', version: plan.version }
  const label = languageDirLabel(options.language)
  const languageState: WikiLanguageStateV2 = state.languages[options.language] ?? {
    code: options.language,
    label,
    origin: 'generated',
    pages: {},
    legacy: {}
  }
  languageState.label = label
  state.languages[options.language] = languageState

  const previousFiles = registerPlanPages(plan, files, languageState)
  await writeWikiPlanFile(options.projectDir, plan)
  await writeWikiStateV2(options.projectDir, state)

  const ledgerDir = wikiLedgerDirPath(options.projectDir)
  const ledger = await WikiNoteLedger.load(ledgerDir)

  const leafPages = plan.pages.filter((p) => p.kind === 'leaf')
  const only = options.onlyPageIds
  const targets = only ? leafPages.filter((p) => only.has(p.id)) : leafPages
  // 父页在叶子之后按层生成:越深的总览越先,根主题页最后
  const orderOf = parentOrderOf(plan)
  const parentPages = plan.pages
    .filter((p) => p.kind !== 'leaf')
    .sort((a, b) => (orderOf.get(b.id) ?? 0) - (orderOf.get(a.id) ?? 0))
  const parentTargets = only ? parentPages.filter((p) => only.has(p.id)) : parentPages
  const total = targets.length + parentTargets.length
  const emit = (page: WikiPageProgressV2): void => {
    if (page.status !== 'running') processed += 1
    deps.emit?.({
      projectRoot: options.projectRoot,
      language: options.language,
      total,
      processed,
      page
    })
  }

  try {
    for (const page of targets) {
      const record = languageState.pages[page.id]!
      const progress = { pageId: page.id, kind: page.kind, name: record.name }
      if (!active()) {
        cancelled += 1
        emit({ ...progress, status: 'cancelled' })
        return summary('cancelled')
      }
      const current = currentMemberHashes(page, deps)
      if (
        options.force !== true &&
        record.status === 'done' &&
        sameMembers(record.members, current) &&
        (await fs.access(pageFilePathV2(options.projectDir, options.language, record)).then(
          () => true,
          () => false
        ))
      ) {
        skipped += 1
        emit({ ...progress, status: 'skipped', file: record.file })
        continue
      }
      emit({ ...progress, status: 'running' })
      try {
        const result = await runWikiPage(
          {
            page,
            topicTitle: topicTitleOf(plan, page.topicId),
            plan,
            edges: options.planInput.edges,
            contextSize: options.contextSize
          },
          {
            factOf: deps.factOf,
            readFile: deps.readFile,
            complete: deps.complete,
            modelId: options.modelId,
            ledger,
            now: () => new Date(deps.now?.() ?? new Date().toISOString())
          }
        )
        if (!active()) {
          cancelled += 1
          emit({ ...progress, status: 'cancelled' })
          return summary('cancelled')
        }
        // 落盘前复核:生成期间成员文件变了,本页标 stale,内容保留待重生成
        const after = currentMemberHashes(page, deps)
        const changed = !sameMembers(
          result.evidence.files.map((f) => ({
            path: f.path,
            role: page.members.find((m) => m.path === f.path)?.role ?? 'supporting',
            contentHash: f.contentHash
          })),
          after
        )
        const previousFile = previousFiles.get(page.id) ?? record.file
        record.file = files.get(page.id)!
        await writeFileAtomic(
          pageFilePathV2(options.projectDir, options.language, record),
          result.markdown
        )
        if (previousFile !== record.file) {
          await removePageFileV2(options.projectDir, options.language, previousFile)
        }
        const introLine = result.markdown
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line !== '' && !line.startsWith('#') && !line.startsWith('>'))
        record.status = changed ? 'stale' : 'done'
        record.model = options.model
        record.generatedAt = deps.now?.() ?? new Date().toISOString()
        record.members = result.evidence.files.map((f) => ({
          path: f.path,
          role: page.members.find((m) => m.path === f.path)?.role ?? 'supporting',
          contentHash: f.contentHash
        }))
        record.budgetNotes = [...result.stats.failures]
        record.keyFiles = page.members
          .filter((m) => m.role === 'primary')
          .slice(0, 5)
          .map((m) => m.path)
        if (introLine !== undefined) {
          record.summary = introLine.slice(0, 120)
          record.excerpt = introLine.slice(0, 400)
        }
        await ledger.save(ledgerDir)
        await writeWikiStateV2(options.projectDir, state)
        done += 1
        emit({ ...progress, status: 'done', file: record.file })
      } catch (err) {
        if (!active()) {
          cancelled += 1
          emit({ ...progress, status: 'cancelled' })
          return summary('cancelled')
        }
        record.status = 'failed'
        record.generatedAt = deps.now?.() ?? new Date().toISOString()
        await writeWikiStateV2(options.projectDir, state)
        failed += 1
        emit({ ...progress, status: 'failed', error: errorText(err) })
      }
    }
  } catch (err) {
    return summary('failed', errorText(err))
  }

  // 叶子跑完接着汇总父页:输入用刚落盘的下属记录,指纹对不上才重写
  const parentOutcome = await runParentPages(
    { plan, pages: parentTargets, languageState, files, previousFiles },
    {
      projectDir: options.projectDir,
      language: options.language,
      model: options.model,
      ...(options.force ? { force: true } : {}),
      complete: deps.complete,
      now: () => deps.now?.() ?? new Date().toISOString(),
      isActive: active,
      emit: (page) => emit(page),
      persist: () => writeWikiStateV2(options.projectDir, state)
    }
  )
  done += parentOutcome.done
  skipped += parentOutcome.skipped
  failed += parentOutcome.failed
  if (parentOutcome.cancelled) return summary('cancelled')

  // 全量完成才清退 legacy:部分完成时旧页继续可读,不提前删
  const allDone = leafPages.every((p) => languageState.pages[p.id]?.status === 'done')
  if (allDone && Object.keys(languageState.legacy).length > 0) {
    for (const legacy of Object.values(languageState.legacy)) {
      if (await pageFileExists(options.projectDir, options.language, legacy)) {
        await removePageFile(options.projectDir, options.language, legacy.file)
      }
    }
    languageState.legacy = {}
    await writeWikiStateV2(options.projectDir, state)
  }

  if (active()) {
    await writeWikiIndexV2(options.projectDir, {
      projectName: options.projectName,
      language: options.language,
      model: options.model,
      generatedAt: deps.now?.() ?? new Date().toISOString(),
      plan,
      languageState,
      files
    })
  }
  return summary(active() ? 'done' : 'cancelled')
}
