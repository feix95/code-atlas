// 讲解请求的内核:发一次请求、流式/非流式两条收账路线、半截话保命。
// 复读机重答与日志记账在外层 explainWithMessages 里。
import type { AiStreamStats, AiUsage, AiExplainResult, ChatTarget } from '../shared/types.ts'
import type { ChatMessageContent } from '../shared/chatImage.ts'
import { detectRepetitionTail } from './repetition.ts'
import {
  AI_ANTI_REPEAT_PARAMS,
  AI_BODY_TIMEOUT_MS,
  CHAT_TEMPERATURE
} from '../shared/aiDefaults.ts'
import { postChatCompletions } from './http.ts'
import { sseEvents, StreamIdleError } from './sse.ts'
import { halfNote, splitThinking, timeoutText } from './explainText.ts'

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export async function explainWithMessagesCore(
  config: ChatTarget,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: ChatMessageContent }>,
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
        // 反重复采样(第一百四十三批):复读机防线的引擎侧闸门,只对内置引擎发 ——
        // 外接服务不认这些字段,不塞,行为一分不变
        ...(config.timings ? AI_ANTI_REPEAT_PARAMS : {}),
        max_tokens: maxTokens,
        stream: Boolean(onDelta),
        // 思考开关(第一百一十五批):只对内置引擎发 —— 它认 chat_template_kwargs,
        // 能让思考型模型(Qwen3.5 这类)跳过 思考 直接答题;外接服务不认识这个
        // 字段,有的还会报错,所以外接的一律不塞,思考与否由它们自己的设置管
        ...(!opts?.allowThinking && config.timings
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
        // 内置引擎(llama-server)才塞的旗子(第八十四批):流里报 token 账,预处理进度看得见。
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
      // 正文里掺的思考标签也拆干净(有的服务不给你分字段)
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
      // 非流式没有逐帧监工的机会,交卷前整篇查一次尾巴(第一百四十三批):犯没犯都由上层定夺
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
    // 复读机监工(第一百四十三批):尾巴连着 4 遍同一短语就当场掐流,标记交上层重答
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
    // 正文里掺的思考标签在这里拆:思考挪走,正文才干净
    const streamSplit = splitThinking(full)
    if (streamSplit.reasoning)
      reasoningFull = reasoningFull
        ? `${reasoningFull}\n${streamSplit.reasoning}`
        : streamSplit.reasoning
    full = streamSplit.answer
    if (!full.trim()) {
      if (reasoningFull) {
        // 只想了没写出来:思考照实交(界面会折叠展示),别把失败归咎给上下文不足
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
    // 第八十五批:到手的半截永远先保住 —— 掐断、卡住、断线,一律不扔字,注脚按现场给
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
