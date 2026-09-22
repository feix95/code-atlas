// ── 模型/服务 HTTP 底座(P1-6/P1-8/P2-18) ──
// 以前同款样板在 ai/index.ts 和 ai/agent.ts 各抄一遍:AbortController 接力、
// 响应头看门狗、chat/completions POST 组装、headers、HTTP 错误翻译;
// 探测服务的 fetch+AbortSignal.timeout 更是在 main/ai/builtin/modelShelf 散写近十处。
// 现在壳子全在这:要换超时策略、加请求字段、改探测口径,只动这一处。

import type { ChatTarget } from '../shared/types.ts'
import { AI_HEADERS_TIMEOUT_MS } from '../shared/aiDefaults.ts'

/** 识别「上下文装不下」类的服务报错(各后端措辞不一,取特征词并集) */
export function isContextOverflow(text: string): boolean {
  return /exceeds the available context|context size|context length|too many tokens|n_ctx/i.test(text)
}

/** 「服务地址 → 服务根」:设置里存的是 .../v1 这种 API 基址,探测口(/api/v0/*、/props、/health)
 *  都挂在根上。以前这个归一化表达式散写两处,探测口径容易分叉 */
export function stripApiSuffix(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
}

/** 探测类 fetch 小件(P2-18):fetch + AbortSignal.timeout 一把抓,超时档位全走 PROBE_*_MS 常量 */
export function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

/** HTTP 错误的人话翻译(纯函数,自测覆盖):上下文塞满单独说;翻不动回 null(调用方透传原文)。
 * 上下文的指路话术按引擎分家:内置指回设置里的「模型上下文」,
 * 外接 LM Studio 的上下文设置不归 App 管,指去 LM Studio 调大再重载模型 */
export function friendlyHttpError(status: number, detail: string, engine?: 'builtin' | 'lmstudio'): string | null {
  if (isContextOverflow(`${status} ${detail}`)) {
    return engine === 'lmstudio'
      ? '材料塞不下模型的脑容量了:清点一下参考材料(少带几个文件/文件夹),或去 LM Studio 把上下文调大,再重新加载模型'
      : '材料塞不下模型的脑容量了:清点一下参考材料(少带几个文件/文件夹),或去设置里调大「模型上下文」'
  }
  return null
}

/** chat/completions 一次的出账结果:成功 = res + 控制器 + 收狗令;
 *  HTTP 报错 = 状态码 + 原始细节 + 已翻译好的人话(text 拼完,调用方直接交卷) */
export type ChatPostOutcome =
  | { ok: true; res: Response; controller: AbortController; disarm: () => void }
  | { ok: false; httpStatus: number; detail: string; text: string }

/**
 * 发一轮 chat/completions(壳子一处管,身体调用方给):
 * - AbortController 接力:外部 signal 掐,里面的 controller 跟着掐(取消/换目标一脉)
 * - 响应头看门狗:headers 超时不来就掐;头到手后由调用方 disarm(流式交棒给 SSE 监工,
 *   非流式换正文档看门狗)
 * - body 是 OpenAI 兼容请求体的自由字段集(messages/tools/stream_options 各调用方各配)
 * fetch 网络层抛错原样抛回(调用方的 catch 区分超时/断线各说各话)。
 */
export async function postChatCompletions(
  config: ChatTarget,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal; headersTimeoutMs?: number }
): Promise<ChatPostOutcome> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const watchdog = setTimeout(() => controller.abort(), opts?.headersTimeoutMs ?? AI_HEADERS_TIMEOUT_MS)
  const disarm = (): void => clearTimeout(watchdog)
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!res.ok) {
      disarm()
      const detail = await res.text().catch(() => '')
      const friendly = friendlyHttpError(res.status, detail, config.engine)
      return {
        ok: false,
        httpStatus: res.status,
        detail,
        text: friendly ?? `模型服务返回错误(${res.status})${detail ? `:${detail.slice(0, 120)}` : ''}`
      }
    }
    return { ok: true, res, controller, disarm }
  } catch (err) {
    disarm()
    throw err
  }
}
