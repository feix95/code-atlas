// Word 转换的调度台(主进程):每个渲染层任务号对应一条后台线程,主线程只收发消息、不干重活。
// 规矩:同时最多跑 maxConcurrent 条,其余排队;渲染层换签/重开/关签就 release,
// 排队的直接作废、在跑的就地 terminate、跑完的把图片目录连账清掉;超时、线程崩溃、
// 内存超限都转成一句界面提示。窗口销毁时 releaseOwner 把它名下的任务全收掉。

import type { DocxConvertResult, DocxProgress } from '../shared/docxMedia.ts'
import type { DocxImageStore } from './docxImageStore.ts'
import {
  DOCX_REASONS,
  type DocxConvertOutcome,
  type DocxWorkerJob,
  type DocxWorkerMessage
} from './docxWorkerProtocol.ts'

/** 后台线程的最小接口:真线程是 worker_threads.Worker,自测里换成假的 */
export interface DocxWorkerLike {
  on(event: 'message', fn: (msg: DocxWorkerMessage) => void): unknown
  on(event: 'error', fn: (err: Error) => void): unknown
  on(event: 'exit', fn: (code: number) => void): unknown
  terminate(): Promise<number>
}

export interface DocxJobsOptions {
  store: DocxImageStore
  spawn: (job: DocxWorkerJob) => DocxWorkerLike
  timeoutMs: number
  maxConcurrent: number
  onProgress: (owner: number, progress: DocxProgress) => void
}

type JobState = 'queued' | 'starting' | 'running' | 'done'

interface Job {
  owner: number
  jobId: string
  file: { absPath: string; relPath: string }
  state: JobState
  jobKey: string | null
  worker: DocxWorkerLike | null
  timer: ReturnType<typeof setTimeout> | null
  settle: (result: DocxConvertResult) => void
}

const OUT_OF_MEMORY = 'ERR_WORKER_OUT_OF_MEMORY'

export class DocxJobs {
  private readonly opts: DocxJobsOptions
  private readonly jobs = new Map<string, Job>()
  private readonly queue: Job[] = []
  private active = 0

  constructor(opts: DocxJobsOptions) {
    this.opts = opts
  }

  /** 起一次转换;同一个任务号重复来,先把旧的作废 */
  async convert(
    owner: number,
    jobId: string,
    file: { absPath: string; relPath: string }
  ): Promise<DocxConvertResult> {
    await this.release(owner, jobId)
    return new Promise<DocxConvertResult>((resolve) => {
      const job: Job = {
        owner,
        jobId,
        file,
        state: 'queued',
        jobKey: null,
        worker: null,
        timer: null,
        settle: resolve
      }
      this.jobs.set(keyOf(owner, jobId), job)
      this.queue.push(job)
      this.pump()
    })
  }

  /** 作废/释放一个任务(幂等):排队的直接退,在跑的停线程,跑完的清图片 */
  async release(owner: number, jobId: string): Promise<void> {
    const job = this.jobs.get(keyOf(owner, jobId))
    if (!job) return
    this.jobs.delete(keyOf(owner, jobId))
    if (job.state === 'queued') this.queue.splice(this.queue.indexOf(job), 1)
    const wasActive = job.state === 'starting' || job.state === 'running'
    this.stop(job)
    job.settle({ status: 'cancelled' })
    if (wasActive) this.leaveActive()
    if (job.jobKey) await this.opts.store.release(job.jobKey)
  }

  /** 窗口销毁:它名下的任务全部收掉 */
  async releaseOwner(owner: number): Promise<void> {
    const mine = [...this.jobs.values()].filter((job) => job.owner === owner)
    await Promise.all(mine.map((job) => this.release(owner, job.jobId)))
  }

  /** 正在跑(含正在建目录)的线程数,自测与 journey 对账用 */
  get activeCount(): number {
    return this.active
  }

  get jobCount(): number {
    return this.jobs.size
  }

  private pump(): void {
    while (this.active < this.opts.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift() as Job
      job.state = 'starting'
      this.active++
      void this.start(job)
    }
  }

  private leaveActive(): void {
    this.active--
    this.pump()
  }

  private isCurrent(job: Job): boolean {
    return this.jobs.get(keyOf(job.owner, job.jobId)) === job
  }

  private async start(job: Job): Promise<void> {
    let opened: { jobKey: string; dir: string }
    try {
      opened = await this.opts.store.openJob()
    } catch {
      // 临时目录建不出来(磁盘满/无权限):按普通失败收尾
      job.state = 'running'
      return this.fail(job, DOCX_REASONS.unreadable)
    }
    const { jobKey, dir } = opened
    job.jobKey = jobKey
    // 建目录的工夫里已被作废:release 那边已经让出名额,这里只管把刚建的目录删掉
    if (!this.isCurrent(job)) {
      await this.opts.store.release(jobKey)
      return
    }
    job.state = 'running'
    const worker = this.opts.spawn({ ...job.file, outDir: dir })
    job.worker = worker
    job.timer = setTimeout(() => void this.fail(job, DOCX_REASONS.timeout), this.opts.timeoutMs)
    worker.on('message', (msg) => {
      if (!this.isCurrent(job) || job.state !== 'running') return
      if (msg.type === 'progress') {
        this.opts.onProgress(job.owner, { jobId: job.jobId, images: msg.images })
      } else {
        void this.finish(job, msg.outcome)
      }
    })
    worker.on('error', (err) => {
      const reason =
        (err as NodeJS.ErrnoException).code === OUT_OF_MEMORY
          ? DOCX_REASONS.outOfMemory
          : DOCX_REASONS.unreadable
      void this.fail(job, reason)
    })
    worker.on('exit', () => void this.fail(job, DOCX_REASONS.unreadable))
  }

  private async finish(job: Job, outcome: DocxConvertOutcome): Promise<void> {
    if (outcome.kind === 'rejected') return this.fail(job, outcome.reason)
    job.state = 'done'
    this.stop(job)
    this.leaveActive()
    const images = await this.opts.store.adopt(job.jobKey as string, outcome.images)
    if (!this.isCurrent(job)) return
    job.settle({ status: 'ok', html: outcome.html, warnings: outcome.warnings, images })
  }

  /** 失败收尾(只认第一次):停线程、删目录、让出名额、回提示 */
  private async fail(job: Job, reason: string): Promise<void> {
    if (!this.isCurrent(job) || job.state !== 'running') return
    this.jobs.delete(keyOf(job.owner, job.jobId))
    job.state = 'done'
    this.stop(job)
    this.leaveActive()
    job.settle({ status: 'rejected', reason })
    if (job.jobKey) await this.opts.store.release(job.jobKey)
  }

  private stop(job: Job): void {
    if (job.timer) clearTimeout(job.timer)
    job.timer = null
    const worker = job.worker
    job.worker = null
    if (worker) void worker.terminate().catch(() => 0)
  }
}

function keyOf(owner: number, jobId: string): string {
  return `${owner}:${jobId}`
}
