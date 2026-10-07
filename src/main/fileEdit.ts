// 文件写盘(预览编辑锤):渲染层给文件写字的唯一口子,主进程把门。
// 准入闸与 readPreview 同口径:越界走 joinRoot 拦、目录不接、体积超闸不写;
// 行尾与 BOM 跟原文件走(只读头部一小段认账),落盘不许悄悄换血。
import { promises as fs } from 'node:fs'
import { joinRoot } from '../shared/paths.ts'
import { PREVIEW_MAX_BYTES } from '../shared/preview.ts'
import { accessDeniedMessage, formatSize } from '../shared/fsMessages.ts'
import type { SaveFileResult } from '../shared/types.ts'

/** 认行尾/BOM 只需看开头一段,不为这事读全文 */
const HEAD_SNIFF_BYTES = 8192

async function sniffHead(absPath: string): Promise<{ eol: 'crlf' | 'lf'; bom: boolean }> {
  const handle = await fs.open(absPath, 'r').catch(() => null)
  if (!handle) return { eol: 'lf', bom: false }
  try {
    const buf = Buffer.alloc(HEAD_SNIFF_BYTES)
    const { bytesRead } = await handle.read(buf, 0, HEAD_SNIFF_BYTES, 0)
    const head = buf.subarray(0, bytesRead)
    // BOM = 开头三个字节 EF BB BF;行尾看有没有 CRLF 出现
    return {
      eol: head.includes('\r\n') ? 'crlf' : 'lf',
      bom: bytesRead >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf
    }
  } finally {
    await handle.close()
  }
}

/**
 * 把渲染层送来的文本写进项目内文件。返回写后 mtime,监视器拿它吞自激事件。
 * 来的文本行尾一律按 LF 记账(编辑器内存口径):先归一混进来的 CR/CRLF,
 * 原文件是 CRLF 再统一换回;原文件带 BOM 则剥掉来件里的 BOM 再补回,不重复。
 */
export async function saveTextFile(
  rootPath: unknown,
  relPath: unknown,
  text: unknown
): Promise<SaveFileResult> {
  if (typeof rootPath !== 'string' || typeof relPath !== 'string' || typeof text !== 'string') {
    throw new Error('参数不合法')
  }
  const absPath = joinRoot(rootPath, relPath) // relPath 越界(.. 上跳、盘符注入)在这儿被拦
  const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
  if (stat instanceof Error) {
    throw new Error(accessDeniedMessage(stat, '文件', relPath))
  }
  if (!stat.isFile()) {
    throw new Error(`这个路径不是一个文件:${relPath}`)
  }
  const { eol, bom } = await sniffHead(absPath)
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const body =
    (bom ? '\uFEFF' : '') + (eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized)
  const buf = Buffer.from(body, 'utf8')
  if (buf.byteLength > PREVIEW_MAX_BYTES) {
    // 超闸不写,与预览准入同一条线:能打开的才能改,不会出现「看得改不得」
    throw new Error(
      `写不进:内容有 ${formatSize(buf.byteLength)},超过可编辑上限 ${formatSize(PREVIEW_MAX_BYTES)}`
    )
  }
  await fs.writeFile(absPath, buf).catch((err: NodeJS.ErrnoException) => {
    throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
  })
  const after = await fs.stat(absPath)
  return { mtimeMs: after.mtimeMs }
}
