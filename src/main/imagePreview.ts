// ── 图片预览支路(图片预览锤):ipcScan 的 readPreview 配套小文件 ──
// 后缀是 JPG/PNG 的文件走这里:先谢客线,再读盘验魔数 —— 后缀可以改名冒充,
// 字节不会撒谎;验过才回 'image',dataUrl 里的 MIME 按字节嗅出来的写。

import { promises as fs } from 'node:fs'
import { accessDeniedMessage, formatSize } from '../shared/fsMessages.ts'
import { imageMimeOf } from '../shared/fileKinds.ts'
import { sniffImage } from '../shared/imageMeta.ts'
import { IMAGE_PREVIEW_MAX_BYTES } from '../shared/preview.ts'
import type { FilePreviewResult } from '../shared/types.ts'

/**
 * 字节到手的后半程(纯函数,自测覆盖):魔数对不上(改名冒充的二进制)回 binary 说人话;
 * 是真图就按嗅出的 MIME 走 —— 哪怕后缀标错(.png 里装 JPEG),dataUrl 也跟字节说实话。
 */
export function imageResultFromBytes(name: string, buf: Uint8Array): FilePreviewResult {
  const meta = sniffImage(buf)
  if (meta === null || imageMimeOf(name) === null) {
    return {
      status: 'binary',
      text: '',
      totalLines: 0,
      reason: '这个文件的后缀是图片,但内容不是有效的 JPG/PNG —— 多半是别的文件改了名,预览不了'
    }
  }
  return {
    status: 'image',
    text: '',
    totalLines: 0,
    // 拖拽挂引用等非预览入口也会拿到这个状态,reason 给它们垫一句人话
    reason: '这是一张图片,没有可当文本看或引用的内容',
    image: {
      dataUrl: `data:${meta.mime};base64,${Buffer.from(buf).toString('base64')}`,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      bitDepth: meta.bitDepth,
      transparent: meta.transparent,
      progressive: meta.progressive,
      bytes: buf.byteLength
    }
  }
}

/**
 * 图片支路的异步半截:谢客线 + 读盘(读盘报错沿用 accessDeniedMessage 口径)。
 * absPath 必须由 joinRoot 拼好递进来 —— 这里不管路径,只管字节。
 */
export async function readImagePreview(opts: {
  absPath: string
  relPath: string
  sizeBytes: number
}): Promise<FilePreviewResult> {
  if (opts.sizeBytes > IMAGE_PREVIEW_MAX_BYTES) {
    return {
      status: 'too-big',
      text: '',
      totalLines: 0,
      reason: `这张图片有 ${formatSize(opts.sizeBytes)},太大了,图片预览只伺候 ${formatSize(IMAGE_PREVIEW_MAX_BYTES)} 以内的`
    }
  }
  const buf = await fs.readFile(opts.absPath).catch((err: NodeJS.ErrnoException) => {
    throw new Error(accessDeniedMessage(err, '文件', opts.relPath), { cause: err })
  })
  const name = opts.relPath.split('/').pop() ?? opts.relPath
  return imageResultFromBytes(name, buf)
}
