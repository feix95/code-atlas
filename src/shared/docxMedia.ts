// Word 预览的图片通道与转换回执(主进程、后台线程、渲染层三方共用的纯函数与类型)。
// 图片不再塞进网页:后台线程把每张图落成临时文件,网页里只留 atlas-media://docx-image/<令牌>;
// 令牌是本次转换现发的随机串,主进程只认登记过的令牌,没有任何路径能从地址里拼出来。

import { AUDIO_MEDIA_SCHEME } from './audioMedia.ts'
import { sniffImage } from './imageMeta.ts'

/** 和音频共用 atlas-media 协议,靠主机名分路 */
export const DOCX_IMAGE_HOST = 'docx-image'
/** 令牌 = 16 字节随机数的十六进制 */
export const DOCX_IMAGE_TOKEN = /^[0-9a-f]{32}$/
const DOCX_IMAGE_SRC = new RegExp(`^${AUDIO_MEDIA_SCHEME}://${DOCX_IMAGE_HOST}/[0-9a-f]{32}$`)

export type DocxImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/bmp'

export interface DocxImageEntry {
  token: string
  mime: DocxImageMime
  bytes: number
}

/** 转换回执:ok 带未消毒的网页(上屏前必须过 docxSanitize);rejected 带一句界面提示 */
export type DocxConvertResult =
  | { status: 'ok'; html: string; warnings: number; images: number }
  | { status: 'rejected'; reason: string }
  | { status: 'cancelled' }

/** 转换进度(主进程 → 渲染层):mammoth 不报百分比,只能报已处理的图片张数 */
export interface DocxProgress {
  jobId: string
  images: number
}

/** 渲染层自己起的任务号:换签/重开就作废,主进程按它停掉对应的后台线程 */
export const DOCX_JOB_ID = /^[0-9a-zA-Z-]{8,64}$/

export function docxImageSrc(token: string): string {
  return `${AUDIO_MEDIA_SCHEME}://${DOCX_IMAGE_HOST}/${token}`
}

export function isDocxImageSrc(src: string | null): boolean {
  return src !== null && DOCX_IMAGE_SRC.test(src)
}

/** 协议请求里拆出令牌;主机名、路径、查询串任何一处不对都回 null */
export function parseDocxImageUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${AUDIO_MEDIA_SCHEME}:` || parsed.hostname !== DOCX_IMAGE_HOST) {
    return null
  }
  if (parsed.search !== '' || parsed.hash !== '') return null
  const token = parsed.pathname.slice(1)
  return DOCX_IMAGE_TOKEN.test(token) ? token : null
}

function u16le(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8)
}

function i32le(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)
}

function startsWith(b: Uint8Array, at: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false
  return true
}

/**
 * 按字节嗅图片种类与宽高(不信 Word 里登记的类型):只认 Chromium 画得出的五种位图,
 * 其余(EMF/WMF/SVG/改名的二进制)回 null。宽高读不出给 null,界面就不预留尺寸。
 */
export function sniffDocxImage(
  b: Uint8Array
): { mime: DocxImageMime; width: number | null; height: number | null } | null {
  const meta = sniffImage(b)
  if (meta) return { mime: meta.mime, width: meta.width, height: meta.height }
  if (startsWith(b, 0, 'GIF87a') || startsWith(b, 0, 'GIF89a')) {
    return { mime: 'image/gif', width: u16le(b, 6) || null, height: u16le(b, 8) || null }
  }
  if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) {
    return { mime: 'image/webp', width: null, height: null }
  }
  if (startsWith(b, 0, 'BM') && b.byteLength >= 26) {
    const width = i32le(b, 18)
    const height = Math.abs(i32le(b, 22))
    return { mime: 'image/bmp', width: width > 0 ? width : null, height: height || null }
  }
  return null
}
