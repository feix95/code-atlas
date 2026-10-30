// Word 转换的干活部分:只在后台线程(docxWorker)里跑,主进程从不直接调用它 ——
// 读盘、验 zip、mammoth 转网页、图片落临时文件,全程不碰主线程的事件循环。
// 这里只出「未消毒」的网页草稿:文档是外来的,上屏前由渲染层 docxSanitize 再过一道。

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import mammoth from 'mammoth'
import { accessDeniedMessage } from '../shared/fsMessages.ts'
import { DOCX_HTML_MAX_CHARS, DOCX_IMAGE_MAX_BYTES } from '../shared/preview.ts'
import { docxImageSrc, sniffDocxImage, type DocxImageEntry } from '../shared/docxMedia.ts'
import { docxGateFromBytes } from './docxGate.ts'
import { DOCX_REASONS, type DocxConvertOutcome } from './docxWorkerProtocol.ts'

/** 令牌字节数:十六进制后 32 位,与 DOCX_IMAGE_TOKEN 对齐 */
const TOKEN_BYTES = 16
/** 文档里的锚点 id 加前缀,不跟界面自己的元素 id 撞名 */
const DOCX_ID_PREFIX = 'docx-'
/**
 * 中文 Word 的内置标题样式存名是 heading 1(界面才显示「标题 1」),mammoth 默认就认;
 * 但 WPS 或旧模板里另建的样式会把名字直接存成「标题 1」,默认表不认、会掉成普通段落 ——
 * 这里补上 1~6 级,让大纲和标题排版都认得它们。
 */
const ZH_HEADING_STYLE_MAP = [1, 2, 3, 4, 5, 6].map(
  (level) => `p[style-name='标题 ${level}'] => h${level}:fresh`
)

/**
 * 字节 → 网页草稿。每张图按字节嗅种类(不信 Word 登记的类型),认得的落成 outDir/<令牌>,
 * 网页里只写协议地址和宽高(懒加载前就能占好位,滚动条不跳);认不得、超大的给空地址。
 */
export async function convertDocxBytes(
  buf: Buffer,
  outDir: string,
  onImage: (count: number) => void = () => {}
): Promise<DocxConvertOutcome> {
  const gate = docxGateFromBytes(buf)
  if (gate) return { kind: 'rejected', reason: gate }
  const images: DocxImageEntry[] = []
  const saveImage = mammoth.images.imgElement(async (image) => {
    const bytes = await image.read()
    const meta = bytes.byteLength <= DOCX_IMAGE_MAX_BYTES ? sniffDocxImage(bytes) : null
    if (meta === null) return { src: '' }
    const token = randomBytes(TOKEN_BYTES).toString('hex')
    await fs.writeFile(join(outDir, token), bytes, { flag: 'wx' })
    images.push({ token, mime: meta.mime, bytes: bytes.byteLength })
    onImage(images.length)
    const size: Record<string, string> = {}
    if (meta.width !== null) size.width = String(meta.width)
    if (meta.height !== null) size.height = String(meta.height)
    return { src: docxImageSrc(token), ...size }
  })
  let converted: Awaited<ReturnType<typeof mammoth.convertToHtml>>
  try {
    converted = await mammoth.convertToHtml(
      { buffer: buf },
      {
        convertImage: saveImage,
        idPrefix: DOCX_ID_PREFIX,
        externalFileAccess: false,
        styleMap: ZH_HEADING_STYLE_MAP
      }
    )
  } catch {
    return { kind: 'rejected', reason: DOCX_REASONS.unreadable }
  }
  if (converted.value.length > DOCX_HTML_MAX_CHARS) {
    return { kind: 'rejected', reason: DOCX_REASONS.tooMuchText }
  }
  return { kind: 'ok', html: converted.value, warnings: converted.messages.length, images }
}

/** 读盘 + 转换:后台线程的入口只调这一个。读盘报错(被 Word 独占、无权限)沿用 accessDeniedMessage 口径 */
export async function convertDocxFile(
  job: { absPath: string; relPath: string; outDir: string },
  onImage?: (count: number) => void
): Promise<DocxConvertOutcome> {
  let buf: Buffer
  try {
    buf = await fs.readFile(job.absPath)
  } catch (err) {
    return {
      kind: 'rejected',
      reason: accessDeniedMessage(err as NodeJS.ErrnoException, '文件', job.relPath)
    }
  }
  return convertDocxBytes(buf, job.outDir, onImage)
}
