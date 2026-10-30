// 真后台线程那一段(selftest-docxjobs 调用):用 node 直接跑 src/main/docxWorker.ts,
// 转一份现造的几十 MB 截图样本,同时量主线程事件循环的最大卡顿;再验中途作废能停下并清干净。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { DocxImageStore } from '../src/main/docxImageStore.ts'
import { DocxJobs } from '../src/main/docxJobs.ts'
import { DOCX_IMAGE_MAX_BYTES } from '../src/shared/preview.ts'
import { buildSampleDocx } from './docx-fixture.mts'
import { buildImageHeavyDocx } from './docx-fixture-large.mts'

const WORKER_URL = new URL('../src/main/docxWorker.ts', import.meta.url)
/** 样本:30 张约 2 MB 的噪点截图 ≈ 60 MB */
const HEAVY = { images: 30, width: 1024, height: 680 }
const LAG_TICK_MS = 10
/** 主线程卡顿上限:转换全在后台线程,主线程只收几条消息,远低于这个数 */
const MAX_LAG_MS = 150
const BYTES_PER_MB = 1024 * 1024

export async function checkRealWorker(): Promise<{
  megabytes: number
  images: number
  ms: number
  lagMs: number
}> {
  const root = await mkdtemp(join(process.env.CODE_ATLAS_TMP ?? tmpdir(), 'docx-worker-'))
  const store = new DocxImageStore(join(root, 'cache'), DOCX_IMAGE_MAX_BYTES)
  const jobs = new DocxJobs({
    store,
    spawn: (job) => new Worker(WORKER_URL, { workerData: job }),
    timeoutMs: 120_000,
    maxConcurrent: 2,
    onProgress: () => {}
  })
  try {
    const small = join(root, 'small.docx')
    await writeFile(small, buildSampleDocx())
    const ok = await jobs.convert(1, 'real-small-1', { absPath: small, relPath: 'small.docx' })
    assert.ok(ok.status === 'ok' && ok.images === 1, '真线程转出样本与一张图')
    assert.match(ok.status === 'ok' ? ok.html : '', /atlas-media:\/\/docx-image\//)

    const heavy = join(root, 'heavy.docx')
    const bytes = buildImageHeavyDocx(HEAVY)
    await writeFile(heavy, bytes)
    let lagMs = 0
    let last = performance.now()
    const ticker = setInterval(() => {
      const now = performance.now()
      lagMs = Math.max(lagMs, now - last - LAG_TICK_MS)
      last = now
    }, LAG_TICK_MS)
    const started = performance.now()
    const res = await jobs.convert(1, 'real-heavy-1', { absPath: heavy, relPath: 'heavy.docx' })
    const ms = Math.round(performance.now() - started)
    clearInterval(ticker)
    assert.ok(res.status === 'ok' && res.images === HEAVY.images, '大样本全部图片都登记')
    assert.ok(lagMs < MAX_LAG_MS, `主线程不该被转换卡住(最大卡顿 ${Math.round(lagMs)} ms)`)
    const cacheDirs = await readdir(join(root, 'cache'))
    assert.equal(cacheDirs.length, 2, '两份转换各一个目录')
    await jobs.release(1, 'real-heavy-1')
    await jobs.release(1, 'real-small-1')
    assert.deepEqual(await readdir(join(root, 'cache')), [], '关签后临时图全删')

    const cancelled = jobs.convert(1, 'real-cancel-1', { absPath: heavy, relPath: 'heavy.docx' })
    await new Promise((r) => setTimeout(r, LAG_TICK_MS * 5))
    await jobs.release(1, 'real-cancel-1')
    assert.deepEqual(await cancelled, { status: 'cancelled' }, '转到一半作废')
    assert.equal(jobs.activeCount, 0, '线程名额让出')
    assert.deepEqual(await readdir(join(root, 'cache')), [], '作废后半成品目录也删')
    assert.equal(existsSync(join(root, 'cache')), true)
    return {
      megabytes: Math.round(bytes.byteLength / BYTES_PER_MB),
      images: HEAVY.images,
      ms,
      lagMs: Math.round(lagMs)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
