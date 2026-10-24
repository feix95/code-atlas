// 每个模型的「高级启动」登记:override 存档/清洗、
// 专家命令行解析、重启对账签名。纯函数,不碰文件/进程,渲染层与主进程共用一份。
// 规矩:默认全自动(什么都不存);用户指定过的字段按模型文件各自记同一数据源,换模型不串门。

/** 用户可指定的启动字段(LaunchOverrides 去掉 contextSize —— 上下文归「上下文窗口」独管,不两头记账) */
export interface LaunchFieldOverrides {
  gpuLayers?: 'auto' | number
  kvCache?: 'f16' | 'q8_0'
  flashAttn?: 'auto' | 'on'
  mmprojOffload?: boolean
}

/** 一个模型文件的高级启动账:overrides 是字段级指定,extraArgs 是专家命令行原文 */
export interface ModelLaunchSettings {
  overrides?: LaunchFieldOverrides
  extraArgs?: string
}

/** 存档上限:最多记 64 个模型的账,再老的丢掉(防配置文件无限膨胀) */
const MAX_LAUNCH_ENTRIES = 64
const EXTRA_ARGS_MAX = 300
/** 原型链雷区:这些键进对象会污染原型,一律拒收 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** 模型路径 → 状态表键:统一反斜杠 + 小写(Windows 大小写不敏感,A/B 盘符混写也认同同一数据源) */
export function normalizeModelPathKey(p: string): string {
  return p.trim().replace(/\//g, '\\').toLowerCase()
}

/** 清洗一份 overrides:白名单收账,不认识的字段/越界的值直接丢 */
export function sanitizeLaunchOverrides(raw: unknown): LaunchFieldOverrides {
  const out: LaunchFieldOverrides = {}
  if (!raw || typeof raw !== 'object') return out
  const o = raw as Record<string, unknown>
  if (o.gpuLayers === 'auto') out.gpuLayers = 'auto'
  else if (
    typeof o.gpuLayers === 'number' &&
    Number.isInteger(o.gpuLayers) &&
    o.gpuLayers >= 0 &&
    o.gpuLayers <= 999
  )
    out.gpuLayers = o.gpuLayers
  if (o.kvCache === 'f16' || o.kvCache === 'q8_0') out.kvCache = o.kvCache
  if (o.flashAttn === 'auto' || o.flashAttn === 'on') out.flashAttn = o.flashAttn
  if (o.mmprojOffload === true || o.mmprojOffload === false) out.mmprojOffload = o.mmprojOffload
  return out
}

/** 清洗一份单模型账:洗完全空就回 null(空账不入存档) */
export function sanitizeModelLaunchSettings(raw: unknown): ModelLaunchSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const overrides = sanitizeLaunchOverrides(o.overrides)
  // 超长的专家命令行整段丢(截断会切出半个参数,更危险)
  const extraArgs =
    typeof o.extraArgs === 'string' &&
    o.extraArgs.trim() !== '' &&
    o.extraArgs.length <= EXTRA_ARGS_MAX
      ? o.extraArgs.trim()
      : undefined
  const hasOverrides = Object.keys(overrides).length > 0
  if (!hasOverrides && extraArgs === undefined) return null
  const out: ModelLaunchSettings = {}
  if (hasOverrides) out.overrides = overrides
  if (extraArgs !== undefined) out.extraArgs = extraArgs
  return out
}

/** 清洗整本账(配置读写共用):危险键跳过、空账不收、最多 64 本 ——
 *  超编时挤掉最旧的一本(按对象键序,先写的先走) */
export function sanitizeLaunchRecord(raw: unknown): Record<string, ModelLaunchSettings> {
  const out: Record<string, ModelLaunchSettings> = {}
  if (!raw || typeof raw !== 'object') return out
  const valid: Array<[string, ModelLaunchSettings]> = []
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) continue
    const key = normalizeModelPathKey(k)
    if (!key) continue
    const s = sanitizeModelLaunchSettings(v)
    if (s) valid.push([key, s])
  }
  for (const [key, s] of valid.slice(-MAX_LAUNCH_ENTRIES)) out[key] = s
  return out
}

/** 取某个模型自己的高级账(没有就是 null,即全自动)。hasOwnProperty 查键:
 *  模型路径万一撞上 'constructor' 这类原型链名字,也不会把 Object.prototype 的成员当账 */
export function launchFor(
  settings: { modelPath: string; launch?: Record<string, ModelLaunchSettings> },
  modelPath?: string
): ModelLaunchSettings | null {
  const key = normalizeModelPathKey(modelPath ?? settings.modelPath)
  if (!key || !settings.launch) return null
  return Object.prototype.hasOwnProperty.call(settings.launch, key)
    ? (settings.launch[key] ?? null)
    : null
}

/** 重启对账签名:overrides + 专家命令行折成稳定串;全自动 = 空串。
 *  改任何一项签名就变,引擎下次提问照新参数重拉;没变签名一致,不误重启 */
export function launchSignature(s: ModelLaunchSettings | null | undefined): string {
  if (!s) return ''
  const parts: string[] = []
  const ov = s.overrides
  if (ov?.gpuLayers !== undefined) parts.push(`gl:${ov.gpuLayers}`)
  if (ov?.kvCache !== undefined) parts.push(`kv:${ov.kvCache}`)
  if (ov?.flashAttn !== undefined) parts.push(`fa:${ov.flashAttn}`)
  if (ov?.mmprojOffload !== undefined) parts.push(`mo:${ov.mmprojOffload ? 1 : 0}`)
  const extra = (s.extraArgs ?? '').trim()
  if (extra) parts.push(`x:${extra}`)
  return parts.join('|')
}

// 专家命令行解析
// 白名单两本账:带值旗(后面必须跟一个值)与光杆旗。--temp 这类采样参数故意不在 —
// 采样由每次请求自己决定,引擎层不许抢戏。

/** 后面必须跟一个值的旗(短写/长写都收) */
const VALUE_FLAGS = new Set([
  '-t',
  '--threads',
  '-tb',
  '--threads-batch',
  '-b',
  '--batch-size',
  '-ub',
  '--ubatch-size',
  '-np',
  '--parallel',
  '-ncmoe',
  '--n-cpu-moe',
  '-sm',
  '--split-mode',
  '-ts',
  '--tensor-split',
  '-mg',
  '--main-gpu',
  '-ot',
  '--override-tensor',
  '--rope-scaling',
  '--rope-freq-base',
  '--rope-freq-scale',
  '--cache-reuse'
])

/** 不需要值的旗(-cmoe/--cpu-moe 在真引擎里就是把专家全摊内存的光杆开关) */
const BARE_FLAGS = new Set(['--no-mmap', '--mlock', '-cmoe', '--cpu-moe'])

/** 所有合法旗(界面提示要列的那份) */
export const EXTRA_ARGS_ALLOWED: readonly string[] = [
  '-t/--threads',
  '-tb/--threads-batch',
  '-b/--batch-size',
  '-ub/--ubatch-size',
  '-np/--parallel',
  '-ncmoe/--n-cpu-moe',
  '-cmoe/--cpu-moe',
  '-sm/--split-mode',
  '-ts/--tensor-split',
  '-mg/--main-gpu',
  '-ot/--override-tensor',
  '--rope-scaling',
  '--rope-freq-base',
  '--rope-freq-scale',
  '--no-mmap',
  '--mlock',
  '--cache-reuse'
]

const SHELL_META = /[&|;<>`$^"'\r\n]/

export type ExtraArgsResult = { ok: true; args: string[] } | { ok: false; reason: string }

/**
 * 专家命令行 → 参数数组:空白分词(不认引号),旗只收白名单,
 * 带值旗后面必须有一个值(负数以「-数字」开头也算值),壳层元字符整串拒收。
 */
export function parseExtraArgs(text: string): ExtraArgsResult {
  if (text.length > EXTRA_ARGS_MAX) {
    return { ok: false, reason: `太长了，最多 ${EXTRA_ARGS_MAX} 字` }
  }
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, args: [] }
  const badChar = trimmed.match(SHELL_META)
  if (badChar) return { ok: false, reason: `含有不支持的符号 ${badChar[0]}` }
  const tokens = trimmed.split(/\s+/)
  const args: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (BARE_FLAGS.has(t)) {
      args.push(t)
      continue
    }
    if (VALUE_FLAGS.has(t)) {
      const v = tokens[i + 1]
      if (v === undefined) return { ok: false, reason: `参数 ${t} 缺少值` }
      // 值不许是另一个旗;负数(-1/-0.5)放行
      if (v.startsWith('-') && !/^-\d/.test(v)) {
        return { ok: false, reason: `${t} 的值不能是参数 ${v}` }
      }
      args.push(t, v)
      i++
      continue
    }
    if (t.startsWith('-')) return { ok: false, reason: `不支持参数 ${t}` }
    return { ok: false, reason: `参数和值要成对写，${t} 前缺少参数名` }
  }
  return { ok: true, args }
}
