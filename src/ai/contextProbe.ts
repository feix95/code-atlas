/* 模型上下文自适应:LM 那边最清楚自己脑子多大,问它;预算按比例算  */
import type { AiProviderKind, ChatTarget } from '../shared/types.ts'
import { parseLoadProgress } from './builtin.ts'
import { CONTEXT_SIZE_MIN, DEFAULT_CONTEXT_SIZE, PROBE_LMSTUDIO_MS } from '../shared/aiDefaults.ts'
import { fetchWithTimeout, stripApiSuffix } from './http.ts'

/** LM Studio 扩展接口的模型列表 → 目标模型的上下文长度(纯函数;认不出回 null) */
export function parseLmStudioContext(raw: string, model: string): number | null {
  try {
    const data = JSON.parse(raw) as {
      data?: Array<{ id?: string; loaded_context_length?: number; max_context_length?: number }>
    }
    const hit = (data.data ?? []).find((m) => m.id === model)
    const ctx = hit?.loaded_context_length ?? hit?.max_context_length
    return typeof ctx === 'number' && Number.isFinite(ctx) && ctx >= CONTEXT_SIZE_MIN
      ? Math.round(ctx)
      : null
  } catch {
    return null
  }
}

/** llama-server /props 的回复 → 实际加载的 n_ctx(纯函数;认不出回 null) */
export function parseLlamaProps(raw: string): number | null {
  try {
    const data = JSON.parse(raw) as {
      default_generation_settings?: { n_ctx?: number }
      n_ctx?: number
    }
    const ctx = data.default_generation_settings?.n_ctx ?? data.n_ctx
    return typeof ctx === 'number' && Number.isFinite(ctx) && ctx >= CONTEXT_SIZE_MIN
      ? Math.round(ctx)
      : null
  } catch {
    return null
  }
}

/**
 * LM Studio /api/v0/models 的模型条目 → 状态栏要的加载状态(纯函数,自测覆盖)。
 * state:loaded→就绪、loading→热身、not-loaded/查无此模型→还没叫醒;
 * 进度复用 parseLoadProgress 的换算规矩,它没报就 null,绝不编数。
 */
export function parseLmStudioModelState(
  raw: unknown,
  model: string
): { state: 'idle' | 'loading' | 'ready'; progress: number | null } {
  type LmModelEntry = { id?: unknown; state?: unknown; progress?: unknown }
  const list: unknown[] =
    raw !== null && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)
      ? (raw as { data: unknown[] }).data
      : Array.isArray(raw)
        ? raw
        : []
  const hit = list.find(
    (m): m is LmModelEntry =>
      m !== null && typeof m === 'object' && (m as LmModelEntry).id === model
  )
  const state = hit?.state
  if (state === 'loaded') return { state: 'ready', progress: 100 }
  if (state === 'loading') return { state: 'loading', progress: parseLoadProgress(hit) }
  return { state: 'idle', progress: null }
}

/** 探测结果的小缓存:同地址同模型 5 分钟内不重复问,本地请求虽快也没必要每次都发 */
const ctxProbeCache = new Map<string, { value: number | null; at: number }>()
const CTX_PROBE_TTL_MS = 5 * 60 * 1000

/**
 * 向模型服务探测上下文大小(LM Studio 走 /api/v0/models,llama-server 走 /props)。
 * 探测失败(接口没开/版本太老/认不出)安静回 null,由调用层退回手动档或保守默认。
 * 在线 API 没有统一的上下文查询口,不发请求直接回 null(用设置里选的档)。
 */
export async function probeContextSize(
  target: ChatTarget,
  kind: AiProviderKind
): Promise<number | null> {
  if (kind === 'cloud') return null
  const key = `${target.baseUrl}|${target.model}`
  const cached = ctxProbeCache.get(key)
  if (cached && Date.now() - cached.at < CTX_PROBE_TTL_MS) return cached.value
  const root = stripApiSuffix(target.baseUrl)
  let value: number | null = null
  try {
    if (kind === 'lmstudio') {
      const res = await fetchWithTimeout(`${root}/api/v0/models`, PROBE_LMSTUDIO_MS)
      if (res.ok) value = parseLmStudioContext(await res.text(), target.model)
    } else {
      const res = await fetchWithTimeout(`${root}/props`, PROBE_LMSTUDIO_MS)
      if (res.ok) value = parseLlamaProps(await res.text())
    }
  } catch {
    value = null
  }
  ctxProbeCache.set(key, { value, at: Date.now() })
  return value
}

/** 回复预算的封顶:8k 档守住 1024 不挤地图,10k 起给满 2048(研究结论/清单不再被腰斩) */
const REPLY_TOKENS_CAP = 2048
const REPLY_TOKENS_RAISED_CONTEXT_MIN = 10240

/** 按真实上下文算各路预算(纯函数):地图 ≈ 55%,回复 ≈ 20%;两端各留安全下限 */
export function budgetsForContext(ctx: number): { mapTokens: number; replyTokens: number } {
  const safe = ctx >= CONTEXT_SIZE_MIN ? ctx : DEFAULT_CONTEXT_SIZE
  return {
    mapTokens: Math.max(600, Math.floor(safe * 0.55)),
    replyTokens:
      safe >= REPLY_TOKENS_RAISED_CONTEXT_MIN
        ? REPLY_TOKENS_CAP
        : Math.max(256, Math.min(1024, Math.floor(safe * 0.2)))
  }
}

/**
 * 上下文认主:内置引擎按真正喂给 -c 的档位算 —— 启动梯子可能把手填的 16k 降到 12k/8k,
 * 预算再按手填值算就会把引擎的上下文挤爆(2026-10-25 M0 截断案)。
 * launched 为空(引擎还没起来)时才退回手填值,再不行吃探测,最后按默认窗口兜底。
 * LM Studio / 在线 API 没有 -c 这回事:LM Studio 只信探测,在线 API 认设置里选的档。
 */
export function resolveContextSize(
  provider: AiProviderKind,
  manual: number | undefined,
  probed: number | null,
  launched: number | null = null
): number {
  if (provider === 'builtin' && launched !== null && launched >= CONTEXT_SIZE_MIN) return launched
  if (provider !== 'lmstudio' && manual !== undefined && manual >= CONTEXT_SIZE_MIN) return manual
  return probed !== null && probed >= CONTEXT_SIZE_MIN ? probed : DEFAULT_CONTEXT_SIZE
}
