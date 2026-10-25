// 翻文件循环的「这轮没成」兜底阶梯:复读机重说 → 引擎不认工具降级 → 提醒卡撤卡 →
// 上下文爆仓紧急瘦身 → 照实报错。每道兜底只用一次,掰不过来就交卷,不无限跟模型耗。
import type { AgentChatMessage, AgentRoundResult } from '../ai/agentTypes.ts'
import { AGENT_REMINDER_PREFIX, emergencySlim } from '../ai/agent.ts'
import { truncateAtRepetition } from '../ai/repetition.ts'
import { isContextOverflow } from '../ai/index.ts'
import { dropAgentToolsPersona, flattenAgentMessages, stripAgentReminders } from './agentPersona.ts'

/** 各道兜底的「用过了」账本(循环全程共用,免得同一招用两次) */
export interface AgentGuardFlags {
  repetitionRetried: boolean
  reminderFailsafe: boolean
  slimRetried: boolean
  skipNudgeOnce: boolean
}

export interface AgentFailureContext {
  round: Extract<AgentRoundResult, { status: 'error' | 'cancelled' | 'repetition' }>
  messages: AgentChatMessage[]
  /** 本轮垫进人设的守则切片(撤卡/降级时按它认) */
  addendum: string
  useTools: boolean
  engineNoTools: boolean
  flags: AgentGuardFlags
  doneCalls: Set<string>
  callIdToKey: Map<string, string>
}

/** 兜底的裁决:重来一轮,或者就此交卷 */
export type AgentFailureDecision =
  | { kind: 'retry'; step: string; engineNoTools: boolean; blacklistEngine?: boolean }
  | {
      kind: 'finish'
      status: 'supported' | 'error' | 'cancelled'
      text: string
      /** 交卷前要垫的一句步骤灰字 */
      step?: string
    }

/** 这轮没成:按阶梯决定重来还是交卷(会就地改 messages 与 flags) */
export function handleAgentFailure(ctx: AgentFailureContext): AgentFailureDecision {
  const { round, messages, addendum, useTools, flags, doneCalls, callIdToKey } = ctx
  let engineNoTools = ctx.engineNoTools
  // 复读机兜底:流式尾巴连着打转 —— agentRound 已发 reset 令收回
  // 已吐的字。掐了重说一轮(只兜一次);重说还打转就截到打转起点,拿剩下的交卷,
  // 绝不把一屏望不到头的循环递给用户
  if (round.status === 'repetition') {
    // 正文已经吐过:不许整段收回,直接截掉打转尾巴交卷 —— 已经说对的部分原样留着
    if (!round.bodyStarted && !flags.repetitionRetried) {
      flags.repetitionRetried = true
      flags.skipNudgeOnce = true // 重答这轮不算「轮数烧完」,别把逼卷令也捎上
      return {
        kind: 'retry',
        engineNoTools,
        step: '回答说到半截开始原地打转,掐掉重说一遍'
      }
    }
    const text = (truncateAtRepetition(round.text) ?? round.text).trim()
    if (text === '') {
      return {
        kind: 'finish',
        status: 'error',
        text: '模型连着两回都说到一半原地打转 —— 换个问法重新问问看'
      }
    }
    return {
      kind: 'finish',
      status: 'supported',
      text,
      step: '回答尾巴开始原地打转,把打转的部分掐了,已经说完的正文原样交给你'
    }
  }
  // 兜底:引擎不认工具调用(甩 400/404/422 还点名 tools)——
  // 记进会话黑名单,拆掉人设里垫的守则,这轮按普通对话重答;只兜一次,
  // 普通请求再出错照实报给用户
  if (round.status === 'error' && round.toolsUnsupported === true && useTools && !engineNoTools) {
    engineNoTools = true
    flags.skipNudgeOnce = true
    flattenAgentMessages(messages)
    dropAgentToolsPersona(messages, addendum)
    return {
      kind: 'retry',
      engineNoTools,
      blacklistEngine: true,
      step: '这个模型不支持自己翻文件(工具调用),这轮先按普通对话回答 —— 想用翻文件模式,得换个支持工具调用的模型'
    }
  }
  // 提醒卡兜底:个别外接引擎不认「tool 结果后面跟 user 消息」的形态,甩 4xx ——
  // 撤掉提醒卡退回无卡形态重答一轮(只兜一次);再错就照实报给用户,不跟它耗。
  // 上下文爆仓也常报 400,那是下一道瘦身兜底的活,别抢走它的一次机会
  const overflow =
    round.status === 'error' &&
    (isContextOverflow(round.text) || isContextOverflow(round.detail ?? ''))
  if (
    round.status === 'error' &&
    !flags.reminderFailsafe &&
    !overflow &&
    (round.httpStatus === 400 || round.httpStatus === 404 || round.httpStatus === 422) &&
    messages.some(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.startsWith(AGENT_REMINDER_PREFIX)
    )
  ) {
    flags.reminderFailsafe = true
    flags.skipNudgeOnce = true
    messages.splice(0, messages.length, ...stripAgentReminders(messages, AGENT_REMINDER_PREFIX))
    return {
      kind: 'retry',
      engineNoTools,
      step: '这个模型不太习惯多出来的小注记,撤掉重答'
    }
  }
  // 紧急瘦身兜底:轮间的注记压缩是保养,服务直接甩「上下文装不下」拒收时只有整段裁旧账能救 ——
  // 只保 system 和最新真问题(400 拒收时模型一个字没吐,重试不重影);只兜一次,再爆就照实报错
  if (round.status === 'error' && overflow && !flags.slimRetried) {
    flags.slimRetried = true
    const slimmed = emergencySlim(messages)
    if (slimmed) {
      messages.splice(0, messages.length, ...slimmed.messages)
      // 旧账清了,防打转的状态表跟着清:被裁掉结果的旧工具调用,模型要重温得允许重翻
      doneCalls.clear()
      callIdToKey.clear()
      flags.skipNudgeOnce = true
      return {
        kind: 'retry',
        engineNoTools,
        step: `对话把模型的脑容量撑爆了:把翻看前的旧账整段清掉(约 ${slimmed.dropped} 条),保住你最新的问题,重答一遍`
      }
    }
  }
  return {
    kind: 'finish',
    status: round.status === 'cancelled' ? 'cancelled' : 'error',
    text: round.text
  }
}
