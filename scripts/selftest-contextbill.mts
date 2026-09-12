// 上下文档位账本的自测:GGUF 档案头解析(该抓的抓/该跳的跳/坏账认得清)、
// 黑板精算与粗估、账单各档位的人话结论 —— 账本报错一个数,用户就被骗着塞爆一次内存。
// 纯函数 + 内存里手搓的迷你 GGUF 头,不碰任何真文件。
import assert from 'node:assert/strict'
import { parseGgufHeader } from '../src/shared/gguf.ts'
import {
  CONTEXT_NOTCHES,
  FALLBACK_CONTEXT_CAP,
  estimateKvBytes,
  formatContextBill,
  kvBytesFromShape
} from '../src/shared/contextBill.ts'

const GB = 1024 ** 3

/** 手搓最小 GGUF 头:只拼键值对,build 时补魔数/版本/张量数/键值数 */
class GgufBuilder {
  private entries: Buffer[] = []
  private kvCount = 0

  private keyBytes(s: string): Buffer[] {
    const text = Buffer.from(s, 'utf8')
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(BigInt(text.length))
    return [len, text]
  }

  private typeBytes(t: number): Buffer {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(t)
    return b
  }

  u32(key: string, v: number): this {
    this.kvCount++
    const b = Buffer.alloc(4)
    b.writeUInt32LE(v)
    this.entries.push(...this.keyBytes(key), this.typeBytes(4), b)
    return this
  }

  u64(key: string, v: bigint): this {
    this.kvCount++
    const b = Buffer.alloc(8)
    b.writeBigUInt64LE(v)
    this.entries.push(...this.keyBytes(key), this.typeBytes(10), b)
    return this
  }

  f32(key: string, v: number): this {
    this.kvCount++
    const b = Buffer.alloc(4)
    b.writeFloatLE(v)
    this.entries.push(...this.keyBytes(key), this.typeBytes(6), b)
    return this
  }

  str(key: string, s: string): this {
    this.kvCount++
    const text = Buffer.from(s, 'utf8')
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(BigInt(text.length))
    this.entries.push(...this.keyBytes(key), this.typeBytes(8), len, text)
    return this
  }

  strArray(key: string, items: string[]): this {
    this.kvCount++
    const count = Buffer.alloc(8)
    count.writeBigUInt64LE(BigInt(items.length))
    const elems: Buffer[] = [this.typeBytes(8), count]
    for (const s of items) {
      const text = Buffer.from(s, 'utf8')
      const len = Buffer.alloc(8)
      len.writeBigUInt64LE(BigInt(text.length))
      elems.push(len, text)
    }
    this.entries.push(...this.keyBytes(key), this.typeBytes(9), ...elems)
    return this
  }

  build(): Buffer {
    const head = Buffer.alloc(24)
    Buffer.from([0x47, 0x47, 0x55, 0x46]).copy(head, 0) // 'GGUF'
    head.writeUInt32LE(3, 4) // version
    head.writeBigUInt64LE(0n, 8) // tensorCount
    head.writeBigUInt64LE(BigInt(this.kvCount), 16)
    return Buffer.concat([head, ...this.entries])
  }
}

const FULL_SHAPE = {
  contextLength: 131072,
  blockCount: 32,
  headCount: 32,
  kvHeadCount: 8,
  embeddingLength: 4096
}

function main(): void {
  // ── 1. GGUF 头解析:要紧的抓下来,词表/无关键按格式跳过去 ──
  const buf = new GgufBuilder()
    .u32('llama.context_length', 131072)
    .u32('llama.block_count', 32)
    .u32('llama.attention.head_count', 32)
    .u32('llama.attention.head_count_kv', 8)
    .u32('llama.embedding_length', 4096)
    .str('general.architecture', 'qwen2')
    .f32('some.float.key', 1.5)
    .u64('some.big.key', 5_000_000_000n)
    .strArray('tokenizer.ggml.tokens', ['hello', 'world', ''])
    .u32('llama.rope.freq_base', 5000000)
    .build()
  const parsed = parseGgufHeader(buf)
  assert.equal(parsed.status, 'ok', '正经 GGUF 头应该解析成功')
  if (parsed.status !== 'ok') throw new Error('unreachable')
  assert.equal(parsed.shape.contextLength, 131072, '出厂上下文上限抓得到')
  assert.equal(parsed.shape.blockCount, 32, '层数抓得到')
  assert.equal(parsed.shape.headCount, 32, '头数抓得到')
  assert.equal(parsed.shape.kvHeadCount, 8, 'KV 头数抓得到(GQA 减半那活)')
  assert.equal(parsed.shape.embeddingLength, 4096, '嵌入维度抓得到')

  // ── 2. 坏账/没读完,两种身份分得清 ──
  assert.equal(parseGgufHeader(Buffer.alloc(32, 0x4e)).status, 'bad', '魔数不对 = 坏账')
  assert.equal(parseGgufHeader(Buffer.alloc(10)).status, 'truncated', '头部没读完 = 截断')
  const badVersion = Buffer.alloc(24)
  Buffer.from([0x47, 0x47, 0x55, 0x46]).copy(badVersion, 0)
  badVersion.writeUInt32LE(1, 4)
  assert.equal(parseGgufHeader(badVersion).status, 'bad', '版本太老 = 坏账')
  // 截断在词表数组中间:得认成「没读完」而不是「坏账」,外层才好加码重读
  const cutInVocab = new GgufBuilder()
    .u32('llama.context_length', 4096)
    .strArray('tokenizer.ggml.tokens', ['hello', 'world'])
    .build()
    .subarray(0, 60)
  assert.equal(parseGgufHeader(cutInVocab).status, 'truncated', '截断在数组中间认成截断')

  // ── 3. 黑板精算:照真实结构,K+V 两份、f16 两字节 ──
  // 每 token = 2 × 32层 × 8头 × 128宽 × 2字节 = 128KB
  assert.equal(kvBytesFromShape(8192, FULL_SHAPE), 1073741824, '8192 tokens = 1 GiB 黑板')
  assert.equal(kvBytesFromShape(0, FULL_SHAPE), null, '上下文 0 不算账')
  assert.equal(kvBytesFromShape(8192, { ...FULL_SHAPE, headCount: null }), null, '档案缺条目算不出')
  assert.equal(kvBytesFromShape(Number.NaN, FULL_SHAPE), null, 'NaN 不算账')

  // ── 4. 粗估兜底(和量尺同一套分档,老断言搬家过来) ──
  assert.equal(estimateKvBytes(4096, 14.26 * GB), 4096 * 256 * 1024, '≥8GB 大模型按 256KB/token 估')
  assert.equal(estimateKvBytes(4096, 6 * GB), 4096 * 128 * 1024, '4~8GB 减半')
  assert.equal(estimateKvBytes(4096, 2 * GB), 4096 * 64 * 1024, '<4GB 再减半')
  assert.equal(estimateKvBytes(0, 14.26 * GB), 0, '上下文 0 不估')
  assert.equal(estimateKvBytes(Number.NaN, 14.26 * GB), 0, 'NaN 不估')

  // ── 5. 账单各档位:数字说话,人话收尾 ──
  const bill = (over: Partial<Parameters<typeof formatContextBill>[0]>): string =>
    formatContextBill({
      contextTokens: 8192,
      isAuto: false,
      modelBytes: 10 * GB,
      shape: FULL_SHAPE,
      ramBytes: 64 * GB,
      vramBytes: 24 * GB,
      ...over
    }).text
  assert.equal(formatContextBill({ contextTokens: 8192, isAuto: false, modelBytes: null, shape: FULL_SHAPE, ramBytes: 64 * GB, vramBytes: 24 * GB }).level, 'unknown', '没模型没法算账')
  assert.equal(bill({}).startsWith('按 8192 tokens 算:'), true, '手动档开头报账基数')
  assert.ok(bill({}).includes('照模型结构精算'), '有档案就说明是精算')
  assert.ok(bill({}).includes('整个进显卡'), '绰绰有余就报稳')
  const tight = formatContextBill({ contextTokens: 131072, isAuto: false, modelBytes: 10 * GB, shape: FULL_SHAPE, ramBytes: 64 * GB, vramBytes: 24 * GB })
  assert.equal(tight.level, 'tight', '10GB 模型 + 128k 黑板 ≈ 26GB,24GB 卡落内存 = 有点挤')
  const tooBig = formatContextBill({ contextTokens: 131072, isAuto: false, modelBytes: 10 * GB, shape: FULL_SHAPE, ramBytes: 8 * GB, vramBytes: 4 * GB })
  assert.equal(tooBig.level, 'too-big', '连内存一起匀不开 = 装不下')
  assert.ok(tooBig.text.includes('画面跟着整个断掉'), '装不下的话里点破上次那种炸法')
  // 没问到显存的老机器:只拿内存说话
  const ramEdge = formatContextBill({ contextTokens: 32768, isAuto: false, modelBytes: 2 * GB, shape: null, ramBytes: 8 * GB, vramBytes: null })
  assert.equal(ramEdge.level, 'ok', '纯内存机型:2GB 模型 + 粗估 2GB 黑板 = 4GB,刚好压线内存一半')
  const ramOnly = formatContextBill({ contextTokens: 65536, isAuto: false, modelBytes: 2 * GB, shape: null, ramBytes: 8 * GB, vramBytes: null })
  assert.equal(ramOnly.level, 'too-big', '纯内存机型:2GB 模型 + 粗估 4GB 黑板 = 6GB,超出 8GB 内存七成线')
  assert.ok(ramOnly.text.includes('按块头粗估'), '没档案就老实承认是估的')
  const auto = formatContextBill({ contextTokens: 16384, isAuto: true, modelBytes: 10 * GB, shape: FULL_SHAPE, ramBytes: 64 * GB, vramBytes: 24 * GB })
  assert.ok(auto.text.startsWith('上下文留空'), '留空自动档注明按默认算')

  // ── 6. 档位表:2 的幂,出厂上限封顶,翻不出档案按 64k 兜底 ──
  assert.deepEqual(CONTEXT_NOTCHES, [4096, 8192, 16384, 32768, 65536, 131072], '档位就是 4k~128k')
  assert.deepEqual(
    CONTEXT_NOTCHES.filter((n) => n <= 32768),
    [4096, 8192, 16384, 32768],
    '出厂 32k 的模型,64k/128k 两档不出现'
  )
  assert.deepEqual(
    CONTEXT_NOTCHES.filter((n) => n <= FALLBACK_CONTEXT_CAP),
    [4096, 8192, 16384, 32768, 65536],
    '档案翻不出时兜底顶格 64k'
  )

  console.log('selftest-contextbill: 全部通过')
}

main()
