import { announceActivityBusy, lastActivityProvider } from './modelStatus.ts'
import { sendAgentDelta, sendAgentStep } from './agentTools.ts'
import { type IpcMainInvokeEvent } from 'electron'
import {
  AGENT_MAX_ROUNDS,
  AGENT_WEB_MAX_LOOKUPS,
  ROUND_CAP_NUDGE,
  WEB_BUDGET_NUDGE,
  agentPromptBudget,
  agentReadChars,
  agentRound,
  compressAgentMessages,
  extractToolCalls,
  mergeUsage,
  type AgentChatMessage
} from '../ai/agent.ts'
import { stripCurrentQuestionAnchor } from '../shared/chatHistory.ts'
import { addDevLog } from '../shared/devlog.ts'
import { applyAgentPersona, buildAgentAddendum, flattenAgentMessages } from './agentPersona.ts'
import { handleAgentFailure, type AgentGuardFlags } from './agentFallback.ts'
import { finalizeAgentWebLookup } from '../ai/webPrompts.ts'
import type { AiChatResult, AiUsage, ChatTarget, WebLookupMeta } from '../shared/types.ts'
import { fulfillAgentToolCalls, type AgentToolLedger } from './agentChatTools.ts'

/**
 * 翻文件模式里「不认工具调用」的引擎黑名单(只记会话内存,零落盘):
 * 键 = baseUrl|模型名。有的外接服务(甚至不带工具模板的模型文件)收到 tools 字段
 * 直接甩 400,循环还没起步就断 —— 摔过一跤的记下来,下次直接按普通对话回答,
 * 不再拿石头砸自己的脚。
 */
const noToolEngines = new Set<string>()

/**
 * 翻文件模式的工具循环:模型喊工具 → 主进程沙盒里执行 → 结果喂回 → 循环,
 * 直到模型交出不带工具调用的正文答案。护栏三项:轮数封顶(到顶后撤掉工具表
 * 逼它交卷)、同一样东西不许翻第二遍、每轮之间都听用户的取消。
 * 模型不会喊工具也没关系:第一轮就交正文,当普通回答返回 —— 不装 agent 空转。
 *
 * 分工:参数安检住 agentCallArgs,单次执行住 agentRunTool,人设装配住 agentPersona,
 * 「这轮没成」的兜底阶梯住 agentFallback,本轮工具往来住 agentChatTools;本文件只留循环与收尾。
 */
export async function runAgentChat(input: {
  event: IpcMainInvokeEvent
  requestId: string
  target: ChatTarget
  systemPrompt: string
  baseMessages: AgentChatMessage[]
  rootPath: string
  ctx: number
  replyCap: number
  allowThinking: boolean
  signal: AbortSignal
  startedAt: number
  webLookup: WebLookupMeta
  /** 联网查证开着 = 工具表里多 web_search / web_fetch / open_github_repo,人设后面多垫一段上网守则 */
  webSearchEnabled: boolean
  /** Tavily 的 Key(可选):填了 web_search 的源队列 Tavily 打头 */
  tavilyKey?: string
  /** 顺利交卷时回报本轮的工具往来(assistant 的 tool_calls + tool 结果,不含提问和提醒/质检插话)和最终答案:会话记忆靠它记档 */
  onTurnComplete?: (trace: AgentChatMessage[], answer: string) => void
}): Promise<AiChatResult> {
  const { event, requestId, target, baseMessages, rootPath, ctx, replyCap, allowThinking, signal } =
    input
  const messages: AgentChatMessage[] = [...baseMessages]
  const turnTrace: AgentChatMessage[] = []
  // 提醒卡引用干净的问题原文:最后一条 user,剥掉注意力锚;带图分段数组本不该走到这
  let currentQuestion = ''
  for (let i = baseMessages.length - 1; i >= 0; i--) {
    const m = baseMessages[i]
    if (m.role === 'user') {
      currentQuestion = stripCurrentQuestionAnchor(typeof m.content === 'string' ? m.content : '')
      break
    }
  }
  const engineKey = `${target.baseUrl}|${target.model}`
  let engineNoTools = noToolEngines.has(engineKey)
  if (engineNoTools) {
    sendAgentStep(event, requestId, '这个模型不会自己翻文件(不支持工具调用),按普通对话回答')
    flattenAgentMessages(messages)
  }
  const addendum = buildAgentAddendum(input.webSearchEnabled)
  applyAgentPersona(messages, { addendum, engineNoTools })
  const readChars = agentReadChars(ctx)
  const ledger: AgentToolLedger = {
    doneCalls: new Set<string>(),
    callIdToKey: new Map<string, string>(),
    webSearchCalls: 0,
    webFetchCalls: 0,
    webQueries: [],
    webSources: [],
    researchNotes: [],
    toolCallsExecuted: 0
  }
  const promptBudget = agentPromptBudget(ctx, replyCap)
  let webBudgetNotified = false
  const flags: AgentGuardFlags = {
    repetitionRetried: false,
    reminderFailsafe: false,
    slimRetried: false,
    skipNudgeOnce: false
  }
  let usage: AiUsage | undefined
  let reasoningAll: string | undefined
  let lastRoundReasoning: string | undefined
  let sealedAny = false
  const resultReasoning = (): string | undefined => (sealedAny ? lastRoundReasoning : reasoningAll)
  let rounds = 0
  addDevLog(
    'request',
    `翻文件模式开跑 · 最多 ${AGENT_MAX_ROUNDS} 轮 · 单次读文件约 ${readChars} 字 · 压缩警戒线约 ${promptBudget} tokens`
  )
  for (;;) {
    if (signal.aborted) {
      return agentResult(input, 'cancelled', '', usage, resultReasoning(), ledger)
    }
    const compressed = compressAgentMessages(messages, promptBudget)
    if (compressed) {
      for (const callId of compressed.freedCallIds) {
        const key = ledger.callIdToKey.get(callId)
        if (key) ledger.doneCalls.delete(key)
      }
      messages.splice(0, messages.length, ...compressed.messages)
      sendAgentStep(
        event,
        requestId,
        `对话快记满了,把较早翻看的 ${compressed.compressedCount} 样旧资料提炼成了占位注记 —— 要重温随时能再翻`
      )
      addDevLog(
        'request',
        `翻文件第 ${rounds + 1} 轮前压缩:${compressed.compressedCount} 条旧资料成了注记,腾出约 ${compressed.freedCallIds.length} 处重读权`
      )
    }
    const useTools = !engineNoTools && rounds < AGENT_MAX_ROUNDS
    const webLookups = ledger.webSearchCalls + ledger.webFetchCalls
    const webToolsEnabled = input.webSearchEnabled && webLookups < AGENT_WEB_MAX_LOOKUPS
    if (input.webSearchEnabled && !webToolsEnabled && !webBudgetNotified) {
      webBudgetNotified = true
      messages.push({ role: 'user', content: WEB_BUDGET_NUDGE })
      sendAgentStep(event, requestId, `联网研究已用满 ${AGENT_WEB_MAX_LOOKUPS} 次,转入手头资料收尾`)
    }
    if (rounds >= AGENT_MAX_ROUNDS && !flags.skipNudgeOnce) {
      messages.push({ role: 'user', content: ROUND_CAP_NUDGE })
    }
    flags.skipNudgeOnce = false
    rounds += 1
    const round = await agentRound(target, messages, {
      signal,
      maxTokens: replyCap,
      allowThinking,
      useTools,
      webToolsEnabled,
      githubToolsEnabled: input.webSearchEnabled,
      onDelta: (ev) => {
        if (ev.seal) sealedAny = true
        sendAgentDelta(event, requestId, ev)
      }
    })
    lastRoundReasoning = round.status === 'ok' ? round.reasoning : undefined
    if (round.status !== 'ok') {
      const decision = handleAgentFailure({
        round,
        messages,
        addendum,
        useTools,
        engineNoTools,
        flags,
        doneCalls: ledger.doneCalls,
        callIdToKey: ledger.callIdToKey
      })
      if (decision.kind === 'retry') {
        if (decision.blacklistEngine) noToolEngines.add(engineKey)
        engineNoTools = decision.engineNoTools
        sendAgentStep(event, requestId, decision.step)
        continue
      }
      if (decision.step) sendAgentStep(event, requestId, decision.step)
      if (decision.status === 'supported') input.onTurnComplete?.(turnTrace, decision.text)
      return agentResult(input, decision.status, decision.text, usage, resultReasoning(), ledger)
    }
    usage = mergeUsage(usage, round.usage)
    if (round.reasoning) {
      reasoningAll = reasoningAll ? `${reasoningAll}\n\n${round.reasoning}` : round.reasoning
    }
    if (usage) {
      announceActivityBusy(lastActivityProvider, {
        phase: 'writing',
        promptTokens: usage.promptTokens,
        outputTokens: usage.outputTokens,
        tokensPerSecond: usage.tokensPerSecond
      })
    }
    const raw = round.raw
    const calls = useTools ? extractToolCalls(raw) : []
    if (calls.length === 0 || !useTools) {
      const text = (raw.content ?? '').trim()
      if (text === '') {
        return agentResult(
          input,
          'error',
          '模型翻是翻了,但最后一句话没说出来 —— 再问一次试试',
          usage,
          resultReasoning(),
          ledger
        )
      }
      addDevLog('request', `翻文件收工 · 第 ${rounds} 轮交卷 · 输出约 ${text.length} 字`)
      input.onTurnComplete?.(turnTrace, text)
      return agentResult(input, 'supported', text, usage, resultReasoning(), ledger)
    }
    messages.push(raw)
    turnTrace.push(raw)
    await fulfillAgentToolCalls({
      event,
      requestId,
      rootPath,
      readChars,
      tavilyKey: input.tavilyKey,
      currentQuestion,
      signal,
      calls,
      messages,
      turnTrace,
      ledger
    })
    addDevLog('request', `翻文件第 ${rounds} 轮:模型要看 ${calls.length} 样东西`)
  }
}

/** 把循环的收尾折成统一的聊天结果(token 总账、思考汇总、耗时都在) */
function agentResult(
  input: { target: ChatTarget; startedAt: number; webLookup: WebLookupMeta },
  status: AiChatResult['status'],
  text: string,
  usage: AiUsage | undefined,
  reasoning: string | undefined,
  ledger: AgentToolLedger
): AiChatResult {
  return {
    status,
    text,
    reasoning,
    model: input.target.model,
    durationMs: Date.now() - input.startedAt,
    usage,
    webLookup: finalizeAgentWebLookup(input.webLookup, ledger.webQueries, ledger.webSources)
  }
}
