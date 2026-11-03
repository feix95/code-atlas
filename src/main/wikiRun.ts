// Wiki 生成任务的主进程接线:开始与取消、同一时刻只跑一轮、进度推回发起窗口。
// 任务本体在 wikiJob;这里只负责把模型、文件读取和窗口推送给齐。
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
import { parseWikiStart } from './wikiRequest.ts'
import { ensureWikiRootMarker, isInsideRoot, resolveWikiLocation } from '../wiki/wikiLocation.ts'
import { loadWikiSettings } from '../wiki/wikiSettings.ts'
import { runWikiJob, wikiOutputTokens } from '../wiki/wikiJob.ts'
import { resolveProjectDir } from '../wiki/wikiProjectDir.ts'
import { isWikiJobV2Active } from './wikiRunV2.ts'

/** 摘录只读开头,40 行 / 2000 字的上限在任务层再掐;32KB 足够覆盖 */
const EXCERPT_READ_BYTES = 32 * 1024

interface ActiveJob {
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

let activeJob: ActiveJob | null = null

export function isWikiJobActive(): boolean {
  return activeJob !== null
}

/** 进度页可能晚于任务开跑才挂载:补读一次运行快照,不用干等到下一页事件 */
export function wikiRunStatus(): WikiRunStatus {
  if (activeJob === null) return { active: false }
  const { projectRoot, language, total, processed, provider, model } = activeJob
  return { active: true, projectRoot, language, total, processed, provider, model }
}

async function isDirectory(path: string): Promise<boolean> {
  const stat = await fs.stat(path).catch(() => null)
  return stat?.isDirectory() === true
}

/** 读摘录:按 realpath 拦住符号链接越界;二进制返回 null,由任务跳过 */
async function readHeadAt(root: string, relPath: string): Promise<string | null> {
  const abs = joinRoot(root, relPath)
  const real = await fs.realpath(abs).catch(() => null)
  const rootReal = await fs.realpath(root).catch(() => null)
  if (real === null || rootReal === null || !isInsideRoot(real, rootReal)) return null
  const handle = await fs.open(real, 'r').catch(() => null)
  if (handle === null) return null
  try {
    const buffer = Buffer.alloc(EXCERPT_READ_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const bytes = buffer.subarray(0, bytesRead)
    return bytes.includes(0) ? null : bytes.toString('utf8')
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

export function registerWikiRunIpc(): void {
  ipcMain.handle(CH.wikiStart, async (event, raw: unknown): Promise<WikiStartResult> => {
    const parsed = parseWikiStart(raw)
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
    const only = req.only === undefined ? null : new Set(req.only)
    const pages = only === null ? req.pages : req.pages.filter((page) => only.has(page.pageId))
    if (pages.length === 0) return { ok: false, error: '这些页已经不在当前项目里了' }

    if (activeJob !== null || isWikiJobV2Active()) {
      return { ok: false, error: '已有生成任务在进行,先等它完成或取消后再开始' }
    }
    const controller = new AbortController()
    const job: ActiveJob = {
      senderId: event.sender.id,
      requestId: req.requestId,
      projectRoot: req.projectRoot,
      controller,
      language: req.language,
      total: pages.length,
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
    void runWikiJob(
      {
        projectRoot: req.projectRoot,
        projectName: basename(req.projectRoot),
        projectDir,
        language: req.language,
        model,
        contextSize: chat.ctx,
        replyCap,
        knownTags: req.knownTags ?? [],
        pages,
        ...(req.force ? { force: true } : {}),
        signal: controller.signal
      },
      {
        factOf: (relPath) => getFileFact(req.projectRoot, relPath),
        readHead: (relPath) => readHeadAt(req.projectRoot, relPath),
        request: async (messages, signal) => {
          const result = await explainWithMessages(
            chat.target,
            [
              { role: 'system', content: messages.system },
              { role: 'user', content: messages.user }
            ],
            // 流式只为续命:一页可能写到几千 token,非流式的 120 秒整段看门狗会拦腰截断;
            // 增量不往界面推,收完仍是一次性解析
            () => {},
            signal,
            replyCap
          )
          if (result.status === 'supported' && result.text.trim() !== '') return result.text
          if (result.status === 'cancelled') throw new Error('模型请求已取消')
          throw new Error(result.text.trim() === '' ? '模型没返回内容' : result.text)
        },
        emit: (jobEvent) => send({ type: 'progress', ...jobEvent }),
        isActive: () => activeJob === job && !controller.signal.aborted
      }
    )
      .then((summary) => {
        if (activeJob === job) activeJob = null
        send({
          type: 'finished',
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
          projectRoot: req.projectRoot,
          language: req.language,
          status: 'failed',
          done: 0,
          skipped: 0,
          failed: pages.length,
          cancelled: 0,
          error: err instanceof Error ? err.message : 'Wiki 生成失败'
        })
        if (explainAborters.size === 0) announceActivityIdle()
      })

    return {
      ok: true,
      total: pages.length,
      provider: chat.provider,
      model,
      projectDir
    }
  })

  ipcMain.handle(CH.wikiRunStatus, () => wikiRunStatus())

  ipcMain.handle(CH.wikiCancel, (event) => {
    if (activeJob !== null && activeJob.senderId === event.sender.id) {
      activeJob.controller.abort()
      activeJob = null
    }
  })
}
