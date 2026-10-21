/** 译文任务的渲染层状态表:一次翻译一份,只在内存里活着(不落盘,重启即丢)。
 * 主进程按块推送,这里按块记账;页签重新挂载时从账上取,不重开任务。 */
import type { TranslateBlockKind, TranslateEvent } from '@shared/translateTypes'

export type TranslateStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface TranslateJob {
  key: string
  requestId: string
  status: TranslateStatus
  /** 计划里的总块数(plan 到达前是 0) */
  total: number
  kinds: TranslateBlockKind[]
  /** 每块译文;空串 = 还没翻好 */
  texts: string[]
  doneCount: number
  error: string | null
}

const jobs = new Map<string, TranslateJob>()
const keyByRequest = new Map<string, string>()
const listeners = new Set<() => void>()
let seq = 0
let listening = false

export function translateKey(rootPath: string, relPath: string, lang: string): string {
  return `${rootPath}|${relPath}|${lang}`
}

export function getTranslateJob(key: string): TranslateJob | null {
  return jobs.get(key) ?? null
}

export function subscribeTranslate(listener: () => void): () => void {
  listeners.add(listener)
  ensureListening()
  return () => {
    listeners.delete(listener)
  }
}

function emit(): void {
  for (const l of listeners) l()
}

function commit(job: TranslateJob): void {
  jobs.set(job.key, job)
  emit()
}

function fail(key: string, message: string): void {
  const job = jobs.get(key)
  if (!job) return
  commit({ ...job, status: 'error', error: message })
}

function onEvent(payload: TranslateEvent): void {
  const key = keyByRequest.get(payload.requestId)
  if (!key) return
  const job = jobs.get(key)
  if (!job) return

  if (payload.type === 'plan') {
    commit({
      ...job,
      total: payload.total,
      kinds: payload.kinds,
      texts: Array.from({ length: payload.total }, () => ''),
      doneCount: 0
    })
    return
  }
  if (payload.type === 'block') {
    const texts = job.texts.slice()
    texts[payload.index] = payload.text
    commit({ ...job, texts, doneCount: job.doneCount + 1 })
    return
  }
  if (payload.type === 'done') {
    commit({ ...job, status: 'done' })
    return
  }
  commit({ ...job, status: 'error', error: payload.message })
}

function ensureListening(): void {
  if (listening) return
  listening = true
  window.atlas.onTranslateEvent(onEvent)
}

/** 开一份翻译;同一份(路径+语种)正在跑或已完成就不再开第二次。
 *  取消过的照样能重开(换语种再切回来会走到这儿) */
export function startTranslate(input: {
  rootPath: string
  relPath: string
  lang: string
  text: string
}): void {
  ensureListening()
  const key = translateKey(input.rootPath, input.relPath, input.lang)
  const existing = jobs.get(key)
  if (existing && (existing.status === 'running' || existing.status === 'done')) return

  const requestId = `tr:${++seq}`
  keyByRequest.set(requestId, key)
  commit({
    key,
    requestId,
    status: 'running',
    total: 0,
    kinds: [],
    texts: [],
    doneCount: 0,
    error: null
  })

  void window.atlas
    .translateStart({ requestId, text: input.text, lang: input.lang })
    .then((res) => {
      if (!res.ok) {
        keyByRequest.delete(requestId)
        fail(key, res.error ?? '翻译没能开始')
      }
    })
    .catch((err: unknown) => {
      keyByRequest.delete(requestId)
      fail(key, err instanceof Error ? err.message : String(err))
    })
}

/** 重来一遍:先掐掉在跑的,丢掉旧账,再开新任务 */
export function restartTranslate(input: {
  rootPath: string
  relPath: string
  lang: string
  text: string
}): void {
  const key = translateKey(input.rootPath, input.relPath, input.lang)
  const job = jobs.get(key)
  if (job) {
    if (job.status === 'running') void window.atlas.translateCancel(job.requestId)
    keyByRequest.delete(job.requestId)
    jobs.delete(key)
    emit()
  }
  startTranslate(input)
}

/** 换工作区 = 换上下文:在跑的全掐掉,账清空(译文签本身也跟着换区消失) */
export function cancelAllTranslations(): void {
  for (const job of jobs.values()) {
    if (job.status === 'running') void window.atlas.translateCancel(job.requestId)
  }
  jobs.clear()
  keyByRequest.clear()
  emit()
}

export function cancelTranslate(key: string): void {
  const job = jobs.get(key)
  if (!job || job.status !== 'running') return
  void window.atlas.translateCancel(job.requestId)
  keyByRequest.delete(job.requestId)
  commit({ ...job, status: 'cancelled', error: null })
}
