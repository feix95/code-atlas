/* ── 模型上下文自适应(第六十九锤):LM 那边最清楚自己脑子多大,问它;预算按比例算 ── */
import type { ChatTarget } from '../shared/types.ts'
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
 */
export async function probeContextSize(
  target: ChatTarget,
  kind: 'lmstudio' | 'builtin'
): Promise<number | null> {
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

/** 按真实上下文算各路预算(纯函数):地图 ≈ 55%,回复 ≈ 20%;两端各留安全下限 */
export function budgetsForContext(ctx: number): { mapTokens: number; replyTokens: number } {
  const safe = ctx >= CONTEXT_SIZE_MIN ? ctx : DEFAULT_CONTEXT_SIZE
  return {
    mapTokens: Math.max(600, Math.floor(safe * 0.55)),
    replyTokens: Math.max(256, Math.min(1024, Math.floor(safe * 0.2)))
  }
}

/**
 * 上下文认主:手动填的「模型上下文」只属于内置引擎 —— 它是真参数,
 * 直接喂给引擎的 -c;LM Studio 的锅归 LM Studio 管,App 一律只信探测,存档里的手填数不看
 * (不然设置页藏了字段,旧数还隐身管事)。探测失败(接口没开全/版本老)按默认窗口兜底。
 */
export function resolveContextSize(
  provider: 'builtin' | 'lmstudio',
  manual: number | undefined,
  probed: number | null
): number {
  if (provider === 'builtin' && manual !== undefined && manual >= CONTEXT_SIZE_MIN) return manual
  return probed !== null && probed >= CONTEXT_SIZE_MIN ? probed : DEFAULT_CONTEXT_SIZE
}
