// 自由对话的会话记忆胶水(主进程):按模型档位规划历史、记下翻文件往来。
// 纯逻辑在 ai/chatThread.ts 与 ai/chatSessions.ts(自测覆盖),这里只管接线和单例。
import { createChatSessionStore, sanitizeConversationId } from '../ai/chatSessions.ts'
import {
  planChatHistory,
  smallTierHistoryBudget,
  toTurnRecord,
  type PlannedHistory
} from '../ai/chatThread.ts'
import type { AgentChatMessage } from '../ai/agent.ts'
import { tierOfProvider, type ModelTier } from '../shared/aiTier.ts'
import type { AiProviderKind } from '../shared/types.ts'

const chatSessions = createChatSessionStore()

export interface ChatMemoryPlan {
  tier: ModelTier
  conversationId: string
  planned: PlannedHistory
}

/** 规划本轮历史:小模型档按预算装会话线程(翻文件模式才带完整工具往来),大模型档走旧行为 */
export function planChatMemory(input: {
  body: Record<string, unknown>
  provider: AiProviderKind
  contextTokens: number
  fixedTokens: number
  replyTokens: number
}): ChatMemoryPlan {
  const tier = tierOfProvider(input.provider)
  const conversationId = sanitizeConversationId(input.body.conversationId)
  const planned = planChatHistory({
    tier,
    history: input.body.history,
    records: input.body.agent === true ? chatSessions.turns(conversationId) : [],
    budgetTokens: smallTierHistoryBudget({
      contextTokens: input.contextTokens,
      fixedTokens: input.fixedTokens,
      replyTokens: input.replyTokens
    })
  })
  return { tier, conversationId, planned }
}

/** 翻文件一轮顺利交卷后记档:没会话编号、没提问、没翻过东西、大模型档都不记 */
export function rememberAgentTurn(
  plan: ChatMemoryPlan,
  question: string,
  trace: readonly AgentChatMessage[],
  answer: string
): void {
  if (plan.tier !== 'small' || plan.conversationId === '' || question === '' || trace.length === 0)
    return
  chatSessions.record(plan.conversationId, toTurnRecord(question, trace, answer))
}

/** 历史装不下被丢了整轮时给用户的一句实话;没丢就不打扰 */
export function droppedRoundsNotice(planned: PlannedHistory): string | null {
  if (planned.droppedRounds === 0) return null
  return `对话较长,模型的上下文只装得下最近 ${planned.keptRounds} 轮,更早的 ${planned.droppedRounds} 轮这次没带上 —— 想保住要点可以输入 /compact`
}
