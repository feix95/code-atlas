import type { GgufShape } from './types.ts'

/**
 * 上下文档位的账本(纯函数,自测覆盖):滑块的档、黑板的账、大白话的结论都在这里算,
 * 设置页拖一下滑块就得重新报一次价,所以必须快 —— 全是算术,不发请求不读文件。
 */

/** 上下文档位(程序员老规矩,2 的幂):滑块一格一档,拖到哪格输入框填哪个数 */
export const CONTEXT_NOTCHES = [4096, 8192, 16384, 32768, 65536, 131072]
/** 模型档案翻不出出厂上限时的滑块顶格兜底 */
export const FALLBACK_CONTEXT_CAP = 65536

const GB = 1024 ** 3

/**
 * 黑板(KV 缓存)精算:照模型档案里的真实结构算 —— K、V 各一份,f16 存(引擎默认两字节)。
 * 档案缺条目算不出时回 null,调用方退到粗估。
 */
export function kvBytesFromShape(contextTokens: number, shape: GgufShape): number | null {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return null
  const { blockCount, headCount, kvHeadCount, embeddingLength } = shape
  if (blockCount === null || headCount === null || kvHeadCount === null || embeddingLength === null) return null
  if (blockCount <= 0 || headCount <= 0 || kvHeadCount <= 0) return null
  const headDim = embeddingLength / headCount
  if (!Number.isFinite(headDim) || headDim <= 0) return null
  return Math.round(2 * blockCount * kvHeadCount * headDim * contextTokens * 2)
}

/**
 * 黑板粗估(档案翻不出来时的兜底,和量尺同一套分档):≥8GB 按 64 层大模型算每 token
 * 256KB,4~8GB 减半,更小的再减半 —— 宁可粗,不可无;账单的话里会标明是估的。
 */
export function estimateKvBytes(contextTokens: number, modelBytes: number): number {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return 0
  const perToken = modelBytes >= 8 * GB ? 256 * 1024 : modelBytes >= 4 * GB ? 128 * 1024 : 64 * 1024
  return Math.round(contextTokens * perToken)
}

export interface ContextBill {
  level: 'ok' | 'tight' | 'too-big' | 'unknown'
  text: string
}

function formatGB(bytes: number): string {
  return `${(bytes / GB).toFixed(1).replace(/\.0$/, '')} GB`
}

/**
 * 实时黑板账单(纯函数):模型块头 + 上下文黑板 vs 显存/内存,大白话一句。
 * 有模型档案就精算,没有就按块头粗估;输入框留空 = 交回自动探测,按默认档算账并注明。
 */
export function formatContextBill(opts: {
  contextTokens: number
  isAuto: boolean
  modelBytes: number | null
  shape: GgufShape | null
  ramBytes: number
  vramBytes: number | null
}): ContextBill {
  if (opts.modelBytes === null) {
    return { level: 'unknown', text: '模型文件还没选好或读不到,黑板账先算不了' }
  }
  const exact = opts.shape ? kvBytesFromShape(opts.contextTokens, opts.shape) : null
  const kv = exact ?? estimateKvBytes(opts.contextTokens, opts.modelBytes)
  const kvHow = exact !== null ? '照模型结构精算' : '按块头粗估'
  const need = opts.modelBytes + kv
  const head = opts.isAuto
    ? `上下文留空 = 自动探测,这账先按默认 ${opts.contextTokens} tokens 算:`
    : `按 ${opts.contextTokens} tokens 算:`
  const total = `模型 ${formatGB(opts.modelBytes)} + 上下文黑板 ${formatGB(kv)}(${kvHow})≈ ${formatGB(need)}`
  if (opts.vramBytes !== null && opts.vramBytes > 0) {
    if (need <= opts.vramBytes * 0.9) {
      return { level: 'ok', text: `${head}${total},显存 ${formatGB(opts.vramBytes)} —— 整个进显卡,稳` }
    }
    if (need <= opts.vramBytes + opts.ramBytes * 0.5) {
      return {
        level: 'tight',
        text: `${head}${total},超出显存 ${formatGB(opts.vramBytes)},多出来的落内存 —— 能跑,读大材料会变慢`
      }
    }
    return {
      level: 'too-big',
      text: `${head}${total},连显存 ${formatGB(opts.vramBytes)} 带内存一起匀也紧张 —— 这么配引擎可能当场撑死,画面跟着整个断掉;把上下文调小几档`
    }
  }
  // 问不到显存:只拿内存说话
  if (need <= opts.ramBytes * 0.5) {
    return { level: 'ok', text: `${head}${total},内存 ${formatGB(opts.ramBytes)} —— 装得下` }
  }
  if (need <= opts.ramBytes * 0.7) {
    return { level: 'tight', text: `${head}${total},内存 ${formatGB(opts.ramBytes)} —— 塞得下但系统会挤,跑起来偏慢` }
  }
  return {
    level: 'too-big',
    text: `${head}${total},内存 ${formatGB(opts.ramBytes)} 匀不开 —— 这么配引擎可能当场撑死,画面跟着整个断掉;把上下文调小几档`
  }
}
