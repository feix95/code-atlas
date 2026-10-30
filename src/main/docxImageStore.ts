// Word 预览的图片登记处(主进程):每次转换一个临时目录,后台线程往里落图,
// 转完由这里逐张验身后登记「令牌 → 文件」。协议只按令牌查这本账 —— 没登记的令牌、
// 别的目录里的文件一概 404。转换作废、页签关闭、窗口销毁、应用退出,目录连账一起清掉。

import { randomBytes } from 'node:crypto'
import { createReadStream, promises as fs, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  DOCX_IMAGE_TOKEN,
  parseDocxImageUrl,
  type DocxImageEntry,
  type DocxImageMime
} from '../shared/docxMedia.ts'

const JOB_KEY_BYTES = 16
const IMAGE_MIMES: ReadonlySet<DocxImageMime> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp'
])

export interface DocxImageRecord {
  jobKey: string
  path: string
  mime: DocxImageMime
  bytes: number
}

export class DocxImageStore {
  private readonly images = new Map<string, DocxImageRecord>()
  private readonly jobs = new Set<string>()

  private readonly root: string
  private readonly maxImageBytes: number

  constructor(root: string, maxImageBytes: number) {
    this.root = root
    this.maxImageBytes = maxImageBytes
  }

  /** 开一个新任务的落图目录;任务键由主进程现发,渲染层碰不到 */
  async openJob(): Promise<{ jobKey: string; dir: string }> {
    const jobKey = randomBytes(JOB_KEY_BYTES).toString('hex')
    const dir = join(this.root, jobKey)
    await fs.mkdir(dir, { recursive: true })
    this.jobs.add(jobKey)
    return { jobKey, dir }
  }

  /**
   * 后台线程报上来的图片清单逐张验身再登记:令牌格式、MIME 白名单、体积上限、
   * 盘上文件真实大小都要对得上;对不上的那张不登记(界面上就是一张加载不出的图)。
   * 回实际登记的张数。任务已作废(中途被释放)就什么都不登记。
   */
  async adopt(jobKey: string, entries: DocxImageEntry[]): Promise<number> {
    if (!this.jobs.has(jobKey)) return 0
    let adopted = 0
    for (const entry of entries) {
      if (!DOCX_IMAGE_TOKEN.test(entry.token) || !IMAGE_MIMES.has(entry.mime)) continue
      if (entry.bytes <= 0 || entry.bytes > this.maxImageBytes) continue
      const path = join(this.root, jobKey, entry.token)
      const st = await fs.stat(path).catch(() => null)
      if (!st?.isFile() || st.size !== entry.bytes || !this.jobs.has(jobKey)) continue
      this.images.set(entry.token, { jobKey, path, mime: entry.mime, bytes: entry.bytes })
      adopted++
    }
    return adopted
  }

  lookup(token: string): DocxImageRecord | null {
    return this.images.get(token) ?? null
  }

  /**
   * 协议回包:atlas-media://docx-image/<令牌>。只回登记过的图片,类型按转换时嗅出来的写死,
   * 并禁止浏览器再猜(nosniff);不缓存,任务释放后同一地址立刻失效。
   */
  async serve(request: Request): Promise<Response> {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const token = parseDocxImageUrl(request.url)
    if (token === null) return new Response(null, { status: 400 })
    const record = this.lookup(token)
    if (!record) return new Response(null, { status: 404 })
    const st = await fs.stat(record.path).catch(() => null)
    if (!st?.isFile() || st.size !== record.bytes) return new Response(null, { status: 404 })
    const body = Readable.toWeb(createReadStream(record.path)) as ReadableStream<Uint8Array>
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': record.mime,
        'Content-Length': String(record.bytes),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      }
    })
  }

  /** 释放一个任务:先摘账(协议立刻 404),再删目录 */
  async release(jobKey: string): Promise<void> {
    this.forget(jobKey)
    await fs.rm(join(this.root, jobKey), { recursive: true, force: true }).catch(() => {})
  }

  /** 应用退出时同步清场(will-quit 里等不了异步) */
  releaseAllSync(): void {
    this.images.clear()
    this.jobs.clear()
    try {
      rmSync(this.root, { recursive: true, force: true })
    } catch {
      // 文件被占用删不掉:下次启动的 sweep 再清
    }
  }

  /** 启动时清掉上次异常退出留下的整个目录 */
  async sweep(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true }).catch(() => {})
  }

  get jobCount(): number {
    return this.jobs.size
  }

  get imageCount(): number {
    return this.images.size
  }

  private forget(jobKey: string): void {
    this.jobs.delete(jobKey)
    for (const [token, record] of this.images) {
      if (record.jobKey === jobKey) this.images.delete(token)
    }
  }
}
