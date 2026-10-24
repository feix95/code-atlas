// 自由对话的流式增量归账:主进程每吐一口,这里把消息状态表往前推一步。
// 纯函数(旧表进、新表出),reset/seal/step/matches/正文各走各的路,自测可直接喂。
import type { AiDeltaPayload, ChatMessage } from '@shared/types'

/** 在「正在回答」的气泡前面插一条只给人看的灰字(步骤播报 / 命中清单卡) */
function insertBeforeBusy(prev: ChatMessage[], note: ChatMessage): ChatMessage[] {
  const last = prev[prev.length - 1]
  const at =
    last && last.role === 'assistant' && last.state === 'busy' ? prev.length - 1 : prev.length
  return [...prev.slice(0, at), note, ...prev.slice(at)]
}

/** 把已吐的正文收回(agent 流式的回滚令),思考块照旧留着 */
function resetBusyText(prev: ChatMessage[]): ChatMessage[] {
  return prev.map((m) => (m.role === 'assistant' && m.state === 'busy' ? { ...m, text: '' } : m))
}

/**
 * agent 流式的封板令:本轮说出口的话是正经输出(「我去翻翻 xx」),不能抹掉 ——
 * 当前气泡封口完工保留,另起一个新气泡接下一轮的话和思考。
 * 新气泡沿用原 key(botKey),最终答案收尾才找得到它;封口气泡换新 key,别撞车。
 */
function sealBusy(prev: ChatMessage[]): ChatMessage[] {
  let at = -1
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    if (prev[i].role === 'assistant' && prev[i].state === 'busy') {
      at = i
      break
    }
  }
  const busyMsg = at >= 0 ? prev[at] : undefined
  // 没吐正经字就没什么可封的(光攒了思考块的话留在这条继续攒)
  if (!busyMsg || busyMsg.text.trim() === '') return prev
  const sealed: ChatMessage = { ...busyMsg, key: crypto.randomUUID(), state: 'done' }
  const fresh: ChatMessage = {
    key: busyMsg.key,
    role: 'assistant',
    text: '',
    state: 'busy',
    web: null
  }
  return [...prev.slice(0, at), sealed, fresh, ...prev.slice(at + 1)]
}

/** 一口增量落到状态表:上面那些专属指令优先,剩下的才是正文/思考/统计 */
export function applyChatDelta(prev: ChatMessage[], payload: AiDeltaPayload): ChatMessage[] {
  if (payload.reset) return resetBusyText(prev)
  if (payload.seal) return sealBusy(prev)
  // 翻文件模式的工具步骤播报:垫一条灰字,只给人看,不进对话历史
  if (payload.step) {
    return insertBeforeBusy(prev, {
      key: crypto.randomUUID(),
      role: 'note',
      text: payload.step.text,
      state: 'done',
      web: null,
      kind: 'step'
    })
  }
  // 命中清单卡:search_content 的结构化命中走旁路直递,程序自己画卡
  // —— 一条不丢、行号一个不错,可点跳预览。和步骤灰字一样只给人看,不进对话历史
  if (payload.matches) {
    return insertBeforeBusy(prev, {
      key: crypto.randomUUID(),
      role: 'note',
      text: '',
      state: 'done',
      web: null,
      kind: 'matches',
      matches: payload.matches
    })
  }
  return prev.map((m) =>
    m.role === 'assistant' && m.state === 'busy'
      ? {
          ...m,
          text: m.text + payload.text,
          reasoning: payload.reasoning ? (m.reasoning ?? '') + payload.reasoning : m.reasoning,
          stats: payload.stats ?? m.stats
        }
      : m
  )
}
