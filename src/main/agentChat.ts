import { announceActivityBusy, lastActivityProvider } from './modelStatus.ts'
import { sendResetDelta } from './aiEvidence.ts'
import {
  agentDirectoryAccess,
  agentListFiles,
  agentReadFile,
  agentRequestDirectoryAccess,
  agentSearchContent,
  agentWebSearch,
  sendAgentDelta,
  sendAgentMatches,
  sendAgentStep
} from './agentTools.ts'
import { type IpcMainInvokeEvent } from 'electron'
import {
  AGENT_MAX_ROUNDS,
  AGENT_REMINDER_MIN_TOOL_CALLS,
  AGENT_REMINDER_PREFIX,
  AGENT_WEB_ADDENDUM,
  ROUND_CAP_NUDGE,
  REPEAT_NUDGE,
  SALVAGE_CITE_NUDGE,
  SALVAGE_NUDGE_MAX,
  SALVAGE_SEARCH_NUDGE,
  agentPromptBudget,
  agentReadChars,
  agentRound,
  agentStepText,
  buildAgentReminder,
  compressAgentMessages,
  extractToolCalls,
  emergencySlim,
  findAnswerGap,
  isFindQuestion,
  mergeUsage,
  sanitizeAgentRelPath,
  stripLastAgentReminder,
  toolCallKey,
  wrapToolResult,
  type AgentChatMessage
} from '../ai/agent.ts'
import { asToolName, TOOL_NAMES } from '../shared/agentTools.ts'
import { stripCurrentQuestionAnchor } from '../shared/chatHistory.ts'
import { isContextOverflow } from '../ai/index.ts'
import { truncateAtRepetition } from '../ai/repetition.ts'
import { sanitizeWebQuery } from '../ai/weblookup.ts'
import { AGENT_FILES_ADDENDUM, SLICE_NO_TOOLS } from '../ai/prompts.ts'
import { addDevLog } from '../shared/devlog.ts'
import { sanitizeExternalDirectoryPath } from './agentAccess.ts'
import type {
  AgentSearchMatch,
  AiChatResult,
  AiUsage,
  ChatTarget,
  WebLookupMeta
} from '../shared/types.ts'

/**
 * 翻文件模式里「不认工具调用」的引擎黑名单(第一百四十锤,只记会话内存,零落盘):
 * 键 = baseUrl|模型名。有的外接服务(甚至不带工具模板的模型文件)收到 tools 字段
 * 直接甩 400,循环还没起步就断 —— 摔过一跤的记下来,下次直接按普通对话回答,
 * 不再拿石头砸自己的脚。
 */
const noToolEngines = new Set<string>()

/**
 * 翻文件模式的工具循环:模型喊工具 → 主进程沙盒里执行 → 结果喂回 → 循环,
 * 直到模型交出不带工具调用的正文答案。缰绳三根:轮数封顶(到顶后撤掉工具表
 * 逼它交卷)、同一样东西不许翻第二遍、每轮之间都听用户的取消。
 * 模型不会喊工具也没关系:第一轮就交正文,当普通回答返回 —— 不装 agent 空转。
 */
export async function runAgentChat(input: {
  event: IpcMainInvokeEvent
  requestId: string
  target: ChatTarget
  systemPrompt: string
  baseMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  rootPath: string
  ctx: number
  replyCap: number
  allowThinking: boolean
  signal: AbortSignal
  startedAt: number
  webLookup: WebLookupMeta
  /** 联网查证开着 = 工具表里多一件 web_search,人设后面多垫一段上网守则 */
  webSearchEnabled: boolean
  /** Tavily 的 Key(可选):填了 web_search 的源队列 Tavily 打头(2026-09-17 小葵定) */
  tavilyKey?: string
}): Promise<AiChatResult> {
  const { event, requestId, target, baseMessages, rootPath, ctx, replyCap, allowThinking, signal } =
    input
  const messages: AgentChatMessage[] = [...baseMessages]
  // 本轮用户真正的问题 = 组装消息里最后一条 user(附件/摘要/历史都垫在它前面);
  // 每轮工具结果后垫提醒卡时引用它,把正事重新钉在模型眼皮底下。
  // 剥掉注意力锚(答旧题修复·刀三):提醒卡引用的是干净的问题原文,标牌不进提醒
  let currentQuestion = ''
  for (let i = baseMessages.length - 1; i >= 0; i--) {
    const m = baseMessages[i]
    if (m.role === 'user') {
      currentQuestion = stripCurrentQuestionAnchor(m.content)
      break
    }
  }
  // 这引擎摔过「不认工具调用」的跤就直接按普通对话走,连守则都不垫
  const engineKey = `${target.baseUrl}|${target.model}`
  let engineNoTools = noToolEngines.has(engineKey)
  if (engineNoTools) {
    sendAgentStep(event, requestId, '这个模型不会自己翻文件(不支持工具调用),按普通对话回答')
  }
  // 人设后面垫翻文件切片(prompts.ts 的逐字稿):教它现在有什么手脚;
  // 联网查证开着再垫一段上网守则(模型这才知道有 web_search)。拆除兜底认同一把尺子,别拆岔了
  // (旧 AGENT_ADDENDUM 自带开头的 \n\n,新切片没带 —— 在这里拼进去,摘除时 endsWith+slice 连分隔符一起裁)
  const addendum = `\n\n${AGENT_FILES_ADDENDUM}${input.webSearchEnabled ? AGENT_WEB_ADDENDUM : ''}`
  const systemIdx = messages.findIndex((m) => m.role === 'system')
  if (systemIdx >= 0) {
    const sysContent = (messages[systemIdx] as { content: string }).content
    // 黑名单引擎也得给句准话:agent 底座(buildChatSystem({agent:true}))里没有「没手脚」切片,
    // 什么都不垫,模型会照旧吹自己翻过项目 —— 改垫无工具切片,明说本轮没有翻文件能力
    messages[systemIdx] = {
      role: 'system',
      content: engineNoTools ? `${sysContent}\n\n${SLICE_NO_TOOLS}` : `${sysContent}${addendum}`
    }
  }
  const readChars = agentReadChars(ctx)
  const doneCalls = new Set<string>()
  // 提醒卡门槛和质检闸前置的共同账本:本场实际执行成功的工具调用次数
  // (参数不合法被拒、防打转被拦的都不算 —— 没真翻过就别拿提醒卡烦它)
  let toolCallsExecuted = 0
  // 质检闸的账本:本场真执行过 search_content 没有、搜到的文件路径(答案引用对账用)、
  // 已经拦了几次(封顶两次,掰不过来就随它交卷)
  let searchUsed = false
  const searchHitPaths = new Set<string>()
  let salvageNudges = 0
  // 工具结果 id → 防打转记账键的对照表:旧资料被压缩成纸条时,按它解锁重读
  const callIdToKey = new Map<string, string>()
  const promptBudget = agentPromptBudget(ctx, replyCap)
  let usage: AiUsage | undefined
  let reasoningAll: string | undefined
  // 封板账(第一百五十一锤):中间轮的话一旦封成独立气泡,思考过程也按轮各归各 ——
  // 早轮的思考已经随流躺在各自封口气泡里,结果里只回最后一轮的;没封过板照旧回全场总账
  let lastRoundReasoning: string | undefined
  let sealedAny = false
  const resultReasoning = (): string | undefined => (sealedAny ? lastRoundReasoning : reasoningAll)
  let rounds = 0
  // 兜底降级后的重答轮不算「轮数烧完」,别把逼卷令也塞进去
  let skipNudgeOnce = false
  // 提醒卡兜底只许用一次:撤卡重答还 4xx 就不是卡的锅了,照实报错
  let reminderFailsafe = false
  // 复读机兜底也只许用一次:重说还打转就截断交卷,不无限跟它耗
  let repetitionRetried = false
  // 紧急瘦身也只许用一次:裁旧账重试还爆,就是这锅真装不下,照实报错
  let slimRetried = false
  addDevLog(
    'request',
    `翻文件模式开跑 · 最多 ${AGENT_MAX_ROUNDS} 轮 · 单次读文件约 ${readChars} 字 · 压缩警戒线约 ${promptBudget} tokens`
  )
  for (;;) {
    if (signal.aborted) return agentResult(input, 'cancelled', '', usage, resultReasoning())
    // 锅快满了先腾地方(第一百三十八锤):早先翻看的大段原文提炼成占位纸条,
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
        `对话快记满了,把较早翻看的 ${compressed.compressedCount} 样旧资料提炼成了占位纸条 —— 要重温随时能再翻`
      )
      addDevLog(
        'request',
        `翻文件第 ${rounds + 1} 轮前压缩:${compressed.compressedCount} 条旧资料成了纸条,腾出约 ${compressed.freedCallIds.length} 处重读权`
      )
    }
    const useTools = !engineNoTools && rounds < AGENT_MAX_ROUNDS
    // 逼卷令只在「真烧完了轮数」时发;引擎天生不支持工具或刚兜底降级的,发这话是驴唇不对马嘴
    if (rounds >= AGENT_MAX_ROUNDS && !skipNudgeOnce)
      messages.push({ role: 'user', content: ROUND_CAP_NUDGE })
    skipNudgeOnce = false
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
      // 复读机兜底(第一百四十三锤):流式尾巴连着打转 —— agentRound 已发 reset 令收回
      // 已吐的字。掐了重说一轮(只兜一次);重说还打转就截到打转起点,拿剩下的交卷,
      // 绝不把一屏望不到头的循环递给用户
      if (round.status === 'repetition') {
        if (!repetitionRetried) {
          repetitionRetried = true
          skipNudgeOnce = true // 重答这轮不算「轮数烧完」,别把逼卷令也捎上
          sendAgentStep(event, requestId, '回答说到半截开始原地打转,掐掉重说一遍')
          continue
        }
        const text = (truncateAtRepetition(round.text) ?? round.text).trim()
        if (text === '') {
          return agentResult(
            input,
            'error',
            '模型连着两回都说到一半原地打转 —— 换个问法重新问问看',
            usage,
            resultReasoning()
          )
        }
        sendAgentStep(event, requestId, '重说了一回还在原地打转,把打转的部分掐了,先把说完的交给你')
        return agentResult(input, 'supported', text, usage, resultReasoning())
      }
      // 兜底(第一百四十锤):引擎不认工具调用(甩 400/404/422 还点名 tools)——
      // 记进会话黑名单,拆掉人设里垫的守则,这轮按普通对话重答;只兜一次,
      // 普通请求再出错照实报给用户
      if (
        round.status === 'error' &&
        round.toolsUnsupported === true &&
        useTools &&
        !engineNoTools
      ) {
        noToolEngines.add(engineKey)
        engineNoTools = true
        skipNudgeOnce = true
        sendAgentStep(
          event,
          requestId,
          '这个模型不支持自己翻文件(工具调用),这轮先按普通对话回答 —— 想用翻文件模式,得换个支持工具调用的模型'
        )
        const sysIdx = messages.findIndex((m) => m.role === 'system')
        if (sysIdx >= 0) {
          let sysContent = (messages[sysIdx] as { content: string }).content
          if (sysContent.endsWith(addendum)) sysContent = sysContent.slice(0, -addendum.length)
          // 切片摘走后,人设里什么能力声明都没剩 —— 补一段「没手脚」切片,别让它空口吹翻过项目。
          // includes 保险:起手黑名单分支理论上和这里互斥,但万一已经垫过就不重复加
          if (!sysContent.includes(SLICE_NO_TOOLS))
            sysContent = `${sysContent}\n\n${SLICE_NO_TOOLS}`
          messages[sysIdx] = { role: 'system', content: sysContent }
        }
        continue
      }
      // 提醒卡兜底:个别外接引擎不认「tool 结果后面跟 user 消息」的形态,甩 4xx ——
      // 撤掉提醒卡退回无卡形态重答一轮(只兜一次);再错就照实报给用户,不跟它耗
      if (
        round.status === 'error' &&
        !reminderFailsafe &&
        (round.httpStatus === 400 || round.httpStatus === 404 || round.httpStatus === 422) &&
        messages.some((m) => m.role === 'user' && m.content.startsWith(AGENT_REMINDER_PREFIX))
      ) {
        reminderFailsafe = true
        skipNudgeOnce = true
        messages.splice(
          0,
          messages.length,
          ...messages.filter(
            (m) => !(m.role === 'user' && m.content.startsWith(AGENT_REMINDER_PREFIX))
          )
        )
        sendAgentStep(event, requestId, '这个模型不太习惯多出来的小纸条,撤掉重答')
        continue
      }
      // 紧急瘦身兜底:轮间的纸条压缩是保养,服务直接甩「上下文装不下」拒收时只有整段裁旧账能救 ——
      // 只保 system 和最新真问题(400 拒收时模型一个字没吐,重试不重影);只兜一次,再爆就照实报错
      if (round.status === 'error' && isContextOverflow(round.text) && !slimRetried) {
        slimRetried = true
        const slimmed = emergencySlim(messages)
        if (slimmed) {
          messages.splice(0, messages.length, ...slimmed.messages)
          // 旧账清了,防打转的账本跟着清:被裁掉结果的旧工具调用,模型要重温得允许重翻
          doneCalls.clear()
          callIdToKey.clear()
          skipNudgeOnce = true
          sendAgentStep(
            event,
            requestId,
            `对话把模型的脑容量撑爆了:把翻看前的旧账整段清掉(约 ${slimmed.dropped} 条),保住你最新的问题,重答一遍`
          )
          continue
        }
      }
      return agentResult(
        input,
        round.status === 'cancelled' ? 'cancelled' : 'error',
        round.text,
        usage,
        resultReasoning()
      )
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
      // 质检闸(救敷衍):找位置题的答案交卷前过两道判据 —— 一次文件都没搜过(逼它先搜)、
      // 搜到了东西却一个具体文件都不引用(逼它把文件写进答案,答案里可点跳转的链接全靠这个)。
      // 拦下重答(先收回已吐的字再垫补救提醒),封顶两次,掰不过来就随它交卷,不无限跟它耗;
      // 轮数已烧完的逼卷轮不拦 —— 那轮它没工具可调,拦了也白拦
      // 前置条件(提示词体系重写第二批):本场一个工具调用都没发生过就直接放行,连 no-search 也不拦 ——
      // 模型一口答出来的题(概念题、闲聊),质检闸没资格逼它先翻文件
      if (
        useTools &&
        toolCallsExecuted > 0 &&
        salvageNudges < SALVAGE_NUDGE_MAX &&
        rounds < AGENT_MAX_ROUNDS
      ) {
        const gap = findAnswerGap({
          isFindQuestion: isFindQuestion(currentQuestion),
          searchUsed,
          hitPaths: [...searchHitPaths],
          answer: text
        })
        if (gap) {
          salvageNudges += 1
          skipNudgeOnce = true
          messages.push(raw)
          messages.push({
            role: 'user',
            content: gap === 'no-search' ? SALVAGE_SEARCH_NUDGE : SALVAGE_CITE_NUDGE
          })
          sendResetDelta(event, requestId)
          sendAgentStep(
            event,
            requestId,
            gap === 'no-search'
              ? '这题是找东西,它一次文件都没搜就想交卷 —— 程序拦下,让它先搜再答'
              : '答案里没落到具体文件 —— 程序拦下,让它把搜到的文件写进答案再交'
          )
          continue
        }
      }
      addDevLog('request', `翻文件收工 · 第 ${rounds} 轮交卷 · 输出约 ${text.length} 字`)
      return agentResult(input, 'supported', text, usage, resultReasoning())
    }
    // 工具调用原样回填进对话(服务端要求 assistant 消息和 tool 结果成对出现)
    messages.push(raw)
    const toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }> = []
    for (const call of calls) {
      if (signal.aborted) break
      const callName = asToolName(call.name)
      const isFileTool =
        callName === TOOL_NAMES.readFile ||
        callName === TOOL_NAMES.listFiles ||
        callName === TOOL_NAMES.searchContent
      const selectedRoot = isFileTool
        ? agentDirectoryAccess.resolve(rootPath, call.args?.rootId)
        : null
      const relPath =
        callName === TOOL_NAMES.webSearch || callName === TOOL_NAMES.requestDirectoryAccess
          ? ''
          : callName === TOOL_NAMES.searchContent && call.args?.relPath === undefined
            ? ''
            : sanitizeAgentRelPath(call.args?.relPath)
      const keyword =
        callName === TOOL_NAMES.searchContent && typeof call.args?.keyword === 'string'
          ? call.args.keyword.trim().slice(0, 200)
          : ''
      const rawQuery = call.args?.query
      const requestedPath =
        callName === TOOL_NAMES.requestDirectoryAccess
          ? sanitizeExternalDirectoryPath(call.args?.path)
          : null
      // web_search 的搜索词走自己的安检(隐私闸):空词/超长/带路径样的一律拒收
      const query = callName === TOOL_NAMES.webSearch ? sanitizeWebQuery(rawQuery) : null
      const queryMissing =
        callName === TOOL_NAMES.webSearch &&
        (typeof rawQuery !== 'string' || rawQuery.trim() === '')
      if (
        !callName ||
        relPath === null ||
        (isFileTool && selectedRoot === null) ||
        (callName === TOOL_NAMES.searchContent && keyword === '') ||
        (callName === TOOL_NAMES.requestDirectoryAccess && requestedPath === null) ||
        (callName === TOOL_NAMES.webSearch && query === null)
      ) {
        const why = !callName
          ? '没有这个工具'
          : isFileTool && selectedRoot === null
            ? '目录编号无效或尚未获准,项目外目录要先申请'
            : callName === TOOL_NAMES.requestDirectoryAccess
              ? '要给用户明确点名的绝对文件夹路径(path)'
              : callName === TOOL_NAMES.webSearch
                ? queryMissing
                  ? '要给搜索词(query),写概念词、软件名或短的公开问题'
                  : '搜索词不合法:别把本地路径、代码或超长文字当搜索词,换几个公开的关键词再试'
                : callName === TOOL_NAMES.searchContent
                  ? '要给关键词(keyword),如 500 或 DWELL_MS'
                  : '路径不合法,要用所选根目录内的相对路径'
        const badTarget =
          callName === TOOL_NAMES.webSearch
            ? String(rawQuery ?? '(没给搜索词)')
            : callName === TOOL_NAMES.requestDirectoryAccess
              ? String(call.args?.path ?? '(没给目录)')
              : String(
                  call.args?.keyword ?? call.args?.relPath ?? call.args?.rootId ?? '(没给参数)'
                )
        sendAgentStep(
          event,
          requestId,
          agentStepText(callName ?? TOOL_NAMES.listFiles, badTarget, 'error', why)
        )
        toolResults.push({
          role: 'tool',
          tool_call_id: call.id,
          content: wrapToolResult(`参数不合法:${why}`)
        })
        continue
      }
      // 防打转键:search 带上关键词、web_search 带上搜索词 —— 同一范围搜「500」和「DWELL_MS」是两笔账
      const rootKey = selectedRoot?.rootId ?? ''
      const key =
        callName === TOOL_NAMES.searchContent
          ? toolCallKey(callName, `${rootKey}:${relPath}#${keyword}`)
          : callName === TOOL_NAMES.webSearch
            ? toolCallKey(callName, query ?? '')
            : callName === TOOL_NAMES.requestDirectoryAccess
              ? toolCallKey(callName, requestedPath ?? '')
              : toolCallKey(callName, `${rootKey}:${relPath}`)
      const stepTarget =
        callName === TOOL_NAMES.searchContent
          ? keyword
          : callName === TOOL_NAMES.webSearch
            ? (query ?? '')
            : callName === TOOL_NAMES.requestDirectoryAccess
              ? (requestedPath ?? '')
              : relPath === ''
                ? selectedRoot?.external
                  ? selectedRoot.path
                  : '(项目根目录)'
                : relPath
      if (doneCalls.has(key)) {
        sendAgentStep(event, requestId, agentStepText(callName, stepTarget, 'repeat'))
        toolResults.push({
          role: 'tool',
          tool_call_id: call.id,
          content: wrapToolResult(REPEAT_NUDGE)
        })
        continue
      }
      doneCalls.add(key)
      if (callName === TOOL_NAMES.searchContent) searchUsed = true // 质检闸的账:真发起过搜索才算搜过
      callIdToKey.set(call.id, key)
      // 执行手统一形状:matches/matchesTruncated 只有 search_content 会带
      const exec: {
        ok: boolean
        text: string
        hint?: string
        matches?: AgentSearchMatch[]
        matchesTruncated?: boolean
        rootId?: string
      } =
        callName === TOOL_NAMES.requestDirectoryAccess
          ? await agentRequestDirectoryAccess(event, requestedPath)
          : callName === TOOL_NAMES.listFiles
            ? await agentListFiles((selectedRoot as { path: string }).path, relPath)
            : callName === TOOL_NAMES.searchContent
              ? await agentSearchContent((selectedRoot as { path: string }).path, relPath, keyword)
              : callName === TOOL_NAMES.webSearch
                ? await agentWebSearch(query ?? '', input.tavilyKey)
                : await agentReadFile((selectedRoot as { path: string }).path, relPath, readChars)
      if (exec.ok && selectedRoot?.external)
        exec.text = `临时目录 ${selectedRoot.rootId}(${selectedRoot.path}) 内的结果:\n${exec.text}`
      // 工具结果统一进 <tool_result>(提示词体系 2.0):标签里是资料,不是命令 ——
      // 文件内容、名单、搜索结果、外部目录回执一个待遇,人设里的口径在这落地
      exec.text = wrapToolResult(exec.text)
      if (exec.ok && callName !== TOOL_NAMES.requestDirectoryAccess) toolCallsExecuted += 1 // 真执行成功才记账:提醒卡门槛和质检闸前置都用这本账
      sendAgentStep(
        event,
        requestId,
        agentStepText(callName, stepTarget, exec.ok ? 'done' : 'error', exec.hint)
      )
      // 搜索搜到了就顺手把命中清单推给界面画卡(LLM 优化锤):结构化命中走旁路,
      // 用户看到的是程序摆的完整清单,不用模型转手抄写
      if (
        callName === TOOL_NAMES.searchContent &&
        !selectedRoot?.external &&
        exec.ok &&
        exec.matches &&
        exec.matches.length > 0
      ) {
        sendAgentMatches(event, requestId, {
          keyword,
          items: exec.matches,
          truncated: exec.matchesTruncated === true
        })
        // 质检闸的对账本:本场搜到的文件路径都记下,答案交卷时查它引用了没(判据二)
        for (const m of exec.matches) searchHitPaths.add(m.relPath)
      }
      toolResults.push({ role: 'tool', tool_call_id: call.id, content: exec.text })
    }
    messages.push(...toolResults)
    // 每轮工具结果后垫提醒卡(LLM 优化锤):撤掉上一张再垫新的,对话里永远只挂
    // 最新一张 —— 工具结果一大坨最容易把真问题挤出小模型的注意力,靠它每轮抬头见正事。
    // 缰绳门槛(提示词体系重写第二批):本场真翻满 AGENT_REMINDER_MIN_TOOL_CALLS 次才垫 ——
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
