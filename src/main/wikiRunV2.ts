// 第二版 Wiki 生成任务的主进程接线:规划由主进程按项目装配,其余与第一版同构——
// 开始与取消、同一时刻只跑一轮、进度经同一事件通道推回发起窗口。
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { ipcMain } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import { joinRoot } from '../shared/paths.ts'
import { translateLang } from '../shared/translateLangs.ts'
import type { WikiEvent, WikiRunStatus, WikiStartResult } from '../shared/wikiTypes.ts'
import { explainWithMessages } from '../ai/explain.ts'
import { displayModelName } from '../ai/wikiOutput.ts'
import { getFileFact } from '../depgraph/factCache.ts'
import { resolveChatTargetOrError, explainAborters } from './aiEvidence.ts'
import { announceActivityIdle } from './modelStatus.ts'
import { userDataDir } from './paths.ts'
import { parseWikiStartV2 } from './wikiRequest.ts'
import { wikiPlanSourceDeps } from './wikiPlanSource.ts'
import { ensureWikiRootMarker, isInsideRoot, resolveWikiLocation } from '../wiki/wikiLocation.ts'
import { loadWikiSettings } from '../wiki/wikiSettings.ts'
import { wikiOutputTokens } from '../wiki/wikiJob.ts'
import { runWikiJobV2 } from '../wiki/wikiJobV2.ts'
import { assembleWikiPlanInput } from '../wiki/wikiPlanInput.ts'
import { buildWikiPlan } from '../wiki/wikiPlan.ts'
import { resolveProjectDir } from '../wiki/wikiProjectDir.ts'
import { isWikiJobActive } from './wikiRun.ts'

/** 证据层整文件读取上限:超出按读不到处理,证据层自有降级路径 */
const EVIDENCE_READ_BYTES = 8 * 1024 * 1024

interface ActiveJobV2 {
  senderId: number
  requestId: string
  projectRoot: string
  controller: AbortController
  language: string
  total: number
  processed: number
  provider: string
  model: string
}

let activeJob: ActiveJobV2 | null = null

export function isWikiJobV2Active(): boolean {
  return activeJob !== null
}

export function wikiRunStatusV2(): WikiRunStatus {
  if (activeJob === null) return { active: false }
  const { projectRoot, language, total, processed, provider, model } = activeJob
  return { active: true, projectRoot, language, total, processed, provider, model }
}

async function isDirectory(path: string): Promise<boolean> {
  const stat = await fs.stat(path).catch(() => null)
  return stat?.isDirectory() === true
}

/** 读整文件:按 realpath 拦住符号链接越界;二进制与超限返回 null */
async function readTextAt(root: string, relPath: string): Promise<string | null> {
  const abs = joinRoot(root, relPath)
  const real = await fs.realpath(abs).catch(() => null)
  const rootReal = await fs.realpath(root).catch(() => null)
  if (real === null || rootReal === null || !isInsideRoot(real, rootReal)) return null
  const stat = await fs.stat(real).catch(() => null)
  if (stat === null || stat.size > EVIDENCE_READ_BYTES) return null
  const buffer = await fs.readFile(real).catch(() => null)
  if (buffer === null || buffer.includes(0)) return null
  return buffer.toString('utf8')
}

export function registerWikiRunV2Ipc(): void {
  ipcMain.handle(CH.wikiStartV2, async (event, raw: unknown): Promise<WikiStartResult> => {
    const parsed = parseWikiStartV2(raw)
    if (!parsed.ok) return parsed
    const req = parsed.request
    if (!(await isDirectory(req.projectRoot))) {
      return { ok: false, error: '项目文件夹不见了,可能已被移动或删除' }
    }
    if (translateLang(req.language) === null) {
      return { ok: false, error: '这个语种还没登记' }
    }
    const location = loadWikiSettings(userDataDir()).location
    if (location === null) return { ok: false, error: '还没选 Wiki 存放位置' }
    const resolved = await resolveWikiLocation({
      chosen: location,
      projectRoots: [req.projectRoot]
    })
    if (!resolved.ok) return { ok: false, error: resolved.reason }

    const chat = await resolveChatTargetOrError()
    if ('error' in chat) return { ok: false, error: chat.error }
    const model = displayModelName(chat.target.model)

    const root = resolved.location
    await ensureWikiRootMarker(root)
    const projectDir = await resolveProjectDir(root, req.projectRoot)

    const planInput = await assembleWikiPlanInput(
      req.projectRoot,
      basename(req.projectRoot),
      wikiPlanSourceDeps(req.projectRoot)
    )
    const plan = buildWikiPlan(planInput)
    const onlySet = req.pageIds ? new Set(req.pageIds) : null
    const total =
      onlySet === null
        ? plan.pages.length
        : plan.pages.filter((page) => onlySet.has(page.id)).length
    if (total === 0) return { ok: false, error: '这个项目里还没有可生成的内容' }
    if (activeJob !== null || isWikiJobActive()) {
      return { ok: false, error: '已有生成任务在进行,先等它完成或取消后再开始' }
    }

    const controller = new AbortController()
    const job: ActiveJobV2 = {
      senderId: event.sender.id,
      requestId: req.requestId,
      projectRoot: req.projectRoot,
      controller,
      language: req.language,
      total,
      processed: 0,
      provider: chat.provider,
      model
    }
    activeJob = job
    event.sender.once('destroyed', () => controller.abort())
    const send = (payload: WikiEvent): void => {
      if (payload.type === 'progress') {
        job.processed = Math.max(job.processed, payload.processed)
      }
      if (!event.sender.isDestroyed()) event.sender.send(CH.wikiEvent, payload)
    }
    const replyCap = wikiOutputTokens(chat.ctx)
    void runWikiJobV2(
      {
        projectRoot: req.projectRoot,
        projectName: basename(req.projectRoot),
        projectDir,
        language: req.language,
        model,
        modelId: model,
        contextSize: chat.ctx,
        planInput,
        ...(req.force ? { force: true } : {}),
        ...(onlySet ? { onlyPageIds: onlySet } : {}),
        signal: controller.signal
      },
      {
        factOf: (relPath) => getFileFact(req.projectRoot, relPath),
        readFile: (relPath) => readTextAt(req.projectRoot, relPath),
        complete: async (system, user, maxTokens) => {
          const result = await explainWithMessages(
            chat.target,
            [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ],
            () => {},
            controller.signal,
            Math.min(maxTokens, replyCap)
          )
          if (result.status === 'supported' && result.text.trim() !== '') return result.text
          if (result.status === 'cancelled') throw new Error('模型请求已取消')
          throw new Error(result.text.trim() === '' ? '模型没返回内容' : result.text)
        },
        emit: (jobEvent) =>
          send({
            type: 'progress',
            source: 'v2',
            projectRoot: jobEvent.projectRoot,
            language: jobEvent.language,
            total: jobEvent.total,
            processed: jobEvent.processed,
            page: jobEvent.page
          }),
        isActive: () => activeJob === job && !controller.signal.aborted
      }
    )
      .then((summary) => {
        if (activeJob === job) activeJob = null
        send({
          type: 'finished',
          source: 'v2',
          projectRoot: req.projectRoot,
          language: req.language,
          status: summary.status,
          done: summary.done,
          skipped: summary.skipped,
          failed: summary.failed,
          cancelled: summary.cancelled,
          ...(summary.error ? { error: summary.error } : {})
        })
        if (explainAborters.size === 0) announceActivityIdle()
      })
      .catch((err: unknown) => {
        if (activeJob === job) activeJob = null
        send({
          type: 'finished',
          source: 'v2',
          projectRoot: req.projectRoot,
          language: req.language,
          status: 'failed',
          done: 0,
          skipped: 0,
          failed: total,
          cancelled: 0,
          error: err instanceof Error ? err.message : 'Wiki 生成失败'
        })
        if (explainAborters.size === 0) announceActivityIdle()
      })

    return { ok: true, total, provider: chat.provider, model, projectDir }
  })

  ipcMain.handle(CH.wikiRunStatusV2, () => wikiRunStatusV2())

  ipcMain.handle(CH.wikiCancelV2, (event) => {
    if (activeJob !== null && activeJob.senderId === event.sender.id) {
      activeJob.controller.abort()
      activeJob = null
    }
  })
}
