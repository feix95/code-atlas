// 模型档位:按「来源」分流 —— 本地小模型(内置引擎 / LM Studio)与在线大模型(API)
// 各走各的对话记忆策略。目前整个 App 面对的都是小模型,大模型档先保持旧行为不动,
// 以后在线 API 要新增工具与功能时再往 large 档上扩。
import type { AiProviderKind } from './types.ts'

export type ModelTier = 'small' | 'large'

/** 来源 → 档位的唯一户口:新增 Provider 必须在这里表态,漏登记 typecheck 会红 */
export const PROVIDER_TIER: Record<AiProviderKind, ModelTier> = {
  lmstudio: 'small',
  builtin: 'small',
  cloud: 'large'
}

export function tierOfProvider(provider: AiProviderKind): ModelTier {
  return PROVIDER_TIER[provider]
}

/** 小模型档的对话记忆参数(会话线程见 ai/chatThread.ts) */
export const SMALL_TIER_MEMORY = {
  /** 历史最多占「锅里扣掉人设/附件/本轮问题/回答预留之后剩余座位」的几成:另一半留给本轮翻文件读进来的资料 */
  historyShare: 0.5,
  /** 历史预算的保底(tokens):锅再挤也留这么多,保证最近一轮问答带得上 */
  historyMinTokens: 1024,
  /** 旧工具结果被遮蔽成占位纸条时,保留原文开头的字数 */
  stubHeadChars: 80,
  /** 主进程内存里最多同时记住几个会话,多了按最久没用的先忘 */
  sessionsMax: 8,
  /** 单个会话最多记住最近几轮的完整工具往来 */
  turnsPerSessionMax: 20
} as const
