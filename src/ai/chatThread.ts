// 对话线程的纯逻辑(小模型档的对话记忆,自测覆盖):
// 渲染层只回传「问 + 最终答案」的文字;翻文件时模型读过什么、搜到什么只有主进程知道,
// 每轮结束记成 TurnRecord。下一轮请求按「问 + 答」对账,对上的轮拿回完整工具往来,
// 对不上的(重试/过户/压缩后)退回纯文字 —— 渲染层永远是「有哪些轮」的权威,会话只负责加料。
// 装不下时的次序(JetBrains《The Complexity Trap》的观察遮蔽):
// 话原样留,先把最旧的大段工具原文换成占位纸条,还不够再丢最旧的整轮,最后才动最近一轮。
import type { AiHistoryMessage } from '../shared/types.ts'
import { TAG } from '../shared/promptTags.ts'
import { estimateTokens } from '../shared/aiText.ts'
import { SMALL_TIER_MEMORY, type ModelTier } from '../shared/aiTier.ts'
import { AGENT_STUB_MIN_CHARS, stripToolResult, type AgentChatMessage } from './agent.ts'
import { sanitizeHistory } from './chat.ts'

/** 一轮已完成的问答 + 中间的工具往来(assistant 的 tool_calls 与 tool 结果,不含提问和最终答案) */
export interface TurnRecord {
  question: string
  answer: string
  trace: AgentChatMessage[]
}

/** 渲染层回传的一轮问答(纯文字) */
export interface RoundPair {
  question: string
  answer: string
}

/** 历史规划结果:messages 直接垫进对话;dropped/masked 用来给用户一句如实的播报 */
export interface PlannedHistory {
  messages: AgentChatMessage[]
  keptRounds: number
  droppedRounds: number
  maskedRounds: number
}

type RoundState = 'rich' | 'masked' | 'plain'

/** 渲染层回传的历史洗成「问答对」:只认形状,不截断、不限条数(预算归规划函数管) */
export function pairRounds(history: unknown): RoundPair[] {
  if (!Array.isArray(history)) return []
  const items: AiHistoryMessage[] = []
  for (const item of history) {
    if (typeof item !== 'object' || item === null) continue
    const { role, content } = item as { role?: unknown; content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    const text = content.trim()
    if (text) items.push({ role, content: text })
  }
  const pairs: RoundPair[] = []
  for (let i = 0; i < items.length - 1; i += 1) {
    if (items[i].role !== 'user' || items[i + 1].role !== 'assistant') continue
    pairs.push({ question: items[i].content, answer: items[i + 1].content })
    i += 1
  }
  return pairs
}

/** 把一轮的工具往来洗成可存档形状:assistant 只留 content 和 tool_calls(思考等杂项不存) */
export function toTurnRecord(
  question: string,
  trace: readonly AgentChatMessage[],
  answer: string
): TurnRecord {
  const clean: AgentChatMessage[] = []
  for (const m of trace) {
    if (m.role === 'tool')
      clean.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content })
    else if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls?.length)
      clean.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls })
  }
  return { question: question.trim(), answer: answer.trim(), trace: clean }
}

/** 估算一组消息占多少 token:沿用聊天预算的保守口径(CJK 一字一 token),工具调用参数也算 */
export function estimateThreadTokens(messages: readonly AgentChatMessage[]): number {
  let tokens = 0
  for (const m of messages) {
    tokens += estimateTokens(typeof m.content === 'string' ? m.content : '')
    if ('tool_calls' in m && m.tool_calls) {
      for (const call of m.tool_calls)
        tokens += estimateTokens(call.function.name + call.function.arguments) + 4
    }
  }
  return tokens
}

/** 历史里的工具调用 id 加轮次前缀:跨轮的 call_0 不撞车,本轮的防打转账本不会被旧 id 误解锁 */
function withTurnPrefix(trace: readonly AgentChatMessage[], turnIndex: number): AgentChatMessage[] {
  const tag = (id: string): string => `h${turnIndex}_${id}`
  return trace.map((m) => {
    if (m.role === 'tool') return { ...m, tool_call_id: tag(m.tool_call_id) }
    if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls)
      return { ...m, tool_calls: m.tool_calls.map((c) => ({ ...c, id: tag(c.id) })) }
    return m
  })
}

/** 旧工具结果换成占位纸条:点明翻的是什么、原文多长、允许重读;短结果不值得动 */
function maskTrace(trace: readonly AgentChatMessage[]): AgentChatMessage[] {
  const labels = new Map<string, string>()
  for (const m of trace) {
    if (m.role !== 'assistant' || !('tool_calls' in m) || !m.tool_calls) continue
    for (const call of m.tool_calls)
      labels.set(call.id, `${call.function.name} ${call.function.arguments.slice(0, 80)}`)
  }
  return trace.map((m) => {
    if (m.role !== 'tool' || m.content.length <= AGENT_STUB_MIN_CHARS) return m
    const inner = stripToolResult(m.content)
    const head = inner.slice(0, SMALL_TIER_MEMORY.stubHeadChars).replaceAll('\n', ' ')
    const label = labels.get(m.tool_call_id) ?? '早先的工具调用'
    return {
      ...m,
      content: `${TAG.toolResult.open}\n「${label}」${head}……${TAG.programNote.open}这条是早先翻看的资料,对话锅快满了,已清理成占位纸条;原文约 ${inner.length} 字。要重温就再调一次工具重读,允许重读${TAG.programNote.close}\n${TAG.toolResult.close}`
    }
  })
}

function renderRound(
  pair: RoundPair,
  record: TurnRecord | undefined,
  state: RoundState,
  turnIndex: number
): AgentChatMessage[] {
  const trace =
    state === 'plain' || !record
      ? []
      : state === 'masked'
        ? maskTrace(withTurnPrefix(record.trace, turnIndex))
        : withTurnPrefix(record.trace, turnIndex)
  return [
    { role: 'user', content: pair.question },
    ...trace,
    { role: 'assistant', content: pair.answer }
  ]
}

/**
 * 小模型档的历史规划(纯函数,自测覆盖):问答对按「问+答」对上会话记录的轮拿回完整工具往来,
 * 装不下按「遮蔽旧工具原文 → 丢最旧整轮 → 最近一轮退成纯文字」的次序收缩;
 * 同样的输入永远得到同样的输出 —— 开头不乱动,引擎的前缀缓存才命得中。
 */
export function planSmallTierHistory(input: {
  history: unknown
  records: readonly TurnRecord[]
  budgetTokens: number
}): PlannedHistory {
  const pairs = pairRounds(input.history)
  const usedRecords = new Set<number>()
  const matched = pairs.map((pair) => {
    const at = input.records.findIndex(
      (r, i) => !usedRecords.has(i) && r.question === pair.question && r.answer === pair.answer
    )
    if (at >= 0) usedRecords.add(at)
    return at >= 0 ? input.records[at] : undefined
  })
  const states: RoundState[] = matched.map((r) => (r && r.trace.length > 0 ? 'rich' : 'plain'))
  const render = (i: number): AgentChatMessage[] => renderRound(pairs[i], matched[i], states[i], i)
  const costs = pairs.map((_, i) => estimateThreadTokens(render(i)))
  let total = costs.reduce((sum, cost) => sum + cost, 0)
  const shrink = (i: number, next: RoundState): void => {
    states[i] = next
    const cost = estimateThreadTokens(render(i))
    total += cost - costs[i]
    costs[i] = cost
  }
  for (let i = 0; i < pairs.length && total > input.budgetTokens; i += 1)
    if (states[i] === 'rich') shrink(i, 'masked')
  let first = 0
  while (total > input.budgetTokens && first < pairs.length - 1) {
    total -= costs[first]
    first += 1
  }
  const last = pairs.length - 1
  if (total > input.budgetTokens && last >= 0 && states[last] !== 'plain') shrink(last, 'plain')
  const kept = pairs.map((_, i) => i).slice(first)
  return {
    messages: kept.flatMap(render),
    keptRounds: kept.length,
    droppedRounds: first,
    maskedRounds: kept.filter((i) => states[i] === 'masked').length
  }
}

/**
 * 按档位规划历史(纯函数,自测覆盖):小模型档走会话线程;大模型档保持旧行为
 * (最近几条纯文字、单条截断),一个字不动。
 */
export function planChatHistory(input: {
  tier: ModelTier
  history: unknown
  records: readonly TurnRecord[]
  budgetTokens: number
}): PlannedHistory {
  if (input.tier === 'large') {
    const messages = sanitizeHistory(input.history)
    return { messages, keptRounds: messages.length / 2, droppedRounds: 0, maskedRounds: 0 }
  }
  return planSmallTierHistory(input)
}

/** 小模型档历史预算(纯函数,自测覆盖):锅里扣掉固定开销和回答预留后剩余座位的几成,不低于保底 */
export function smallTierHistoryBudget(input: {
  contextTokens: number
  fixedTokens: number
  replyTokens: number
}): number {
  const free = input.contextTokens - input.fixedTokens - input.replyTokens
  return Math.max(
    SMALL_TIER_MEMORY.historyMinTokens,
    Math.floor(free * SMALL_TIER_MEMORY.historyShare)
  )
}

/** 只留「问 + 最终答案」的纯文字历史(纯函数,自测覆盖):不翻文件的普通请求用,工具往来一律摘掉 */
export function toPlainHistory(messages: readonly AgentChatMessage[]): AiHistoryMessage[] {
  const plain: AiHistoryMessage[] = []
  for (const m of flattenToolMessages(messages)) {
    if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      plain.push({ role: m.role, content: m.content })
  }
  return plain
}

/**
 * 摘掉所有工具往来(纯函数,自测覆盖):引擎不认工具调用时,历史里的 tool 消息和
 * 带 tool_calls 的 assistant 也会被拒收 —— 只留问和最终答案,按普通对话走。
 */
export function flattenToolMessages(messages: readonly AgentChatMessage[]): AgentChatMessage[] {
  const flat: AgentChatMessage[] = []
  for (const m of messages) {
    if (m.role === 'tool') continue
    if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls?.length) {
      const text = (m.content ?? '').trim()
      if (text) flat.push({ role: 'assistant', content: text })
      continue
    }
    flat.push(m)
  }
  return flat
}
