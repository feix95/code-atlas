// Word 大文档通道自测:图片令牌与协议地址、字节嗅图、图片登记处(验身/上限/回包/清场)、
// 转换调度(排队/作废/超时/崩溃/内存超限/窗口销毁),以及真后台线程转一份几十 MB 的样本时
// 主线程的事件循环不卡、中途作废能停下并清干净。样本都现造在临时目录里,用完即删。
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  docxImageSrc,
  isDocxImageSrc,
  parseDocxImageUrl,
  sniffDocxImage,
  type DocxProgress
} from '../src/shared/docxMedia.ts'
import { DocxImageStore } from '../src/main/docxImageStore.ts'
import { DocxJobs, type DocxWorkerLike } from '../src/main/docxJobs.ts'
import { DOCX_REASONS, type DocxWorkerJob } from '../src/main/docxWorkerProtocol.ts'
import { TINY_PNG } from './docx-fixture.mts'
import { checkRealWorker } from './selftest-docxworker.mts'

const TOKEN = 'a'.repeat(32)
const MAX_IMAGE = 1024

export async function tempDir(): Promise<string> {
  return mkdtemp(join(process.env.CODE_ATLAS_TMP ?? tmpdir(), 'docx-jobs-'))
}

function checkMedia(): void {
  const src = docxImageSrc(TOKEN)
  assert.equal(src, `atlas-media://docx-image/${TOKEN}`)
  assert.equal(isDocxImageSrc(src), true)
  assert.equal(parseDocxImageUrl(src), TOKEN, '地址拆回令牌')
  for (const bad of [
    `atlas-media://docx-image/${TOKEN}?x=1`,
    `atlas-media://docx-image/${TOKEN}#a`,
    `atlas-media://docx-image/${TOKEN.toUpperCase()}`,
    'atlas-media://docx-image/../../etc/passwd',
    `atlas-media://preview/${TOKEN}`,
    `https://docx-image/${TOKEN}`,
    'not a url'
  ]) {
    assert.equal(parseDocxImageUrl(bad), null, `不认:${bad}`)
  }
  assert.deepEqual(sniffDocxImage(TINY_PNG), { mime: 'image/png', width: 1, height: 1 })
  const gif = Buffer.from('GIF89a\x02\x00\x03\x00', 'latin1')
  assert.deepEqual(sniffDocxImage(gif), { mime: 'image/gif', width: 2, height: 3 })
  const bmp = Buffer.alloc(26)
  bmp.write('BM', 0, 'latin1')
  bmp.writeInt32LE(4, 18)
  bmp.writeInt32LE(-5, 22)
  assert.deepEqual(sniffDocxImage(bmp), { mime: 'image/bmp', width: 4, height: 5 }, '倒序 BMP')
  const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')
  assert.equal(sniffDocxImage(webp)?.mime, 'image/webp')
  assert.equal(sniffDocxImage(Buffer.from('<svg/>')), null, 'svg 不认')
  assert.equal(sniffDocxImage(Buffer.from([0xd7, 0xcd, 0xc6, 0x9a])), null, 'WMF 不认')
}

async function checkStore(): Promise<void> {
  const root = await tempDir()
  const store = new DocxImageStore(join(root, 'cache'), MAX_IMAGE)
  try {
    const { jobKey, dir } = await store.openJob()
    assert.match(jobKey, /^[0-9a-f]{32}$/, '任务键由主进程现发')
    await writeFile(join(dir, TOKEN), TINY_PNG)
    await writeFile(join(dir, 'b'.repeat(32)), Buffer.alloc(MAX_IMAGE + 1))
    const adopted = await store.adopt(jobKey, [
      { token: TOKEN, mime: 'image/png', bytes: TINY_PNG.byteLength },
      { token: 'b'.repeat(32), mime: 'image/png', bytes: MAX_IMAGE + 1 },
      { token: '../evil', mime: 'image/png', bytes: 1 },
      { token: 'c'.repeat(32), mime: 'image/png', bytes: 4 },
      { token: TOKEN, mime: 'image/svg+xml' as 'image/png', bytes: TINY_PNG.byteLength }
    ])
    assert.equal(adopted, 1, '只登记验过身的那张(超限/坏令牌/文件不在/坏类型都不收)')
    assert.equal(store.lookup('b'.repeat(32)), null)

    const ok = await store.serve(new Request(docxImageSrc(TOKEN)))
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('content-type'), 'image/png', '类型按嗅出来的写')
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(ok.headers.get('content-length'), String(TINY_PNG.byteLength))
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), TINY_PNG, '回包字节原样')
    const status = async (url: string, method = 'GET'): Promise<number> =>
      (await store.serve(new Request(url, { method }))).status
    assert.equal(await status(docxImageSrc('d'.repeat(32))), 404, '没登记的令牌 404')
    assert.equal(await status(`atlas-media://docx-image/${TOKEN}?p=1`), 400, '夹带查询串 400')
    assert.equal(await status(docxImageSrc(TOKEN), 'POST'), 405, '只收 GET')

    await store.release(jobKey)
    assert.equal(existsSync(dir), false, '释放即删目录')
    assert.equal(await status(docxImageSrc(TOKEN)), 404, '释放后地址立刻失效')
    assert.equal(await store.adopt(jobKey, []), 0, '作废的任务不再登记')

    const again = await store.openJob()
    store.releaseAllSync()
    assert.equal(existsSync(again.dir), false, '退出时同步清场')
    assert.equal(store.jobCount + store.imageCount, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** 假后台线程:由用例手动发消息/报错/退出,记下是否被 terminate */
class FakeWorker extends EventEmitter implements DocxWorkerLike {
  terminated = false
  readonly job: DocxWorkerJob
  constructor(job: DocxWorkerJob) {
    super()
    this.job = job
  }
  terminate(): Promise<number> {
    this.terminated = true
    return Promise.resolve(1)
  }
}

const POLL_MS = 5
const POLL_LIMIT_MS = 5000

/** 等到条件成立(建目录走线程池,几个 tick 不一定够) */
async function until(cond: () => boolean): Promise<void> {
  const deadline = Date.now() + POLL_LIMIT_MS
  while (!cond()) {
    assert.ok(Date.now() < deadline, '等待超时')
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

async function checkJobs(): Promise<void> {
  const root = await tempDir()
  const store = new DocxImageStore(join(root, 'cache'), MAX_IMAGE)
  const spawned: FakeWorker[] = []
  const progress: Array<[number, DocxProgress]> = []
  const make = (timeoutMs = 60_000): DocxJobs =>
    new DocxJobs({
      store,
      spawn: (job) => {
        const w = new FakeWorker(job)
        spawned.push(w)
        return w
      },
      timeoutMs,
      maxConcurrent: 1,
      onProgress: (owner, p) => progress.push([owner, p])
    })
  const file = { absPath: 'x.docx', relPath: 'x.docx' }
  try {
    const jobs = make()
    const first = jobs.convert(1, 'job-aaaa-1', file)
    const queued = jobs.convert(1, 'job-aaaa-2', file)
    await until(() => spawned.length === 1)
    await new Promise((r) => setTimeout(r, POLL_MS * 4))
    assert.equal(spawned.length, 1, '同时只跑 maxConcurrent 条,其余排队')
    await jobs.release(1, 'job-aaaa-2')
    assert.deepEqual(await queued, { status: 'cancelled' }, '排队中的直接作废')
    const w1 = spawned[0]
    w1.emit('message', { type: 'progress', images: 3 })
    assert.deepEqual(progress, [[1, { jobId: 'job-aaaa-1', images: 3 }]], '进度按窗口转发')
    await writeFile(join(w1.job.outDir, TOKEN), TINY_PNG)
    w1.emit('message', {
      type: 'done',
      outcome: {
        kind: 'ok',
        html: '<p>hi</p>',
        warnings: 0,
        images: [{ token: TOKEN, mime: 'image/png', bytes: TINY_PNG.byteLength }]
      }
    })
    assert.deepEqual(await first, { status: 'ok', html: '<p>hi</p>', warnings: 0, images: 1 })
    assert.equal(w1.terminated, true, '转完就收线程')
    assert.equal(store.imageCount, 1)
    w1.emit('exit', 0)
    await jobs.release(1, 'job-aaaa-1')
    assert.equal(store.imageCount, 0, '关签释放图片')
    assert.equal(existsSync(w1.job.outDir), false)

    const running = jobs.convert(2, 'job-bbbb-1', file)
    await until(() => spawned.length === 2)
    const w2 = spawned[1]
    const replaced = jobs.convert(2, 'job-bbbb-1', file)
    assert.deepEqual(await running, { status: 'cancelled' }, '同号重来:旧的作废')
    assert.equal(w2.terminated, true, '在跑的线程被停掉')
    await until(() => spawned.length === 3)
    const w3 = spawned[2]
    w3.emit('error', Object.assign(new Error('oom'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }))
    assert.deepEqual(await replaced, { status: 'rejected', reason: DOCX_REASONS.outOfMemory })
    await until(() => !existsSync(w3.job.outDir))

    const crash = jobs.convert(3, 'job-cccc-1', file)
    await until(() => spawned.length === 4)
    spawned[3].emit('exit', 1)
    assert.deepEqual(
      await crash,
      { status: 'rejected', reason: DOCX_REASONS.unreadable },
      '线程崩溃'
    )

    const owned = jobs.convert(4, 'job-dddd-1', file)
    await until(() => spawned.length === 5)
    await jobs.releaseOwner(4)
    assert.deepEqual(await owned, { status: 'cancelled' }, '窗口销毁收掉名下任务')
    assert.equal(jobs.activeCount + jobs.jobCount, 0, '名额与账全部归零')

    const slow = make(30)
    const timed = slow.convert(5, 'job-eeee-1', file)
    assert.deepEqual(await timed, { status: 'rejected', reason: DOCX_REASONS.timeout }, '超时')
    assert.equal(spawned.at(-1)?.terminated, true, '超时停线程')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

checkMedia()
await checkStore()
await checkJobs()
const real = await checkRealWorker()
console.log(
  `   真线程:${real.megabytes} MB / ${real.images} 张图,转换 ${real.ms} ms,主线程最大卡顿 ${real.lagMs} ms`
)
console.log('✅ Word 大文档通道自测全部通过')
console.log(
  '   令牌地址 · 字节嗅图 · 登记验身/上限/回包/释放/清场 · 排队/作废/同号重来/超时/崩溃/内存超限/窗口销毁 · 真线程转换不卡主线程'
)
