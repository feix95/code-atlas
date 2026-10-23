// OpenAI 兼容 SSE 流的读法:逐帧吐正文/思考/token 账/工具调用碎片,自带两档静默看门狗。
import type { AiStreamStats } from '../shared/types.ts'
import { AI_STREAM_FIRST_FRAME_MS, AI_STREAM_IDLE_MS } from '../shared/aiDefaults.ts'

interface ChatStreamChunk {
  choices?: Array<{
    delta?: { content?: string; reasoning_content?: string; tool_calls?: ToolCallDelta[] }
  }>
  /** llama-server timings_per_token(第八十四批):已读提示词/已吐 token/吐字速度 */
  timings?: { prompt_n?: number; predicted_n?: number; predicted_per_second?: number }
  /** OpenAI 习惯的收尾账(llama-server / LM Studio 都可能给) */
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** 流式一帧里的工具调用碎片(第一百三十四批):参数按 index 分组、arguments 逐段拼 */
export interface ToolCallDelta {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/** 从一帧流里抠出 token 账(纯函数,自测覆盖);啥都没有回 null,绝不编数 */
export function extractStreamStats(
  chunk: ChatStreamChunk,
  phase: 'reading' | 'writing'
): AiStreamStats | null {
  const t = typeof chunk.timings === 'object' && chunk.timings !== null ? chunk.timings : null
  const u = typeof chunk.usage === 'object' && chunk.usage !== null ? chunk.usage : null
  const promptTokens =
    typeof t?.prompt_n === 'number' && Number.isFinite(t.prompt_n) ? t.prompt_n : undefined
  const tps =
    typeof t?.predicted_per_second === 'number' && Number.isFinite(t.predicted_per_second)
      ? t.predicted_per_second
      : undefined
  const outputFromTimings =
    typeof t?.predicted_n === 'number' && Number.isFinite(t.predicted_n) ? t.predicted_n : undefined
  const outputFromUsage =
    typeof u?.completion_tokens === 'number' && Number.isFinite(u.completion_tokens)
      ? u.completion_tokens
      : undefined
  const promptFromUsage =
    typeof u?.prompt_tokens === 'number' && Number.isFinite(u.prompt_tokens)
      ? u.prompt_tokens
      : undefined
  const stats: AiStreamStats = {
    phase,
    promptTokens: promptTokens ?? promptFromUsage,
    outputTokens: outputFromTimings ?? outputFromUsage,
    tokensPerSecond: tps
  }
  const hasAnything =
    stats.promptTokens !== undefined ||
    stats.outputTokens !== undefined ||
    stats.tokensPerSecond !== undefined
  return hasAnything ? stats : null
}

/** SSE 流里的一次事件:一段正文和/或一段思考和/或一份 token 账和/或工具调用碎片 */
export interface SseEvent {
  text?: string
  reasoning?: string
  stats?: AiStreamStats
  toolCalls?: ToolCallDelta[]
}

/** 读流时「没动静」超时:reader 的 abort 掐不进读队列(实测),自己赛跑自己掐 */
export class StreamIdleError extends Error {
  /** true = 已经在吐字后卡的;false = 连第一个字都没等到 */
  readonly writing: boolean
  constructor(writing: boolean) {
    super(writing ? 'stream stalled mid-answer' : 'no first frame in time')
    this.writing = writing
  }
}

/**
 * 解析 OpenAI 流式(SSE)响应体,逐帧吐出「新增文本 + token 账」。
 * 格式:每行 `data: {json}`,`data: [DONE]` 收尾;残帧(半个 JSON)留到下一轮。
 * timings/usage 帧照常转发(llama-server 吐字帧里捎 timings,收尾捎 usage)。
 * 工具调用碎片照原样转发(agent 的流式循环自己按 index 拼,第一百三十四批)。
 */
export async function* sseEvents(res: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  let writing = false
  // 用户取消的铃:abort 掐不掐得进读队列看引擎心情,铃是保底(第八十五批)
  const abortBell = new Promise<'abort'>((resolve) => {
    if (!signal) return
    if (signal.aborted) resolve('abort')
    else signal.addEventListener('abort', () => resolve('abort'), { once: true })
  })
  while (true) {
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const idleBell = new Promise<'idle'>((resolve) => {
      // 首帧前的静默是大提示词的预处理,给足两分钟;吐字中途 30 秒没动静才算真卡住
      idleTimer = setTimeout(
        () => resolve('idle'),
        writing ? AI_STREAM_IDLE_MS : AI_STREAM_FIRST_FRAME_MS
      )
    })
    const raced = await Promise.race([reader.read(), idleBell, abortBell])
    clearTimeout(idleTimer)
    if (raced === 'idle') {
      void reader.cancel().catch(() => {})
      throw new StreamIdleError(writing)
    }
    if (raced === 'abort') {
      void reader.cancel().catch(() => {})
      const e = new Error('aborted by user')
      e.name = 'AbortError'
      throw e
    }
    const { done, value } = raced
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // 最后一段可能是残行,留给下一块
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        const chunk = JSON.parse(payload) as ChatStreamChunk
        const delta = chunk.choices?.[0]?.delta
        const piece = delta?.content
        const think = delta?.reasoning_content
        const calls = delta?.tool_calls
        if (piece || calls) writing = true
        const stats = extractStreamStats(chunk, writing ? 'writing' : 'reading')
        if (piece || think || calls || stats) {
          const ev: SseEvent = {}
          if (piece) ev.text = piece
          if (think) ev.reasoning = think
          if (calls) ev.toolCalls = calls
          if (stats) ev.stats = stats
          yield ev
        }
      } catch {
        // 残帧或心跳,跳过
      }
    }
  }
}
