// ── 视觉能力探测(视觉能力锤):各家怎么报「能不能看图」一本账 ──
// llama-server:就绪后问 /props 的 modalities.vision(布尔)
// LM Studio:/api/v0/models 条目的 type === 'vlm' / 'llm'
// 在线 API:没有查询口,按模型名认(shared/visionModels.ts)
// 探测不到一律 unknown —— 不冒充 vision,也不冤枉 text-only。

import type { VisionSupport } from '../shared/types.ts'
import { PROBE_MODELS_MS } from '../shared/aiDefaults.ts'
import { fetchWithTimeout, stripApiSuffix } from './http.ts'

/**
 * llama-server /props 的回复(已解析的 JSON)→ 视觉能力(纯函数,自测覆盖)。
 * modalities.vision 是引擎自己报的账:true→能看图,false→纯文本;
 * 字段缺失/版本太老/坏 JSON → unknown。
 */
export function parseLlamaPropsVision(raw: unknown): VisionSupport {
  if (raw === null || typeof raw !== 'object') return 'unknown'
  const v = (raw as { modalities?: { vision?: unknown } }).modalities?.vision
  if (v === true) return 'vision'
  if (v === false) return 'text-only'
  return 'unknown'
}

/**
 * LM Studio /api/v0/models 的条目 → 视觉能力(纯函数,自测覆盖):
 * type 'vlm' → vision,'llm' → text-only;查无此模型/类型不认 → unknown。
 */
export function parseLmStudioModelVision(raw: unknown, model: string): VisionSupport {
  const list: unknown[] =
    raw !== null && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)
      ? (raw as { data: unknown[] }).data
      : Array.isArray(raw)
        ? raw
        : []
  const hit = list.find(
    (m): m is { id?: unknown; type?: unknown } =>
      m !== null && typeof m === 'object' && (m as { id?: unknown }).id === model
  )
  if (hit?.type === 'vlm') return 'vision'
  if (hit?.type === 'llm') return 'text-only'
  return 'unknown'
}

/**
 * 内置引擎就绪后问一轮 /props(引擎已在跑才问,绝不为探测拉起引擎)。
 * 问不到(老版本没这个口/超时)回 unknown,不拖累就绪播报本身。
 */
export async function probeBuiltinVision(baseUrl: string): Promise<VisionSupport> {
  try {
    const res = await fetchWithTimeout(`${stripApiSuffix(baseUrl)}/props`, PROBE_MODELS_MS)
    if (!res.ok) return 'unknown'
    return parseLlamaPropsVision(await res.json().catch(() => null))
  } catch {
    return 'unknown'
  }
}
