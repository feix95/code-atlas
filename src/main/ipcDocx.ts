// Word 预览的主进程接线:转换任务的 IPC、atlas-media 的 docx-image 分路、临时目录的生与灭。
// 转换在 worker_threads 后台线程里跑(electron-vite 的 ?modulePath 把 docxWorker 单独打包),
// 主线程只做验路径、派任务、转发进度、按令牌回图片字节。

import { app, ipcMain, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import workerPath from './docxWorker?modulePath'
import { CH } from '../shared/ipcChannels.ts'
import { isDocxFile } from '../shared/fileKinds.ts'
import { joinRoot } from '../shared/paths.ts'
import { DOCX_CONVERT_TIMEOUT_MS, DOCX_IMAGE_MAX_BYTES } from '../shared/preview.ts'
import { DOCX_JOB_ID, type DocxConvertResult } from '../shared/docxMedia.ts'
import { DocxImageStore } from './docxImageStore.ts'
import { DocxJobs } from './docxJobs.ts'
import { docxSizeReason } from './docxPreview.ts'

/** 同时最多几条转换线程:会话恢复一口气开好几份 Word 时不把内存吃满 */
const DOCX_MAX_CONCURRENT = 2
/** 单条转换线程的堆上限(MB):超了只死这条线程,主进程照常 */
const DOCX_WORKER_HEAP_MB = 2048
/** 临时目录名后缀取 userData 路径的哈希前几位:开发版与安装版同时开也各管各的 */
const DIR_HASH_CHARS = 8

let store: DocxImageStore | null = null

function imageStore(): DocxImageStore {
  if (!store) {
    const tag = createHash('sha256')
      .update(app.getPath('userData'))
      .digest('hex')
      .slice(0, DIR_HASH_CHARS)
    store = new DocxImageStore(
      join(app.getPath('temp'), `CodeAtlas-docx-${tag}`),
      DOCX_IMAGE_MAX_BYTES
    )
  }
  return store
}

function spawnWorker(job: object): Worker {
  return new Worker(workerPath, {
    workerData: job,
    resourceLimits: { maxOldGenerationSizeMb: DOCX_WORKER_HEAP_MB }
  })
}

/** atlas-media 协议里 docx-image 分路的入口(audioMediaProtocol 按主机名转过来) */
export function serveDocxImage(request: Request): Promise<Response> {
  return imageStore().serve(request)
}

export function registerDocxIpc(): void {
  const images = imageStore()
  // 上次异常退出留下的临时图先清干净,清完才接新任务
  const swept = images.sweep()
  /** 发起过转换的窗口:进度回给它,它销毁时名下任务全收 */
  const watched = new Map<number, WebContents>()
  const jobs = new DocxJobs({
    store: images,
    spawn: spawnWorker,
    timeoutMs: DOCX_CONVERT_TIMEOUT_MS,
    maxConcurrent: DOCX_MAX_CONCURRENT,
    onProgress: (owner, progress) => {
      const target = watched.get(owner)
      if (target && !target.isDestroyed()) target.send(CH.docxProgress, progress)
    }
  })
  const watch = (sender: WebContents): void => {
    if (watched.has(sender.id)) return
    const id = sender.id
    watched.set(id, sender)
    sender.once('destroyed', () => {
      watched.delete(id)
      void jobs.releaseOwner(id)
    })
  }

  ipcMain.handle(
    CH.docxConvert,
    async (event, rootPath: unknown, relPath: unknown, jobId: unknown) => {
      if (
        typeof rootPath !== 'string' ||
        typeof relPath !== 'string' ||
        typeof jobId !== 'string' ||
        !DOCX_JOB_ID.test(jobId) ||
        !isDocxFile(relPath.split('/').pop() ?? relPath)
      ) {
        throw new Error('参数不合法')
      }
      const absPath = joinRoot(rootPath, relPath)
      const st = await fs.stat(absPath).catch(() => null)
      if (!st?.isFile()) throw new Error(`这个路径不是一个文件:${relPath}`)
      const tooBig = docxSizeReason(st.size)
      if (tooBig) return { status: 'rejected', reason: tooBig } satisfies DocxConvertResult
      await swept
      watch(event.sender)
      return jobs.convert(event.sender.id, jobId, { absPath, relPath })
    }
  )

  ipcMain.handle(CH.docxRelease, async (event, jobId: unknown) => {
    if (typeof jobId !== 'string' || !DOCX_JOB_ID.test(jobId)) return
    await jobs.release(event.sender.id, jobId)
  })

  app.on('will-quit', () => images.releaseAllSync())
}
