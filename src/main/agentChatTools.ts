// 翻文件循环里「这一轮模型喊的工具」:安检 → 执行 → 研究账本 → 提醒卡。
// 轮询与失败兜底住 agentChat;单次执行住 agentRunTool;参数安检住 agentCallArgs。
import { sendChatLookup } from './aiEvidence.ts'
import { sendAgentStep } from './agentTools.ts'
import { type IpcMainInvokeEvent } from 'electron'
import {
  AGENT_REMINDER_MIN_TOOL_CALLS,
  AGENT_WEB_MAX_LOOKUPS,
  REPEAT_NUDGE,
  WEB_BUDGET_NUDGE,
  agentStepText,
  buildAgentReminder,
  stripLastAgentReminder,
  wrapToolResult,
  type AgentChatMessage,
  type AgentToolCall
} from '../ai/agent.ts'
import { TOOL_NAMES } from '../shared/agentTools.ts'
import { prepareAgentCall } from './agentCallArgs.ts'
import { runAgentTool } from './agentRunTool.ts'
import {
  addResearchNote,
  buildResearchNote,
  formatResearchLedger,
  upsertResearchLedger,
  type ResearchNote
} from '../ai/researchLedger.ts'

export interface AgentToolLedger {
  doneCalls: Set<string>
  callIdToKey: Map<string, string>
  webSearchCalls: number
  webFetchCalls: number
  webQueries: string[]
  webSources: string[]
  researchNotes: ResearchNote[]
  toolCallsExecuted: number
}

async function fulfillOneCall(
  call: AgentToolCall,
  input: {
    event: IpcMainInvokeEvent
    requestId: string
    rootPath: string
    readChars: number
    tavilyKey?: string
    currentQuestion: string
  },
  ledger: AgentToolLedger
): Promise<{ role: 'tool'; tool_call_id: string; content: string }> {
  const prep = prepareAgentCall(call, input.rootPath)
  if (!prep.ok) {
    sendAgentStep(
      input.event,
      input.requestId,
      agentStepText(prep.name ?? TOOL_NAMES.listFiles, prep.badTarget, 'error', prep.why)
    )
    return {
      role: 'tool',
      tool_call_id: call.id,
      content: wrapToolResult(`参数不合法:${prep.why}`)
    }
  }
  if (ledger.doneCalls.has(prep.key)) {
    sendAgentStep(input.event, input.requestId, agentStepText(prep.name, prep.stepTarget, 'repeat'))
    return { role: 'tool', tool_call_id: call.id, content: wrapToolResult(REPEAT_NUDGE) }
  }
  ledger.doneCalls.add(prep.key)
  ledger.callIdToKey.set(call.id, prep.key)
  const isWebCall = prep.name === TOOL_NAMES.webSearch || prep.name === TOOL_NAMES.webFetch
  if (isWebCall && ledger.webSearchCalls + ledger.webFetchCalls >= AGENT_WEB_MAX_LOOKUPS) {
    sendAgentStep(
      input.event,
      input.requestId,
      `「${prep.stepTarget}」联网预算已用完,这一条不再执行`
    )
    return { role: 'tool', tool_call_id: call.id, content: wrapToolResult(WEB_BUDGET_NUDGE) }
  }
  const run = await runAgentTool({
    event: input.event,
    requestId: input.requestId,
    prep,
    readChars: input.readChars,
    tavilyKey: input.tavilyKey,
    fetchFocus:
      `${input.currentQuestion} ${ledger.webQueries[ledger.webQueries.length - 1] ?? ''}`.trim()
  })
  if (run.ok && prep.name === TOOL_NAMES.researchNote) {
    const note: ResearchNote = {
      kind: 'note',
      query: '',
      url: '',
      title: '',
      source: prep.researchSource,
      facts: [prep.researchNote]
    }
    ledger.researchNotes.splice(
      0,
      ledger.researchNotes.length,
      ...addResearchNote(ledger.researchNotes, note)
    )
  }
  if (prep.name === TOOL_NAMES.webSearch || prep.name === TOOL_NAMES.webFetch) {
    if (prep.name === TOOL_NAMES.webSearch) ledger.webSearchCalls += 1
    else ledger.webFetchCalls += 1
    for (const q of run.queries)
      if (q !== '' && !ledger.webQueries.includes(q)) ledger.webQueries.push(q)
    for (const s of run.sources)
      if (s !== '' && !ledger.webSources.includes(s)) ledger.webSources.push(s)
    if (run.ok) {
      const note = buildResearchNote({
        kind: prep.name === TOOL_NAMES.webSearch ? 'search' : 'fetch',
        query: prep.name === TOOL_NAMES.webSearch ? (prep.query ?? '') : '',
        url: prep.name === TOOL_NAMES.webFetch ? (prep.fetchUrl ?? '') : '',
        title: prep.name === TOOL_NAMES.webFetch ? (run.hint ?? '') : '',
        source: run.sources.join('、'),
        text: run.rawText,
        focus:
          `${input.currentQuestion} ${ledger.webQueries[ledger.webQueries.length - 1] ?? ''}`.trim()
      })
      if (note) {
        ledger.researchNotes.splice(
          0,
          ledger.researchNotes.length,
          ...addResearchNote(ledger.researchNotes, note)
        )
      }
    }
    sendChatLookup(
      input.event,
      input.requestId,
      run.ok ? 'completed' : 'empty',
      ledger.webSources,
      ledger.webQueries
    )
  }
  if (run.ok && prep.name !== TOOL_NAMES.requestDirectoryAccess) ledger.toolCallsExecuted += 1
  return { role: 'tool', tool_call_id: call.id, content: run.content }
}

/** 把这一轮喊出的工具跑完,结果回填对话,并刷新研究账本与提醒卡 */
export async function fulfillAgentToolCalls(input: {
  event: IpcMainInvokeEvent
  requestId: string
  rootPath: string
  readChars: number
  tavilyKey?: string
  currentQuestion: string
  signal: AbortSignal
  calls: AgentToolCall[]
  messages: AgentChatMessage[]
  turnTrace: AgentChatMessage[]
  ledger: AgentToolLedger
}): Promise<void> {
  const toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }> = []
  for (const call of input.calls) {
    if (input.signal.aborted) break
    toolResults.push(await fulfillOneCall(call, input, input.ledger))
  }
  input.messages.push(...toolResults)
  input.turnTrace.push(...toolResults)
  if (input.ledger.researchNotes.length > 0) {
    input.messages.splice(
      0,
      input.messages.length,
      ...upsertResearchLedger(input.messages, formatResearchLedger(input.ledger.researchNotes))
    )
  }
  input.messages.splice(0, input.messages.length, ...stripLastAgentReminder(input.messages))
  if (input.ledger.toolCallsExecuted >= AGENT_REMINDER_MIN_TOOL_CALLS) {
    input.messages.push({
      role: 'user',
      content: buildAgentReminder(input.currentQuestion)
    })
  }
}
