// Word 转换的后台线程入口(worker_threads):主进程按 docxWorkerProtocol 递任务进来,
// 这里转完回一条 done;中途只发节流过的进度。被主进程 terminate 就地收工,不留尾巴。

import { parentPort, workerData } from 'node:worker_threads'
import { convertDocxFile } from './docxConvert.ts'
import {
  DOCX_PROGRESS_EVERY_MS,
  type DocxWorkerJob,
  type DocxWorkerMessage
} from './docxWorkerProtocol.ts'

const port = parentPort
const job = workerData as DocxWorkerJob

if (port) {
  let lastSent = 0
  const post = (msg: DocxWorkerMessage): void => port.postMessage(msg)
  void convertDocxFile(job, (images) => {
    const now = Date.now()
    if (now - lastSent < DOCX_PROGRESS_EVERY_MS) return
    lastSent = now
    post({ type: 'progress', images })
  }).then((outcome) => post({ type: 'done', outcome }))
}
