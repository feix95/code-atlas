// 研究计划与交卷闸门的主进程接线:首轮计划表回填、交卷前对账补查。
// 判档、下限与闸门裁决住 ai/researchPlan.ts;本文件只管往对话里垫消息、发灰字、记账。
import { type IpcMainInvokeEvent } from 'electron'
import {
  wrapToolResult,
  type AgentChatMessage,
  type AgentRawAssistant,
  type AgentRoundResult,
  type AgentToolCall
} from '../ai/agent.ts'
import {
  buildResearchGateNudge,
  runResearchPlanCall,
  shouldGateAnswer,
  unmetResearchFloor,
  type ResearchCounts,
  type ResearchFloor
} from '../ai/researchPlan.ts'
import { TOOL_NAMES } from '../shared/agentTools.ts'
import { addDevLog } from '../shared/devlog.ts'
import { sendAgentStep } from './agentTools.ts'

/** 补查闸门的账:劝了几次、上一劝之后工具动作走到哪 */
export interface ResearchGateState {
  nudges: number
  mark: number
}

/** 引擎拒绝 tool_choice=required:只跳过计划表,不算「不支持工具」 */
export function isPlanForceUnsupported(round: AgentRoundResult): boolean {
  return (
    round.status === 'error' &&
    (round.httpStatus === 400 || round.httpStatus === 422) &&
    /tool_choice|required/i.test(round.text)
  )
}

/** 首轮计划表回填:计划结果写回对话,返回程序下限(读不懂为 null) */
export function completeResearchPlanRound(input: {
  event: IpcMainInvokeEvent
  requestId: string
  raw: AgentRawAssistant
  calls: AgentToolCall[]
  messages: AgentChatMessage[]
}): ResearchFloor | null {
  input.messages.push(input.raw)
  let floor: ResearchFloor | null = null
  const results = input.calls.map((call, index) => {
    if (index === 0 && call.name === TOOL_NAMES.planResearch) {
      const outcome = runResearchPlanCall(call.args)
      floor = outcome.floor
      sendAgentStep(input.event, input.requestId, outcome.step)
      if (outcome.floor) {
        addDevLog(
          'request',
          `研究计划 · ${outcome.step} · 最低联网 ${outcome.floor.lookups} / 正文 ${outcome.floor.fetches} / 本地 ${outcome.floor.local}`
        )
      }
      return { role: 'tool' as const, tool_call_id: call.id, content: outcome.content }
    }
    return {
      role: 'tool' as const,
      tool_call_id: call.id,
      content: wrapToolResult('这一轮只填研究计划,别的工具下一轮再用')
    }
  })
  input.messages.push(...results)
  return floor
}

/**
 * 交卷前对账(会就地垫消息、发灰字):缺口还在就打回去补查,返回是否拦下了。
 * 草稿已经流到界面:先封口保留,补查后的答案另起一泡。
 */
export function gateResearchAnswer(input: {
  event: IpcMainInvokeEvent
  requestId: string
  floor: ResearchFloor | null
  counts: ResearchCounts
  githubOpens: number
  state: ResearchGateState
  toolsAvailable: boolean
  webBudgetLeft: boolean
  text: string
  raw: AgentRawAssistant
  messages: AgentChatMessage[]
  sealDraft: () => void
}): boolean {
  const { floor, counts, state } = input
  if (!floor) return false
  const mark = counts.lookups + counts.local + input.githubOpens
  const gated = shouldGateAnswer({
    floor,
    counts,
    nudges: state.nudges,
    hasNewProgress: state.nudges === 0 || mark > state.mark,
    toolsAvailable: input.toolsAvailable,
    webBudgetLeft: input.webBudgetLeft
  })
  if (!gated) return false
  const missing = unmetResearchFloor(floor, counts)
  state.nudges += 1
  state.mark = mark
  if (input.text !== '') {
    input.sealDraft()
    input.messages.push(input.raw)
  }
  input.messages.push({ role: 'user', content: buildResearchGateNudge(missing) })
  sendAgentStep(
    input.event,
    input.requestId,
    `按它自报的计划,还差${missing.join('、')} —— 先补查再交卷`
  )
  addDevLog('request', `研究补查闸门第 ${state.nudges} 次:还差${missing.join('、')}`)
  return true
}
