// 「读取模型」:向 OpenAI 兼容服务的 GET /models 要模型清单(LM Studio 与在线 API 共用)。
// 在线 API 带 Bearer Key,HTTP 报错走 friendlyHttpError 的在线 API 话术 —— 这一步兼任 Key 测试。
import type { AiProviderKind } from '../shared/types.ts'
import { PROBE_CLOUD_MODELS_MS, PROBE_MODELS_MS } from '../shared/aiDefaults.ts'
import { friendlyHttpError } from './http.ts'

export interface ListModelsRequest {
  baseUrl: string
  apiKey: string
  provider: AiProviderKind
}

/** 网络层可注入(自测用 mock,不访问真实网络) */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** /models 回复 → 模型 id 清单(纯函数;认不出回空数组),保持服务返回的顺序 */
export function parseModelIds(raw: unknown): string[] {
  const list =
    raw !== null && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)
      ? (raw as { data: unknown[] }).data
      : []
  return list
    .map((m) => (m !== null && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id !== '')
}

function unreachableText(req: ListModelsRequest): string {
  return req.provider === 'cloud'
    ? `连不上服务商(${req.baseUrl}):检查网络、代理和服务地址`
    : `连不上模型服务,检查 LM Studio 是否已启动(${req.baseUrl})`
}

export async function listRemoteModels(
  req: ListModelsRequest,
  fetchImpl: FetchLike = fetch
): Promise<string[]> {
  const isCloud = req.provider === 'cloud'
  if (isCloud && req.apiKey.trim() === '') throw new Error('先填写 API Key 再读取模型')
  const url = `${req.baseUrl.trim().replace(/\/+$/, '')}/models`
  const key = req.apiKey.trim()
  const res = await fetchImpl(url, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(isCloud ? PROBE_CLOUD_MODELS_MS : PROBE_MODELS_MS)
  }).catch(() => null)
  if (!res) throw new Error(unreachableText(req))
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      friendlyHttpError(res.status, detail, req.provider) ??
        (isCloud ? `服务商返回错误(${res.status})` : unreachableText(req))
    )
  }
  return parseModelIds(await res.json().catch(() => null))
}
