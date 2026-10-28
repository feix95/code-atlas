// Word 文件的门禁(纯函数,自测覆盖):魔数、压缩包目录、解压账。
// 单独成文件,主进程的快路径(readPreview)只验魔数时不必把 mammoth 一起加载进来。

import { DOCX_UNZIPPED_MAX_BYTES } from '../shared/preview.ts'
import { readZipDirectory } from './zipDirectory.ts'
import { DOCX_REASONS } from './docxWorkerProtocol.ts'

/** .docx 本质是 zip:开头四个字节必是 PK\x03\x04 */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

export function hasZipMagic(buf: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, i) => buf[i] === byte)
}

/** 魔数对不上、目录读不懂、解压账超标,各回一句提示;都过了回 null */
export function docxGateFromBytes(buf: Uint8Array): string | null {
  if (!hasZipMagic(buf)) return DOCX_REASONS.fake
  const dir = readZipDirectory(buf)
  if (dir === null) return DOCX_REASONS.corrupt
  if (dir.uncompressedBytes > DOCX_UNZIPPED_MAX_BYTES) return DOCX_REASONS.bomb
  return null
}
