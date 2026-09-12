import type { GgufShape } from './types.ts'

/**
 * GGUF 档案头翻页器(纯函数,自测覆盖):模型文件的开头是一段键值小档案,
 * 这里只翻「出厂上下文上限、层数、头数」这几条要紧的,其余键(包括动辄几 MB 的词表)
 * 按格式算着跳过去 —— 只看账,不动内容,绝不把模型本体读进内存。
 * GGUF 布局:4 字节魔数 + 版本号 + 张量数 + 键值对数;之后每条 = 键名字符串 + 值类型 + 值。
 * 不管模型什么血统(qwen / mistral / …),llama.cpp 转出来的这些键都统一挂 llama.* 前缀。
 */

export type GgufParseResult =
  | { status: 'ok'; shape: GgufShape }
  | { status: 'truncated' }
  | { status: 'bad' }

/** 头部截断了(缓冲区不够长,再读大一点也许就好) */
class TruncatedError extends Error {}
/** 结构是坏的(不是 GGUF / 版本不认 / 数值荒唐),再读多少也没用 */
class BadGgufError extends Error {}

/** 只抓这几条键,别的全跳过 */
const KEY_MAP: Record<string, keyof GgufShape> = {
  'llama.context_length': 'contextLength',
  'llama.block_count': 'blockCount',
  'llama.attention.head_count': 'headCount',
  'llama.attention.head_count_kv': 'kvHeadCount',
  'llama.embedding_length': 'embeddingLength'
}

// GGUF 元数据值类型 0~12 的定长字节数;string(8) 和 array(9) 不定长,单独处理
const FIXED_SIZES: (number | null)[] = [1, 1, 2, 2, 4, 4, 4, 1, null, null, 8, 8, 8]

function need(bytes: number, off: number, buf: Buffer): void {
  if (off + bytes > buf.length) throw new TruncatedError()
}

function readU64(buf: Buffer, off: number): number {
  need(8, off, buf)
  const big = buf.readBigUInt64LE(off)
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new BadGgufError()
  return Number(big)
}

function readString(buf: Buffer, off: number): { text: string; next: number } {
  const len = readU64(buf, off)
  if (len > 1024 * 1024 * 1024) throw new BadGgufError()
  need(len, off + 8, buf)
  return { text: buf.toString('utf8', off + 8, off + 8 + len), next: off + 8 + len }
}

/** 读一个定长标量;string/array 不是标量,回 null 让调用方走各自的道 */
function readScalar(buf: Buffer, off: number, type: number): { next: number; value: number } | null {
  const size = FIXED_SIZES[type] ?? null
  if (size === null) return null
  need(size, off, buf)
  if (size === 8) return { next: off + 8, value: readU64(buf, off) }
  if (size === 4) return { next: off + 4, value: buf.readUInt32LE(off) }
  if (size === 2) return { next: off + 2, value: buf.readUInt16LE(off) }
  return { next: off + 1, value: buf.readUInt8(off) }
}

/** 跳过一条不要的值(string 逐条走,array 按元素类型算账跳);只挪光标,不存内容 */
function skipValue(buf: Buffer, off: number, type: number): number {
  if (type > 12) throw new BadGgufError()
  const scalar = readScalar(buf, off, type)
  if (scalar) return scalar.next
  if (type === 8) return readString(buf, off).next
  // array:元素类型(u32) + 条数(u64) + 元素们
  need(12, off, buf)
  const elemType = buf.readUInt32LE(off)
  if (elemType > 12) throw new BadGgufError()
  const count = readU64(buf, off + 4)
  let cur = off + 12
  const size = FIXED_SIZES[elemType] ?? null
  if (size !== null) {
    // 定长元素:最少 1 字节一条,条数超出剩余空间就是坏了/没读完
    if (count > (buf.length - cur) / size) throw new TruncatedError()
    return cur + count * size
  }
  // 不定长元素:每条至少 4 字节(嵌套数组)或 8 字节(字符串先记长度),照最少的把门
  if (count > (buf.length - cur) / 4) throw new TruncatedError()
  for (let i = 0; i < count; i++) {
    if (elemType === 8) {
      cur = readString(buf, cur).next
    } else {
      // 嵌套数组:元素自己还带一层类型标
      need(4, cur, buf)
      const innerType = buf.readUInt32LE(cur)
      cur = skipValue(buf, cur + 4, innerType)
    }
  }
  return cur
}

/** 翻档案头:ok 带回身条目;truncated = 缓冲区不够,再读大一点重试;bad = 这文件不是正经 GGUF */
export function parseGgufHeader(buf: Buffer): GgufParseResult {
  try {
    if (buf.length < 24) throw new TruncatedError()
    if (buf[0] !== 0x47 || buf[1] !== 0x47 || buf[2] !== 0x55 || buf[3] !== 0x46) throw new BadGgufError()
    const version = buf.readUInt32LE(4)
    if (version < 2 || version > 3) throw new BadGgufError()
    const tensorCount = readU64(buf, 8)
    const kvCount = readU64(buf, 16)
    // 荒唐的账头(几十万条键值)当坏账处理,不给坏文件烧时间
    if (tensorCount > 1_000_000 || kvCount > 1_000_000) throw new BadGgufError()
    const shape: GgufShape = {
      contextLength: null,
      blockCount: null,
      headCount: null,
      kvHeadCount: null,
      embeddingLength: null
    }
    let off = 24
    for (let i = 0; i < kvCount; i++) {
      const key = readString(buf, off)
      off = key.next
      need(4, off, buf)
      const type = buf.readUInt32LE(off)
      off += 4
      const want = KEY_MAP[key.text]
      if (want !== undefined && (type === 4 || type === 10)) {
        const scalar = readScalar(buf, off, type)
        if (scalar === null) throw new BadGgufError()
        shape[want] = scalar.value
        off = scalar.next
      } else {
        off = skipValue(buf, off, type)
      }
    }
    return { status: 'ok', shape }
  } catch (err) {
    if (err instanceof TruncatedError) return { status: 'truncated' }
    return { status: 'bad' }
  }
}
