// Word 预览支路:ipcScan 的 readPreview 配套小文件。
// 这里只做两件快事:拒绝路径(体积上限)+ 读开头四个字节验 zip 魔数,回 'docx' 让界面开 Word 签;
// 真正的转换由界面另发 docxConvert,在后台线程里跑(见 ipcDocx / docxJobs),不占这条通道。

import { promises as fs } from 'node:fs'
import { accessDeniedMessage, formatSize } from '../shared/fsMessages.ts'
import { DOCX_PREVIEW_MAX_BYTES } from '../shared/preview.ts'
import type { FilePreviewResult } from '../shared/types.ts'
import { hasZipMagic } from './docxGate.ts'
import { DOCX_REASONS } from './docxWorkerProtocol.ts'

const MAGIC_BYTES = 4

/** 超体积的提示;没超回 null(转换通道也用它再验一次) */
export function docxSizeReason(sizeBytes: number): string | null {
  if (sizeBytes <= DOCX_PREVIEW_MAX_BYTES) return null
  return `文件过大(${formatSize(sizeBytes)}),超出预览上限 ${formatSize(DOCX_PREVIEW_MAX_BYTES)}`
}

async function readHead(absPath: string, relPath: string): Promise<Uint8Array> {
  const handle = await fs.open(absPath, 'r').catch((err: NodeJS.ErrnoException) => {
    throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
  })
  try {
    const head = new Uint8Array(MAGIC_BYTES)
    await handle.read(head, 0, MAGIC_BYTES, 0)
    return head
  } finally {
    await handle.close()
  }
}

/**
 * Word 支路:absPath 必须由 joinRoot 拼好递进来 —— 这里不管路径,只管字节。
 * 回 'docx' 时只带体积;reason 给拖拽挂引用等非预览入口垫一句提示。
 */
export async function readDocxPreview(opts: {
  absPath: string
  relPath: string
  sizeBytes: number
}): Promise<FilePreviewResult> {
  const tooBig = docxSizeReason(opts.sizeBytes)
  if (tooBig) return { status: 'too-big', text: '', totalLines: 0, reason: tooBig }
  const head = await readHead(opts.absPath, opts.relPath)
  if (!hasZipMagic(head)) {
    return { status: 'binary', text: '', totalLines: 0, reason: DOCX_REASONS.fake }
  }
  return {
    status: 'docx',
    text: '',
    totalLines: 0,
    reason: 'Word 文档不含可作为文本查看或引用的内容',
    docx: { bytes: opts.sizeBytes }
  }
}
