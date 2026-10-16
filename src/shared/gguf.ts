import type { GgufShape } from './types.ts'

/**
 * GGUF 头部键值对解析:流式读,值太大(词表那种成片的数组)就跳过不占内存。
 * 只看结构档案要用的字段,其余的按格式跳过去。
 */

const G = (buf: Buffer) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

const GGH = 0x46554747 // 'GGUF' little-endian
const GGUF_STRING = 8
const GGUF_ARRAY = 9

/** 键名是「架构名.字段名」两段:字段后缀 → GgufShape 户口(架构名由键前缀决定) */
const FIELD_SUFFIXES: Record<string, keyof Omit<GgufShape, 'architecture'>> = {
  '.context_length': 'contextLength',
  '.block_count': 'blockCount',
  '.attention.head_count': 'headCount',
  '.attention.head_count_kv': 'kvHeadCount',
  '.embedding_length': 'embeddingLength',
  '.expert_count': 'expertCount',
  '.expert_used_count': 'expertUsedCount'
}

/**
 * 读 GGUF 文件头的前 headBytes 个字节,提取 GgufShape。
 * 返回:
 *   ok        —— 头读完且字节没坏
 *   truncated —— 字节不够,外层可加大 headBytes 重试
 *   bad       —— 魔数/版本不对,不用重试
 */
export type GgufParseStatus = 'ok' | 'truncated' | 'bad'

export interface GgufParseResult {
  status: GgufParseStatus
  shape: GgufShape
}

class ShortRead extends Error {}

class Reader {
  pos = 0
  private buf: Buffer
  constructor(buf: Buffer) {
    this.buf = buf
  }
  u8(): number {
    this.need(1)
    return this.buf[this.pos++]
  }
  u16(): number {
    this.need(2)
    const v = this.buf.readUInt16LE(this.pos)
    this.pos += 2
    return v
  }
  u32(): number {
    this.need(4)
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }
  u64(): number {
    this.need(8)
    const v = Number(this.buf.readBigUInt64LE(this.pos))
    this.pos += 8
    return v
  }
  i8(): number {
    this.need(1)
    return this.buf.readInt8(this.pos++)
  }
  i16(): number {
    this.need(2)
    const v = this.buf.readInt16LE(this.pos)
    this.pos += 2
    return v
  }
  i32(): number {
    this.need(4)
    const v = this.buf.readInt32LE(this.pos)
    this.pos += 4
    return v
  }
  i64(): number {
    this.need(8)
    const v = Number(this.buf.readBigInt64LE(this.pos))
    this.pos += 8
    return v
  }
  f32(): number {
    this.need(4)
    const v = this.buf.readFloatLE(this.pos)
    this.pos += 4
    return v
  }
  f64(): number {
    this.need(8)
    const v = this.buf.readDoubleLE(this.pos)
    this.pos += 8
    return v
  }
  bytes(n: number): Buffer {
    this.need(n)
    const s = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return s
  }
  skip(n: number): void {
    this.need(n)
    this.pos += n
  }
  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new ShortRead()
  }
}

/** 单个标量值(数组元素同口径)。返回 null 表示这个类型没数可读 */
function readScalar(r: Reader, type: number): number | null {
  switch (type) {
    case 0:
      return r.u8()
    case 1:
      return r.i8()
    case 2:
      return r.u16()
    case 3:
      return r.i16()
    case 4:
      return r.u32()
    case 5:
      return r.i32()
    case 6:
      return r.f32()
    case 7:
      return r.u8() !== 0 ? 1 : 0
    case 10:
      return r.u64()
    case 11:
      return r.i64()
    case 12:
      return r.f64()
    default:
      return null
  }
}

function readString(r: Reader): string {
  const len = r.u64()
  return r.bytes(len).toString('utf8')
}

function skipValue(r: Reader, type: number): void {
  if (type === GGUF_STRING) {
    const len = r.u64()
    r.skip(len)
    return
  }
  if (type === GGUF_ARRAY) {
    const elemType = r.u32()
    const count = r.u64()
    for (let i = 0; i < count; i++) {
      if (elemType === GGUF_STRING) {
        const slen = r.u64()
        r.skip(slen)
      } else {
        const size = scalarSize(elemType)
        if (size === 0) throw new Error('unknown elem type')
        r.skip(size)
      }
    }
    return
  }
  const size = scalarSize(type)
  if (size === 0) throw new Error('unknown type')
  r.skip(size)
}

function scalarSize(type: number): number {
  switch (type) {
    case 0:
    case 1:
    case 7:
      return 1
    case 2:
    case 3:
      return 2
    case 4:
    case 5:
    case 6:
      return 4
    case 10:
    case 11:
    case 12:
      return 8
    default:
      return 0
  }
}

/** 键名撞上字段后缀时拆出「架构前缀 + 字段」;不认识的键返回 null */
function splitFieldKey(
  key: string
): { prefix: string; field: keyof Omit<GgufShape, 'architecture'> } | null {
  for (const suffix of Object.keys(FIELD_SUFFIXES)) {
    if (key.length > suffix.length && key.endsWith(suffix)) {
      return { prefix: key.slice(0, -suffix.length), field: FIELD_SUFFIXES[suffix] }
    }
  }
  return null
}

/** 按架构前缀收拢的候选档案:谁的字段多谁赢 */
type FieldBag = Partial<Record<keyof Omit<GgufShape, 'architecture'>, number>>

function bagScore(bag: FieldBag): number {
  return Object.values(bag).filter((v) => v != null).length
}

/**
 * 数组型字段的读法(例:gemma4 的 attention.head_count_kv 是每层一个值的数组)。
 * 只认纯数字数组,取最大值 —— 保守上界,黑板按最费的那层算。
 * 元素类型是字符串或个数离谱时整个跳过。
 */
function readNumberArrayMax(r: Reader): number | null {
  const elemType = r.u32()
  const count = r.u64()
  if (elemType === GGUF_STRING || elemType === GGUF_ARRAY || count <= 0 || count > 4096) {
    for (let i = 0; i < count; i++) skipValue(r, elemType)
    return null
  }
  let max: number | null = null
  for (let i = 0; i < count; i++) {
    const v = readScalar(r, elemType)
    if (v == null) {
      // 元素类型读不出数,剩下的按格式跳完就算了
      const size = scalarSize(elemType)
      for (let j = i; j < count; j++) r.skip(size)
      return null
    }
    if (max == null || v > max) max = v
  }
  return max
}

export function parseGgufHeader(buf: Buffer): GgufParseResult {
  const empty: GgufShape = {
    contextLength: null,
    blockCount: null,
    headCount: null,
    kvHeadCount: null,
    embeddingLength: null,
    architecture: null,
    expertCount: null,
    expertUsedCount: null
  }
  if (buf.length < 24) return { status: 'truncated', shape: empty }
  const dv = G(buf)
  if (dv.getUint32(0, true) !== GGH) return { status: 'bad', shape: empty }
  const version = dv.getUint32(4, true)
  if (version < 2 || version > 3) return { status: 'bad', shape: empty }
  const kvCount = Number(dv.getBigUint64(16, true))

  const r = new Reader(buf)
  r.pos = 24
  let archName: string | null = null
  // 按架构前缀分兜收集:gemma4.* 进 gemma4 兜,llama.* 进 llama 兜,互不打架
  const bags = new Map<string, FieldBag>()
  const bagOrder: string[] = []
  try {
    for (let i = 0; i < kvCount; i++) {
      const key = readString(r)
      const type = r.u32()
      // general.architecture 是户口页,先登记但不进字段兜
      if (key === 'general.architecture' && type === GGUF_STRING) {
        archName = readString(r)
        continue
      }
      const hit = splitFieldKey(key)
      if (!hit) {
        skipValue(r, type)
        continue
      }
      let value: number | null
      if (type === GGUF_ARRAY) {
        value = readNumberArrayMax(r)
      } else {
        value = readScalar(r, type)
        if (value == null) {
          skipValue(r, type)
          continue
        }
      }
      if (value == null) continue
      if (!bags.has(hit.prefix)) {
        bags.set(hit.prefix, {})
        bagOrder.push(hit.prefix)
      }
      bags.get(hit.prefix)![hit.field] = value
    }
  } catch (e) {
    if (e instanceof ShortRead) return { status: 'truncated', shape: empty }
    return { status: 'bad', shape: empty }
  }

  // 挑兜:general.architecture 点名的优先,没有就 llama.* 兜底(老转档惯例),再没有取字段最全的
  let winner: FieldBag | null = null
  if (archName && bags.has(archName)) {
    winner = bags.get(archName)!
  } else if (bags.has('llama')) {
    winner = bags.get('llama')!
  } else {
    for (const name of bagOrder) {
      const bag = bags.get(name)!
      if (!winner || bagScore(bag) > bagScore(winner)) winner = bag
    }
  }

  const shape: GgufShape = {
    contextLength: winner?.contextLength ?? null,
    blockCount: winner?.blockCount ?? null,
    headCount: winner?.headCount ?? null,
    kvHeadCount: winner?.kvHeadCount ?? null,
    embeddingLength: winner?.embeddingLength ?? null,
    // 户口页写谁就是谁;没写但兜里有货就报那个前缀(推断出来的)
    architecture:
      archName ?? (winner ? (bagOrder.find((n) => bags.get(n) === winner) ?? null) : null),
    expertCount: winner?.expertCount ?? null,
    expertUsedCount: winner?.expertUsedCount ?? null
  }
  return { status: 'ok', shape }
}
