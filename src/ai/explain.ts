// 讲解请求底座:SSE 流式读取 / token 账 / 思考段剥离 / 看门狗超时 / 半截话注脚,
// 到 explainWithMessages(多轮)与 explainWithModel(单轮)两个入口。
//
// 分层:SSE 读法住 sse.ts,文本收尾住 explainText.ts,单次请求内核住 explainCore.ts;
// 本文件管日志记账与复读机重答,并转手老登记(自测照旧从 explain 进)。
import type { AiStreamStats, AiExplainResult, ChatTarget } from '../shared/types.ts'
import type { ChatMessageContent } from '../shared/chatImage.ts'
import { contentTextLen } from '../shared/chatImage.ts'
import { truncateAtRepetition } from './repetition.ts'
import { addDevLog } from '../shared/devlog.ts'
import { formatUsage } from '../shared/aiText.ts'
import { explainWithMessagesCore } from './explainCore.ts'

export { extractStreamStats, sseEvents, StreamIdleError } from './sse.ts'
export type { ToolCallDelta, SseEvent } from './sse.ts'
export { splitThinking, halfNote, timeoutText } from './explainText.ts'

// 看门狗四档的登记都在 shared/aiDefaults.ts(AI_HEADERS/AI_BODY/AI_STREAM_FIRST_FRAME/AI_STREAM_IDLE):
// 首帧前的耐心对齐响应头 = 两分钟(第八十五批:30 秒静默掐读是小葵冤案的帮凶)

/**
 * 调 OpenAI 兼容接口(ChatTarget),拿到人话解释。
 * 传 onDelta = 流式:边生成边推送增量(内置大模型生成慢,流式不用干瞪眼);
 * 不传 = 老行为,等全量。两条路 LM Studio 和内置模型都支持。
 * 超时是分段看门狗:等响应头/整段回复给足耐心;流式只要还有增量就一直续命,
 * 一旦没动静立刻掐断 —— 绝不无限挂死,也不把慢模型的正常输出拦腰砍断。
 * signal = 外部取消(用户换了讲解目标):立刻掐,不让过气的生成占着模型排队。
 * 能力边界:服务不通、超时、返回空,都给 status='error' 的人话,不抛异常。
 * 第八十七批:所有模型请求都过这一道 —— 起止都在后台日志里记账(只记元数据:
 * 消息条数、提示词字数、token 账、耗时,问题内容一个字不落账)。
 */
export async function explainWithMessages(
  config: ChatTarget,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: ChatMessageContent }>,
  onDelta?: (text: string, stats?: AiStreamStats, reasoning?: string) => void,
  signal?: AbortSignal,
  maxTokens = 500,
  opts?: {
    allowThinking?: boolean
    /** 复读机重答前的收尾令(第一百四十三批):聊天场景发 reset 把已吐的字收回;不传就静默重答 */ onRestart?: () => void
  }
): Promise<AiExplainResult> {
  const startedAt = Date.now()
  // 日志只记字数:带图的消息 content 是分段数组,dataUrl 绝不落账 —— 折算成占位字
  const promptChars = messages.reduce((sum, m) => sum + contentTextLen(m.content), 0)
  addDevLog(
    'request',
    `提问 → ${config.baseUrl} · 模型 ${config.model} · ${messages.length} 条消息 · 提示词约 ${promptChars} 字 · 上限 ${maxTokens} tokens${onDelta ? ' · 流式' : ''}${opts?.allowThinking ? ' · 思考模式' : ''}`
  )
  let result = await explainWithMessagesCore(config, messages, onDelta, signal, maxTokens, opts)
  // 复读机保险丝(第一百四十三批):模型嘴皮子抽筋了 —— 发收尾令收回已吐的字,重答一遍;
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

/**
 * 单轮问答入口:人设 + 一条消息。多轮场景直接用 explainWithMessages。
 * 人设必传 —— 文件/文件夹讲解底座已随概览板块退役,这里不再兜一个没人认领的默认人设。
 */
export async function explainWithModel(
  config: ChatTarget,
  prompt: string,
  system: string,
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
