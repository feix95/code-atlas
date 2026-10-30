// 压缩包目录账(纯函数,自测覆盖):不解压,只读 zip 尾部的中央目录,
// 把每个条目登记的「解压后大小」加起来 —— docx 交给转换器整份解压之前先过这一关,
// 几 KB 的文件登记出几个 GB 的,直接挡在门外。

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const EOCD_MIN_BYTES = 22
/** 尾部注释最长 65535 字节,目录尾记录只会落在最后这一截 */
const EOCD_SEARCH_BYTES = EOCD_MIN_BYTES + 0xffff
const CENTRAL_FIXED_BYTES = 46
/** zip64 的占位值:真实大小藏在扩展字段里,按「大到登记不下」对待 */
const ZIP32_MAX = 0xffffffff

export interface ZipDirectorySummary {
  entries: number
  /** 各条目登记的解压后大小合计;遇到 zip64 占位值记为 Infinity */
  uncompressedBytes: number
}

function findEndOfDirectory(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - EOCD_SEARCH_BYTES)
  for (let at = view.byteLength - EOCD_MIN_BYTES; at >= lowest; at--) {
    if (view.getUint32(at, true) === EOCD_SIG) return at
  }
  return -1
}

/** 读中央目录;结构对不上(截断/畸形/不是 zip)回 null,由调用方说人话 */
export function readZipDirectory(buf: Uint8Array): ZipDirectorySummary | null {
  if (buf.byteLength < EOCD_MIN_BYTES) return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const eocd = findEndOfDirectory(view)
  if (eocd < 0) return null
  const entries = view.getUint16(eocd + 10, true)
  const dirOffset = view.getUint32(eocd + 16, true)
  if (dirOffset === ZIP32_MAX) return { entries, uncompressedBytes: Infinity }
  let at = dirOffset
  let total = 0
  for (let i = 0; i < entries; i++) {
    if (at + CENTRAL_FIXED_BYTES > eocd) return null
    if (view.getUint32(at, true) !== CENTRAL_SIG) return null
    const size = view.getUint32(at + 24, true)
    total = size === ZIP32_MAX ? Infinity : total + size
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    at += CENTRAL_FIXED_BYTES + nameLen + extraLen + commentLen
  }
  return { entries, uncompressedBytes: total }
}
