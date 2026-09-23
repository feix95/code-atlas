// 讲解请求底座:SSE 流式读取 / token 账 / 思考段剥离 / 看门狗超时 / 半截话注脚,
// 到 explainWithMessages(多轮)与 explainWithModel(单轮)两个入口。
import type { AiStreamStats, AiUsage, AiExplainResult, ChatTarget } from '../shared/types.ts'
import { detectRepetitionTail, truncateAtRepetition } from './repetition.ts'
import { addDevLog } from '../shared/devlog.ts'
import {
  AI_ANTI_REPEAT_PARAMS,
  AI_BODY_TIMEOUT_MS,
  AI_STREAM_FIRST_FRAME_MS,
  AI_STREAM_IDLE_MS,
  CHAT_TEMPERATURE
} from '../shared/aiDefaults.ts'
import { postChatCompletions } from './http.ts'
import { formatUsage } from '../shared/aiText.ts'
import { buildExplainSystem } from './prompts.ts'

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

interface ChatStreamChunk {
  choices?: Array<{
    delta?: { content?: string; reasoning_content?: string; tool_calls?: ToolCallDelta[] }
  }>
  /** llama-server timings_per_token(第八十四锤):已读提示词/已吐 token/吐字速度 */
  timings?: { prompt_n?: number; predicted_n?: number; predicted_per_second?: number }
  /** OpenAI 习惯的收尾账(llama-server / LM Studio 都可能给) */
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** 流式一帧里的工具调用碎片(第一百三十四锤):参数按 index 分组、arguments 逐段拼 */
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

/**
 * 解析 OpenAI 流式(SSE)响应体,逐帧吐出「新增文本 + token 账」。
 * 格式:每行 `data: {json}`,`data: [DONE]` 收尾;残帧(半个 JSON)留到下一轮。
 * timings/usage 帧照常转发(llama-server 吐字帧里捎 timings,收尾捎 usage)。
 * 工具调用碎片照原样转发(agent 的流式循环自己按 index 拼,第一百三十四锤)。
 */
export async function* sseEvents(res: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  let writing = false
  // 用户取消的铃:abort 掐不掐得进读队列看引擎心情,铃是保底(第八十五锤)
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

// 看门狗四档的户口都在 shared/aiDefaults.ts(AI_HEADERS/AI_BODY/AI_STREAM_FIRST_FRAME/AI_STREAM_IDLE):
// 首帧前的耐心对齐响应头 = 两分钟(第八十五锤:30 秒静默掐读是小葵冤案的帮凶)

/**
 * 把回复里的思考区拆出来(纯函数,自测覆盖,第一百一十五锤)。
 * 有的服务把思考装进单独的 reasoning_content 字段(llama-server 就这样);有的直接把
 * <think>…</think> 掺在正文里(LM Studio 的部分后端)。后者在这里拆干净:
 * 有收尾标签 → 标签里是思考、后面是正文;没写收尾(半截话/字数烧尽)→ 全算思考。
 * 普通回复一根标签都没有,原样通过。
 */
export function splitThinking(text: string): { reasoning: string; answer: string } {
  const open = text.indexOf('<think>')
  if (open === -1) return { reasoning: '', answer: text }
  const close = text.indexOf('</think>', open)
  if (close === -1) return { reasoning: text.slice(open + 7).trim(), answer: '' }
  const reasoning = text.slice(open + 7, close).trim()
  const before = text.slice(0, open).trim()
  const after = text.slice(close + 8).trim()
  return { reasoning, answer: `${before}${before && after ? '\n\n' : ''}${after}` }
}

/** 读流时「没动静」超时:reader 的 abort 掐不进读队列(实测),自己赛跑自己掐 */
class StreamIdleError extends Error {
  /** true = 已经在吐字后卡的;false = 连第一个字都没等到 */
  readonly writing: boolean
  constructor(writing: boolean) {
    super(writing ? 'stream stalled mid-answer' : 'no first frame in time')
    this.writing = writing
  }
}

/** 到手的半截话配的注脚(纯函数,自测覆盖):断线/掐断/卡住各有各的说法 */
export function halfNote(kind: 'stall' | 'disconnect' | 'watchdog'): string {
  if (kind === 'disconnect') return '(连接断了,上面是已经生成的部分;再点一次可以重讲)'
  if (kind === 'watchdog') return '(等太久被掐断了,上面是已经生成的部分)'
  return '(回答到这儿断了:模型可能卡住了,再点一次可以重讲)'
}

/** 等不到任何输出的超时话术(纯函数,自测覆盖) */
export function timeoutText(): string {
  return '等了很久没等到第一个字:材料大预处理就慢,引擎也可能卡住了 —— 不想等就「取消」,清点一下参考材料再问'
}

/**
 * 调 OpenAI 兼容接口(ChatTarget),拿到人话解释。
 * 传 onDelta = 流式:边生成边推送增量(内置大模型生成慢,流式不用干瞪眼);
 * 不传 = 老行为,等全量。两条路 LM Studio 和内置模型都支持。
 * 超时是分段看门狗:等响应头/整段回复给足耐心;流式只要还有增量就一直续命,
 * 一旦没动静立刻掐断 —— 绝不无限挂死,也不把慢模型的正常输出拦腰砍断。
 * signal = 外部取消(用户换了讲解目标):立刻掐,不让过气的生成占着模型排队。
 * 能力边界:服务不通、超时、返回空,都给 status='error' 的人话,不抛异常。
 * 第八十七锤:所有模型请求都过这一道 —— 起止都在后台日志里报账(只记元数据:
 * 消息条数、提示词字数、token 账、耗时,问题内容一个字不落账)。
 */
export async function explainWithMessages(
  config: ChatTarget,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onDelta?: (text: string, stats?: AiStreamStats, reasoning?: string) => void,
  signal?: AbortSignal,
  maxTokens = 500,
  opts?: {
    allowThinking?: boolean
    /** 复读机重答前的收尾令(第一百四十三锤):聊天场景发 reset 把已吐的字收回;不传就静默重答 */ onRestart?: () => void
  }
): Promise<AiExplainResult> {
  const startedAt = Date.now()
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0)
  addDevLog(
    'request',
    `提问 → ${config.baseUrl} · 模型 ${config.model} · ${messages.length} 条消息 · 提示词约 ${promptChars} 字 · 上限 ${maxTokens} tokens${onDelta ? ' · 流式' : ''}${opts?.allowThinking ? ' · 思考模式' : ''}`
  )
  let result = await explainWithMessagesCore(config, messages, onDelta, signal, maxTokens, opts)
  // 复读机保险丝(第一百四十三锤):模型嘴皮子抽筋了 —— 发收尾令收回已吐的字,重答一遍;
  // 重答还犯就截到打转起点,附注脚交卷,绝不把一屏望不到头的循环原样递给用户
  if (result.repetitionDetected) {
    addDevLog('request', '复读机警报:回答在原地打转,掐掉重说一遍')
    opts?.onRestart?.()
    const retry = await explainWithMessagesCore(config, messages, onDelta, signal, maxTokens, opts)
    if (!retry.repetitionDetected) {
      result = retry
    } else {
      addDevLog('request', '复读机警报:重说一回还在打转,截断交卷')
      const body = (truncateAtRepetition(retry.text) ?? retry.text).trim()
      result = {
        ...retry,
        text:
          body === ''
            ? '模型连着两回都说到一半原地打转 —— 换个问法重新问问看'
            : `${body}\n\n(说到这儿开始原地打转,重说了一回也没绕出来,先把说完的交给你;建议换个问法重新问)`,
        repetitionDetected: undefined
      }
    }
  }
  const took = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (result.status === 'supported') {
    const account = result.usage ? ` · ${formatUsage(result.usage)}` : ''
    addDevLog('request', `回答完成 · 输出约 ${result.text.length} 字${account} · 耗时 ${took} 秒`)
  } else {
    addDevLog(
      'request',
      `这轮没成(${result.status}) · ${result.text.slice(0, 80)} · 耗时 ${took} 秒`
    )
  }
  return result
}

async function explainWithMessagesCore(
  config: ChatTarget,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onDelta?: (text: string, stats?: AiStreamStats, reasoning?: string) => void,
  signal?: AbortSignal,
  maxTokens = 500,
  opts?: { allowThinking?: boolean }
): Promise<AiExplainResult> {
  const startedAt = Date.now()
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let full = ''
  let reasoningFull = ''
  let usage: AiUsage | undefined
  try {
    // 控制器接力 + 响应头看门狗 + POST 壳子都归 postChatCompletions(请求底座一处管);
    // 这里只配这一路的请求体
    const post = await postChatCompletions(
      config,
      {
        model: config.model,
        messages,
        temperature: CHAT_TEMPERATURE,
        // 反重复采样(第一百四十三锤):复读机防线的引擎侧闸门,只对内置引擎发 ——
        // 外接服务不认这些字段,不塞,行为一分不变
        ...(config.timings ? AI_ANTI_REPEAT_PARAMS : {}),
        max_tokens: maxTokens,
        stream: Boolean(onDelta),
        // 思考开关(第一百一十五锤):只对内置引擎发 —— 它认 chat_template_kwargs,
        // 能让思考型模型(Qwen3.5 这类)跳过 <think> 直接答题;外接服务不认识这个
        // 字段,有的还会报错,所以外接的一律不塞,思考与否由它们自己的设置管
        ...(!opts?.allowThinking && config.timings
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
        // 内置引擎(llama-server)才塞的旗子(第八十四锤):流里报 token 账,预处理进度看得见。
        // 外接服务不认识这些字段,不塞,行为一分不变
        ...(config.timings
          ? { timings_per_token: true, stream_options: { include_usage: true } }
          : {})
      },
      { signal }
    )
    if (!post.ok) {
      return {
        status: 'error',
        text: post.text,
        model: config.model,
        durationMs: Date.now() - startedAt
      }
    }
    const { res, controller, disarm } = post
    disarm() // 响应头到手:头段的看门狗下岗,后段各换各的监工

    if (!onDelta) {
      watchdog = setTimeout(() => controller.abort(), AI_BODY_TIMEOUT_MS)
      const data = (await res.json()) as ChatCompletionResponse
      const message = data.choices?.[0]?.message
      // 思考区先收好(llama-server 装在 reasoning_content 字段里)
      reasoningFull = message?.reasoning_content?.trim() ?? ''
      // 正文里掺的 <think> 标签也拆干净(有的服务不给你分字段)
      const split = splitThinking(message?.content?.trim() ?? '')
      if (split.reasoning)
        reasoningFull = reasoningFull ? `${reasoningFull}\n${split.reasoning}` : split.reasoning
      const content = split.answer.trim()
      usage =
        typeof data.usage === 'object' && data.usage !== null
          ? {
              promptTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens
            }
          : undefined
      if (!content) {
        if (reasoningFull) {
          // 想了一堆没写出答案(思考把字数烧完/外接服务关不掉思考):思考本身就是回复,照实交出去,
          // 总比报「一个字都没回」强 —— 那句提示在这场景是冤枉上下文
          return {
            status: 'supported',
            text: reasoningFull,
            reasoning: reasoningFull,
            model: config.model,
            durationMs: Date.now() - startedAt,
            usage
          }
        }
        return {
          status: 'error',
          text: '模型连上了,但一个字都没回 —— 上下文可能塞得太满:清点一下参考材料再问',
          model: config.model,
          durationMs: Date.now() - startedAt,
          usage
        }
      }
      // 非流式没有逐帧监工的机会,交卷前整篇查一次尾巴(第一百四十三锤):犯没犯都由上层定夺
      return {
        status: 'supported',
        text: content,
        reasoning: reasoningFull || undefined,
        model: config.model,
        durationMs: Date.now() - startedAt,
        usage,
        repetitionDetected: detectRepetitionTail(split.answer) !== null
      }
    }

    // 流式:逐帧喂给 onDelta(正文 + 思考 + token 账),全文攒到最后一起返回。
    // 「没动静」的看守交棒给 sseEvents 自己(首帧/帧间两档);用户取消也由它插铃保底
    let lastStats: AiStreamStats | undefined
    // 复读机监工(第一百四十三锤):尾巴连着 4 遍同一短语就当场掐流,标记交上层重答
    let looped = false
    for await (const ev of sseEvents(res, signal ?? controller.signal)) {
      if (ev.text) {
        full += ev.text
        if (!looped && detectRepetitionTail(full)) {
          looped = true
          // abort 是把连接收干净(流没读完),犯没犯病由 looped 标记说话,不走报错
          controller.abort()
          break
        }
      }
      if (ev.reasoning) {
        reasoningFull += ev.reasoning
      }
      // 收尾帧(usage)只带 token 数不带速度:按字段合并,别把上一帧的吐字速度冲掉
      if (ev.stats) {
        lastStats = lastStats
          ? {
              phase: ev.stats.phase,
              promptTokens: ev.stats.promptTokens ?? lastStats.promptTokens,
              outputTokens: ev.stats.outputTokens ?? lastStats.outputTokens,
              tokensPerSecond: ev.stats.tokensPerSecond ?? lastStats.tokensPerSecond
            }
          : ev.stats
      }
      onDelta(ev.text ?? '', lastStats, ev.reasoning)
    }
    usage = lastStats
      ? {
          promptTokens: lastStats.promptTokens,
          outputTokens: lastStats.outputTokens,
          tokensPerSecond: lastStats.tokensPerSecond
        }
      : undefined
    // 正文里掺的 <think> 标签在这里拆:思考挪走,正文才干净
    const streamSplit = splitThinking(full)
    if (streamSplit.reasoning)
      reasoningFull = reasoningFull
        ? `${reasoningFull}\n${streamSplit.reasoning}`
        : streamSplit.reasoning
    full = streamSplit.answer
    if (!full.trim()) {
      if (reasoningFull) {
        // 只想了没写出来:思考照实交(界面会折叠展示),别把锅甩给上下文
        return {
          status: 'supported',
          text: reasoningFull,
          reasoning: reasoningFull,
          model: config.model,
          durationMs: Date.now() - startedAt,
          usage
        }
      }
      return {
        status: 'error',
        text: '模型连上了,但一个字都没回 —— 上下文可能塞得太满:清点一下参考材料再问',
        model: config.model,
        durationMs: Date.now() - startedAt,
        usage
      }
    }
    return {
      status: 'supported',
      text: full,
      reasoning: reasoningFull || undefined,
      model: config.model,
      durationMs: Date.now() - startedAt,
      usage,
      repetitionDetected: looped
    }
  } catch (err) {
    // 第八十五锤:到手的半截永远先保住 —— 掐断、卡住、断线,一律不扔字,注脚按现场给
    const isAbort = err instanceof Error && err.name === 'AbortError'
    const idle = err instanceof StreamIdleError ? err : null
    const userCancelled = signal?.aborted === true
    const half = full.trim()
    if (half) {
      // 用户自己停的:界面有「已停下」的专门话术,不重复注脚
      const note = userCancelled
        ? ''
        : idle && !idle.writing
          ? halfNote('watchdog')
          : idle
            ? halfNote('stall')
            : isAbort
              ? halfNote('watchdog')
              : halfNote('disconnect')
      return {
        status: 'supported',
        text: note ? `${full}\n\n${note}` : full,
        reasoning: reasoningFull || undefined,
        model: config.model,
        durationMs: Date.now() - startedAt,
        usage
      }
    }
    const msg = userCancelled
      ? '取消了 —— 这次没等到任何输出'
      : isAbort || idle
        ? timeoutText()
        : `连接断了,模型服务可能停了(${baseUrl})`
    return {
      status: 'error',
      text: msg,
      model: config.model,
      durationMs: Date.now() - startedAt,
      usage
    }
  } finally {
    clearTimeout(watchdog)
  }
}

/** 单轮讲解的老入口:人设 + 一条证据消息。追问等多轮场景直接用 explainWithMessages */
export async function explainWithModel(
  config: ChatTarget,
  prompt: string,
  // 默认人设 = 文件讲解底座 + 默认「精简」教学档(提示词体系重写第二批:原 SYSTEM_PROMPT 已拆进 prompts.ts)
  system: string = buildExplainSystem('brief', 'file'),
  onDelta?: (text: string, stats?: AiStreamStats) => void,
  signal?: AbortSignal,
  maxTokens = 500,
  opts?: { onRestart?: () => void }
): Promise<AiExplainResult> {
  return explainWithMessages(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    onDelta,
    signal,
    maxTokens,
    opts
  )
}
