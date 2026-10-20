// ── 视觉模型的「眼睛」配对(视觉能力批次):llama-server 看图要 --mmproj 投影仪文件 ──
// 规矩:模型文件同目录里找名字含 "mmproj" 的 .gguf;找到才加参数,找不到按纯文本跑。
// 多只候选(一个目录放了好几个 mmproj)挑跟模型名最亲的,并列再按精度 f16>bf16>f32。
// 歧义防线:目录里躺了不止一只模型时,候选必须跟模型有「家名词」亲缘才敢用 ——
// 别家的 mmproj 硬套过来,引擎不是看不了图,是直接起不来。

import { readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** 两个文件名的最长公共前缀长度(不区分大小写):挑「跟模型同一家」的 mmproj 用 */
function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/**
 * 候选名字的精度分:bf16 的名字里顺带含子串 "f16",必须用「非字母数字边界」认,
 * 先认 bf16 这个更长的名号 —— 不然 bf16 文件会被冒领成 f16。
 */
function precisionRank(name: string): number {
  const n = name.toLowerCase()
  if (/(?:^|[^a-z0-9])f16(?:[^0-9]|$)/.test(n)) return 3
  if (/(?:^|[^a-z0-9])bf16(?:[^0-9]|$)/.test(n)) return 2
  if (/(?:^|[^a-z0-9])f32(?:[^0-9]|$)/.test(n)) return 1
  return 0
}

/** 量化/精度词:f16/bf16/f32 与 q8_0、q4_k_m 这类量化档(切词后 /^q\d/ 开头的) */
const PRECISION_WORD = /^(?:f16|bf16|f32|q\d.*)$/

/**
 * 文件名 → 「家名词」集合:去 .gguf 后缀,按 [-_. ] 切词,丢掉 mmproj、
 * 精度词和短词(<3 字符,型号代号如 v、7b 噪音太大不算亲缘),剩下的是家门记号。
 */
function familyWords(fileName: string): Set<string> {
  return new Set(
    fileName
      .replace(/\.gguf$/i, '')
      .toLowerCase()
      .split(/[-_.\s]+/)
      .filter((w) => w.length >= 3 && w !== 'mmproj' && !PRECISION_WORD.test(w))
  )
}

/** 候选与模型有没有家名词亲缘:至少共享一个词(如 gemma/qwen2/minicpm) */
function sharesKinWord(modelFileName: string, candidateFileName: string): boolean {
  const cand = familyWords(candidateFileName)
  for (const w of familyWords(modelFileName)) if (cand.has(w)) return true
  return false
}

/**
 * 在一堆同目录文件名里挑该喂给 --mmproj 的那只(纯函数,自测覆盖):
 * 认 .gguf 且名字含 mmproj;0 只回 null;1 只直接用;多只按「与模型文件名的
 * 最长公共前缀」最长优先,并列按精度 f16 > bf16 > f32 > 其他,再并列按字母序。
 * 歧义防线:目录里非 mmproj 的 .gguf 超过一只(多模型平铺)时,候选必须先过
 * 家名词亲缘关,全无亲缘回 null —— 宁可按纯文本跑,也不给引擎塞错投影仪。
 */
export function pickMmproj(modelPath: string, siblingFileNames: string[]): string | null {
  const modelName = basename(modelPath).toLowerCase()
  const isGguf = (n: string) => n.toLowerCase().endsWith('.gguf')
  const isMmproj = (n: string) => isGguf(n) && n.toLowerCase().includes('mmproj')
  const crowded = siblingFileNames.filter((n) => isGguf(n) && !isMmproj(n)).length > 1
  let candidates = siblingFileNames.filter(isMmproj)
  if (candidates.length === 0) return null
  if (crowded) {
    candidates = candidates.filter((c) => sharesKinWord(modelName, c))
    if (candidates.length === 0) return null
  }
  if (candidates.length === 1) return candidates[0]
  return [...candidates].sort(
    (a, b) =>
      commonPrefixLen(modelName, b.toLowerCase()) - commonPrefixLen(modelName, a.toLowerCase()) ||
      precisionRank(b) - precisionRank(a) ||
      a.toLowerCase().localeCompare(b.toLowerCase())
  )[0]
}

/**
 * 启动保险丝判定(纯函数,自测覆盖):这次启动带了 mmproj,且引擎是「自己退了」
 * 型失败(进程已退出,不是还在慢慢热身的超时)→ 值得摘掉 --mmproj 按纯文本重拉一次。
 * 没带 mmproj 的失败不该降级重试(模型坏了/显存不够,重拉也白搭)。
 */
export function shouldRetryWithoutMmproj(
  usedMmproj: string | null,
  engineExited: boolean
): boolean {
  return usedMmproj !== null && engineExited
}

/** 读模型所在目录挑 mmproj(读目录失败按没有处理,不拦启动);命中回绝对路径 */
export function findMmprojFor(modelPath: string): string | null {
  const p = modelPath.trim()
  if (!p) return null
  const dir = dirname(p)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  const picked = pickMmproj(p, names)
  return picked ? join(dir, picked) : null
}
