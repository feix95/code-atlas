import { announceActivityBusy, lastActivityProvider } from './modelStatus.ts'
import { sendResetDelta } from './aiEvidence.ts'
import { sendAgentDelta, sendAgentStep } from './agentTools.ts'
import { type IpcMainInvokeEvent } from 'electron'
import {
  AGENT_MAX_ROUNDS,
  AGENT_REMINDER_MIN_TOOL_CALLS,
  REPEAT_NUDGE,
  ROUND_CAP_NUDGE,
  agentPromptBudget,
  agentReadChars,
  agentRound,
  agentStepText,
  buildAgentReminder,
  compressAgentMessages,
  extractToolCalls,
  mergeUsage,
  stripLastAgentReminder,
  wrapToolResult,
  type AgentChatMessage
} from '../ai/agent.ts'
import { TOOL_NAMES } from '../shared/agentTools.ts'
import { stripCurrentQuestionAnchor } from '../shared/chatHistory.ts'
import { addDevLog } from '../shared/devlog.ts'
import { applyAgentPersona, buildAgentAddendum, flattenAgentMessages } from './agentPersona.ts'
import { handleAgentFailure, type AgentGuardFlags } from './agentFallback.ts'
import { prepareAgentCall } from './agentCallArgs.ts'
import { runAgentTool } from './agentRunTool.ts'
import { reviewAgentAnswer } from './agentSignoff.ts'
import type { AiChatResult, AiUsage, ChatTarget, WebLookupMeta } from '../shared/types.ts'

/**
 * 翻文件模式里「不认工具调用」的引擎黑名单(第一百四十批,只记会话内存,零落盘):
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
 * 「这轮没成」的兜底阶梯住 agentFallback;本文件只留循环与账本。
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
  /** 联网查证开着 = 工具表里多一件 web_search,人设后面多垫一段上网守则 */
  webSearchEnabled: boolean
  /** Tavily 的 Key(可选):填了 web_search 的源队列 Tavily 打头(2026-09-17 产品定) */
  tavilyKey?: string
  /** 顺利交卷时回报本轮的工具往来(assistant 的 tool_calls + tool 结果,不含提问和提醒/质检插话)和最终答案:会话记忆靠它记档 */
  onTurnComplete?: (trace: AgentChatMessage[], answer: string) => void
}): Promise<AiChatResult> {
  const { event, requestId, target, baseMessages, rootPath, ctx, replyCap, allowThinking, signal } =
    input
  const messages: AgentChatMessage[] = [...baseMessages]
  const turnTrace: AgentChatMessage[] = []
  // 本轮用户真正的问题 = 组装消息里最后一条 user(附件/摘要/历史都垫在它前面);
  // 每轮工具结果后垫提醒卡时引用它,把正事重新钉在模型眼皮底下。
  // 剥掉注意力锚(答旧题修复·刀三):提醒卡引用的是干净的问题原文,标牌不进提醒
  let currentQuestion = ''
  for (let i = baseMessages.length - 1; i >= 0; i--) {
    const m = baseMessages[i]
    if (m.role === 'user') {
      // 带图那轮的 content 是分段数组(agent 在带图时被强制关掉,本不该走到这);兜底取文字段
      currentQuestion = stripCurrentQuestionAnchor(typeof m.content === 'string' ? m.content : '')
      break
    }
  }
  // 这引擎摔过「不认工具调用」的跤就直接按普通对话走,连守则都不垫
  const engineKey = `${target.baseUrl}|${target.model}`
  let engineNoTools = noToolEngines.has(engineKey)
  if (engineNoTools) {
    sendAgentStep(event, requestId, '这个模型不会自己翻文件(不支持工具调用),按普通对话回答')
    flattenAgentMessages(messages)
  }
  // 人设后面垫翻文件切片(prompts.ts 的逐字稿):教它现在有什么手脚;
  // 联网查证开着再垫一段上网守则(模型这才知道有 web_search)。拆除兜底认同一把尺子,别拆岔了
  const addendum = buildAgentAddendum(input.webSearchEnabled)
  applyAgentPersona(messages, { addendum, engineNoTools })
  const readChars = agentReadChars(ctx)
  const doneCalls = new Set<string>()
  // 提醒卡门槛和质检闸前置的共同状态表:本场实际执行成功的工具调用次数
  // (参数不合法被拒、防打转被拦的都不算 —— 没真翻过就别拿提醒卡烦它)
  let toolCallsExecuted = 0
  // 质检闸的状态表:本场真执行过 search_content 没有、搜到的文件路径(答案引用对账用)、
  // 已经拦了几次(封顶两次,掰不过来就随它交卷)
  let searchUsed = false
  const searchHitPaths = new Set<string>()
  let salvageNudges = 0
  // 联网质检闸的状态表:本场真正搜过几轮、结果标题/链接(答案引用对账用)、已经纠错几次
  let webSearchCalls = 0
  const webResultTitles: string[] = []
  const webResultUrls: string[] = []
  let webSalvageNudges = 0
  // 工具结果 id → 防打转记账键的对照表:旧资料被压缩成注记时,按它解锁重读
  const callIdToKey = new Map<string, string>()
  const promptBudget = agentPromptBudget(ctx, replyCap)
  // 各道兜底「用过了」的账本(兜底阶梯在 agentFallback)
  const flags: AgentGuardFlags = {
    repetitionRetried: false,
    reminderFailsafe: false,
    slimRetried: false,
    skipNudgeOnce: false
  }
  let usage: AiUsage | undefined
  let reasoningAll: string | undefined
  // 封板账(第一百五十一批):中间轮的话一旦封成独立气泡,思考过程也按轮各归各 ——
  // 早轮的思考已经随流躺在各自封口气泡里,结果里只回最后一轮的;没封过板照旧回全场总账
  let lastRoundReasoning: string | undefined
  let sealedAny = false
  const resultReasoning = (): string | undefined => (sealedAny ? lastRoundReasoning : reasoningAll)
  let rounds = 0
  addDevLog(
    'request',
    `翻文件模式开跑 · 最多 ${AGENT_MAX_ROUNDS} 轮 · 单次读文件约 ${readChars} 字 · 压缩警戒线约 ${promptBudget} tokens`
  )
  for (;;) {
    if (signal.aborted) return agentResult(input, 'cancelled', '', usage, resultReasoning())
    // 上下文将满先腾地方(第一百三十八批):早先翻看的大段原文提炼成占位注记,
    // 最近的留原样;被压掉的按对照表解锁「不许翻第二遍」,模型要重温随时能重读
    const compressed = compressAgentMessages(messages, promptBudget)
    if (compressed) {
      for (const callId of compressed.freedCallIds) {
        const key = callIdToKey.get(callId)
        if (key) doneCalls.delete(key)
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
    // 逼卷令只在「真烧完了轮数」时发;引擎天生不支持工具或刚兜底降级的,发这话是驴唇不对马嘴
    if (rounds >= AGENT_MAX_ROUNDS && !flags.skipNudgeOnce)
      messages.push({ role: 'user', content: ROUND_CAP_NUDGE })
    flags.skipNudgeOnce = false
    rounds += 1
    const round = await agentRound(target, messages, {
      signal,
      maxTokens: replyCap,
      allowThinking,
      useTools,
      webSearchEnabled: input.webSearchEnabled,
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
        doneCalls,
        callIdToKey
      })
      if (decision.kind === 'retry') {
        if (decision.blacklistEngine) noToolEngines.add(engineKey)
        engineNoTools = decision.engineNoTools
        sendAgentStep(event, requestId, decision.step)
        continue
      }
      if (decision.step) sendAgentStep(event, requestId, decision.step)
      if (decision.status === 'supported') input.onTurnComplete?.(turnTrace, decision.text)
      return agentResult(input, decision.status, decision.text, usage, resultReasoning())
    }
    usage = mergeUsage(usage, round.usage)
    if (round.reasoning)
      reasoningAll = reasoningAll ? `${reasoningAll}\n\n${round.reasoning}` : round.reasoning
    // 状态条的实时计数是流式增量顺手喂的,翻文件按轮非流式没增量可蹭 ——
    // 每轮收完账自己报一次,左下角不至于整场只挂「在干活……」
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
          resultReasoning()
        )
      }
      // 质检闸(救敷衍)与联网质检闸:判据与话术住 agentSignoff,这里只管拦下重答的账
      const nudge = reviewAgentAnswer({
        answer: text,
        question: currentQuestion,
        useTools,
        toolCallsExecuted,
        searchUsed,
        hitPaths: [...searchHitPaths],
        webSearchCalls,
        webTitles: webResultTitles,
        webUrls: webResultUrls,
        salvageNudges,
        webSalvageNudges,
        rounds
      })
      if (nudge) {
        if (nudge.kind === 'file') salvageNudges += 1
        else webSalvageNudges += 1
        flags.skipNudgeOnce = true
        messages.push(raw)
        messages.push({ role: 'user', content: nudge.nudge })
        sendResetDelta(event, requestId)
        sendAgentStep(event, requestId, nudge.step)
        continue
      }
      addDevLog('request', `翻文件收工 · 第 ${rounds} 轮交卷 · 输出约 ${text.length} 字`)
      input.onTurnComplete?.(turnTrace, text)
      return agentResult(input, 'supported', text, usage, resultReasoning())
    }
    // 工具调用原样回填进对话(服务端要求 assistant 消息和 tool 结果成对出现)
    messages.push(raw)
    turnTrace.push(raw)
    const toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }> = []
    for (const call of calls) {
      if (signal.aborted) break
      const prep = prepareAgentCall(call, rootPath)
      if (!prep.ok) {
        sendAgentStep(
          event,
          requestId,
          agentStepText(prep.name ?? TOOL_NAMES.listFiles, prep.badTarget, 'error', prep.why)
        )
        toolResults.push({
          role: 'tool',
          tool_call_id: call.id,
          content: wrapToolResult(`参数不合法:${prep.why}`)
        })
        continue
      }
      if (doneCalls.has(prep.key)) {
        sendAgentStep(event, requestId, agentStepText(prep.name, prep.stepTarget, 'repeat'))
        toolResults.push({
          role: 'tool',
          tool_call_id: call.id,
          content: wrapToolResult(REPEAT_NUDGE)
        })
        continue
      }
      doneCalls.add(prep.key)
      if (prep.name === TOOL_NAMES.searchContent) searchUsed = true // 质检闸的账:真发起过搜索才算搜过
      callIdToKey.set(call.id, prep.key)
      const run = await runAgentTool({
        event,
        requestId,
        prep,
        readChars,
        tavilyKey: input.tavilyKey
      })
      // 联网账:搜过几轮、命中哪些标题/链接(交卷时质检闸要对账)
      if (prep.name === TOOL_NAMES.webSearch) {
        webSearchCalls += 1
        for (const hit of run.webHits) {
          webResultTitles.push(hit.title)
          webResultUrls.push(hit.url)
        }
      }
      // 质检闸的对状态表:本场搜到的文件路径都记下,答案交卷时查它引用了没(判据二)
      for (const path of run.matchPaths) searchHitPaths.add(path)
      if (run.ok && prep.name !== TOOL_NAMES.requestDirectoryAccess) toolCallsExecuted += 1 // 真执行成功才记账:提醒卡门槛和质检闸前置都用这本账
      toolResults.push({ role: 'tool', tool_call_id: call.id, content: run.content })
    }
    messages.push(...toolResults)
    turnTrace.push(...toolResults)
    // 每轮工具结果后垫提醒卡(LLM 优化批次):撤掉上一张再垫新的,对话里永远只挂
    // 最新一张 —— 工具结果一大坨最容易把真问题挤出小模型的注意力,靠它每轮抬头见正事。
    // 触发门槛(提示词体系重写第二批):本场真翻满 AGENT_REMINDER_MIN_TOOL_CALLS 次才垫 ——
    // 资料还少的头几轮垫卡只会稀释注意力;撤卡照旧每轮先撤,保证不攒
    messages.splice(0, messages.length, ...stripLastAgentReminder(messages))
    if (toolCallsExecuted >= AGENT_REMINDER_MIN_TOOL_CALLS) {
      messages.push({ role: 'user', content: buildAgentReminder(currentQuestion) })
    }
    addDevLog('request', `翻文件第 ${rounds} 轮:模型要看 ${calls.length} 样东西`)
  }
}

/** 把循环的收尾折成统一的聊天结果(token 总账、思考汇总、耗时都在) */
function agentResult(
  input: { target: ChatTarget; startedAt: number; webLookup: WebLookupMeta },
  status: AiChatResult['status'],
  text: string,
  usage: AiUsage | undefined,
  reasoning: string | undefined
): AiChatResult {
  return {
    status,
    text,
    reasoning,
    model: input.target.model,
    durationMs: Date.now() - input.startedAt,
    usage,
    webLookup: input.webLookup
  }
}
