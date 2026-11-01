// Wiki 生成任务:串行逐页请求、每页落盘即记账并推进度、取消后立刻停、重启按记账续跑。
// 模型调用与文件读取都从 deps 注入,自测用替身把流程跑全,不碰真实网络。
import { buildWikiMessages } from '../ai/wikiPrompt.ts'
import {
  renderWikiMarkdown,
  requestWikiContent,
  wikiDocExcerpt,
  type WikiContentAttempt,
  type WikiModelRequest
} from '../ai/wikiOutput.ts'
import { translateLang } from '../shared/translateLangs.ts'
import { WIKI_PROMPT_VERSION } from './wikiHash.ts'
import {
  allocatePageFile,
  createWikiState,
  pageFileExists,
  readWikiState,
  savePage,
  writeWikiState,
  type WikiLanguageState,
  type WikiPageRecord,
  type WikiState
} from './wikiStore.ts'
import {
  prepareWikiPageFacts,
  wikiPageInputHash,
  type WikiFactDeps,
  type WikiFactsInput
} from './wikiPageFacts.ts'
import { writeWikiIndex, type WikiIndexPage } from './wikiIndex.ts'
import type { WikiJobEvent, WikiPageProgress, WikiPageSource } from '../shared/wikiTypes.ts'

export { wikiOutputTokens } from './wikiPageFacts.ts'

export type WikiJobDeps = WikiFactDeps & {
  request: WikiModelRequest
  /** 统一取时间,自测可固定 */
  now?: () => string
  emit?: (event: WikiJobEvent) => void
  /** 项目切走后返回 false:迟到结果一律不落盘 */
  isActive?: () => boolean
}

export interface WikiJobOptions {
  projectRoot: string
  projectName: string
  projectDir: string
  language: string
  model: string
  contextSize: number
  replyCap: number
  knownTags: string[]
  pages: WikiPageSource[]
  /** 忽略缓存强制重写 */
  force?: boolean
  signal?: AbortSignal
}

export interface WikiJobSummary {
  status: 'done' | 'cancelled' | 'failed'
  processed: number
  done: number
  skipped: number
  failed: number
  cancelled: number
  error?: string
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Wiki 生成失败'
}

async function loadState(
  options: WikiJobOptions
): Promise<{ state: WikiState; languageState: WikiLanguageState } | { error: string }> {
  const read = await readWikiState(options.projectDir)
  if (read.status === 'damaged') return { error: 'Wiki 记账损坏,先重建记账再生成' }
  const state =
    read.status === 'ok' ? read.state : createWikiState(options.projectRoot, options.projectDir)
  if (state.projectRoot !== options.projectRoot) return { error: 'Wiki 记账属于别的项目' }
  const label = translateLang(options.language)?.label ?? options.language
  const languageState = state.languages[options.language] ?? {
    code: options.language,
    label,
    pages: {}
  }
  languageState.label = label
  state.languages[options.language] = languageState
  return { state, languageState }
}

async function recordFailure(args: {
  source: WikiPageSource
  options: WikiJobOptions
  state: WikiState
  languageState: WikiLanguageState
  existing: WikiPageRecord | undefined
  inputHash: string
  generatedAt: string
}): Promise<WikiPageRecord> {
  const { source, options, state, languageState, existing, inputHash, generatedAt } = args
  const file =
    existing?.file ??
    allocatePageFile(Object.values(languageState.pages), source.kind, source.name, source.pageId)
  const record: WikiPageRecord = {
    pageId: source.pageId,
    kind: source.kind,
    file,
    inputHash,
    promptVersion: WIKI_PROMPT_VERSION,
    model: options.model,
    generatedAt,
    status: 'failed',
    name: existing?.name ?? source.name
  }
  // 旧文档还在:摘要、标签与关键文件留着,失败不该把已有的说明一起抹掉
  if (existing?.summary !== undefined) record.summary = existing.summary
  if (existing?.tags !== undefined) record.tags = existing.tags
  if (existing?.keyFiles !== undefined) record.keyFiles = existing.keyFiles
  if (existing?.excerpt !== undefined) record.excerpt = existing.excerpt
  if (existing?.truncated === true) record.truncated = true
  languageState.pages[source.pageId] = record
  await writeWikiState(options.projectDir, state)
  return record
}

/**
 * 目录页在整轮末尾重写:按生成顺序收已完成且文件还在的页,失败或缺失的不进索引。
 * 空目录(一页都没成)不落 README,免得留下只有表头的空壳。
 */
async function refreshIndex(
  options: WikiJobOptions,
  languageState: WikiLanguageState,
  deps: WikiJobDeps
): Promise<void> {
  const pages: WikiIndexPage[] = []
  for (const source of options.pages) {
    const record = languageState.pages[source.pageId]
    if (record?.status !== 'done') continue
    if (!(await pageFileExists(options.projectDir, options.language, record))) continue
    pages.push({ kind: record.kind, name: record.name, file: record.file })
  }
  if (pages.length === 0) return
  await writeWikiIndex(options.projectDir, {
    projectName: options.projectName,
    language: options.language,
    model: options.model,
    generatedAt: deps.now?.() ?? new Date().toISOString(),
    pages
  })
}

/** 跑一整轮 Wiki 生成(并发 1):每页成功即落盘,失败记状态继续下一题 */
export async function runWikiJob(
  options: WikiJobOptions,
  deps: WikiJobDeps
): Promise<WikiJobSummary> {
  const factsInput: WikiFactsInput = {
    language: options.language,
    projectName: options.projectName,
    moduleCount: options.pages.filter((page) => page.kind === 'module').length,
    groupCount: options.pages.filter((page) => page.kind === 'group').length,
    knownTags: options.knownTags,
    contextSize: options.contextSize,
    replyCap: options.replyCap
  }
  let processed = 0
  let done = 0
  let skipped = 0
  let failed = 0
  let cancelled = 0
  const total = options.pages.length
  const active = (): boolean => options.signal?.aborted !== true && deps.isActive?.() !== false
  const summary = (status: WikiJobSummary['status'], error?: string): WikiJobSummary => ({
    status,
    processed,
    done,
    skipped,
    failed,
    cancelled,
    ...(error ? { error } : {})
  })
  const emit = (page: WikiPageProgress): void => {
    if (page.status !== 'running') processed += 1
    deps.emit?.({
      projectRoot: options.projectRoot,
      language: options.language,
      total,
      processed,
      page
    })
  }
  const loaded = await loadState(options)
  if ('error' in loaded) return summary('failed', loaded.error)
  const { state, languageState } = loaded

  try {
    for (const source of options.pages) {
      const progress = { pageId: source.pageId, kind: source.kind, name: source.name }
      if (!active()) {
        cancelled += 1
        emit({ ...progress, status: 'cancelled' })
        return summary('cancelled')
      }
      const inputHash = wikiPageInputHash(source, options.language, deps.factOf)
      const existing = languageState.pages[source.pageId]
      if (
        options.force !== true &&
        existing &&
        existing.inputHash === inputHash &&
        existing.promptVersion === WIKI_PROMPT_VERSION &&
        existing.status === 'done' &&
        (await pageFileExists(options.projectDir, options.language, existing))
      ) {
        skipped += 1
        emit({ ...progress, status: 'skipped', file: existing.file })
        continue
      }
      emit({ ...progress, status: 'running' })

      const facts = await prepareWikiPageFacts(source, factsInput, deps)
      let attempt: WikiContentAttempt
      try {
        attempt = await requestWikiContent(
          buildWikiMessages(facts),
          {
            files: source.files.map((file) => file.path),
            attachedFiles: source.attachedFiles,
            knownTags: options.knownTags
          },
          deps.request,
          options.signal
        )
      } catch (err) {
        if (!active()) {
          cancelled += 1
          emit({ ...progress, status: 'cancelled' })
          return summary('cancelled')
        }
        await recordFailure({
          source,
          options,
          state,
          languageState,
          existing,
          inputHash,
          generatedAt: deps.now?.() ?? new Date().toISOString()
        })
        failed += 1
        emit({ ...progress, status: 'failed', error: errorText(err) })
        continue
      }
      if (!active()) {
        cancelled += 1
        emit({ ...progress, status: 'cancelled' })
        return summary('cancelled')
      }
      if (!attempt.ok) {
        await recordFailure({
          source,
          options,
          state,
          languageState,
          existing,
          inputHash,
          generatedAt: deps.now?.() ?? new Date().toISOString()
        })
        failed += 1
        emit({ ...progress, status: 'failed', error: attempt.errors.join('; ') })
        continue
      }

      const content = attempt.content
      const file = allocatePageFile(
        Object.values(languageState.pages),
        source.kind,
        content.name,
        source.pageId
      )
      const generatedAt = deps.now?.() ?? new Date().toISOString()
      const truncated = facts.truncated
      const wasTrimmed =
        truncated.files > 0 ||
        truncated.symbols > 0 ||
        truncated.excerpts > 0 ||
        content.docTruncated
      const record: WikiPageRecord = {
        pageId: source.pageId,
        kind: source.kind,
        file,
        inputHash,
        promptVersion: WIKI_PROMPT_VERSION,
        model: options.model,
        generatedAt,
        status: 'done',
        name: content.name,
        summary: content.summary,
        tags: [...content.tags],
        keyFiles: [...content.keyFiles],
        excerpt: wikiDocExcerpt(content.doc)
      }
      if (wasTrimmed) record.truncated = true
      const markdown = renderWikiMarkdown(content, {
        language: options.language,
        model: options.model,
        generatedAt,
        truncated
      })
      await savePage({
        projectDir: options.projectDir,
        languageCode: options.language,
        record,
        markdown,
        previousFile: existing?.file ?? null
      })
      languageState.pages[source.pageId] = record
      await writeWikiState(options.projectDir, state)
      done += 1
      emit({ ...progress, status: 'done', file })
    }
    // 目录页最后生成,不调用模型;中途取消不写,避免把半轮结果当成全量
    if (active()) await refreshIndex(options, languageState, deps)
  } catch (err) {
    return summary('failed', errorText(err))
  }
  return summary(active() ? 'done' : 'cancelled')
}
