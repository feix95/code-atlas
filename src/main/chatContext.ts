// 自由对话请求的前置装配编排:安检 → 解析模型 → 联网 → 预算组消息。
// 入口安检住 chatPrepBody,预算与联网住 chatPrepPlan;ipcChat 只管流程。
import { resolveChatTargetOrError } from './aiEvidence.ts'
import { planChatMemory } from './chatMemory.ts'
import type { AgentChatMessage } from '../ai/agent.ts'
import type { IpcMainInvokeEvent } from 'electron'
import { THINKING_EXTRA_TOKENS } from '../shared/aiDefaults.ts'
import { buildChatSystem } from '../ai/prompts.ts'
import { withPersonalization } from '../shared/personalization.ts'
import type { AiChatResult, WebLookupMeta } from '../shared/types.ts'
import { failPrep, ingestChatBody, NOT_REQUESTED } from './chatPrepBody.ts'
import { lookupChatWeb, planChatRound, type ExplainMessage } from './chatPrepPlan.ts'

/** 装配好的一轮请求 */
export interface PreparedChat {
  requestId: string
  thinking: boolean
  agentOn: boolean
  /** 翻文件模式的沙盒根(空串 = 没开项目) */
  agentRoot: string
  question: string
  /** 后端解析结果(含 target / ctx / budgets / webLookup / style / teaching / tavilyKey) */
  resolved: Extract<Awaited<ReturnType<typeof resolveChatTargetOrError>>, { target: object }>
  meta: WebLookupMeta
  cap: number
  systemPrompt: string
  /** 没有翻文件时用的历史(纯文本问答) */
  plainHistory: AgentChatMessage[]
  memory: ReturnType<typeof planChatMemory>
  assembleMessages: (history: AgentChatMessage[]) => ExplainMessage[]
}

/** 装配失败时直接就是回给界面的结果 */
export type ChatPrepResult = { ok: true; prep: PreparedChat } | { ok: false; result: AiChatResult }

/** 把申请体收编成这一轮的请求(失败时 result 直接可回) */
export async function prepareChat(
  event: IpcMainInvokeEvent,
  body: Record<string, unknown>,
  startedAt: number
): Promise<ChatPrepResult> {
  const ingested = await ingestChatBody(event, body, startedAt)
  if (!ingested.ok) return ingested

  const resolved = await resolveChatTargetOrError()
  if ('error' in resolved) {
    const meta: WebLookupMeta = ingested.requested
      ? {
          requested: true,
          enabled: false,
          attempted: false,
          state: 'failed',
          sources: [],
          queries: []
        }
      : NOT_REQUESTED
    return failPrep(startedAt, resolved.error, meta)
  }

  const { meta, webMaterial } = await lookupChatWeb({
    event,
    requestId: ingested.requestId,
    questionText: ingested.questionText,
    attachment: ingested.attachment,
    requested: ingested.requested,
    enabled: resolved.webLookup,
    agentOn: ingested.agentOn,
    tavilyKey: resolved.tavilyKey
  })
  const systemPrompt = withPersonalization(
    buildChatSystem({ agent: ingested.agentOn }),
    resolved.style
  )
  const cap = ingested.thinking
    ? resolved.budgets.replyTokens + THINKING_EXTRA_TOKENS
    : resolved.budgets.replyTokens
  const planned = await planChatRound({
    body,
    images: ingested.images,
    files: ingested.files,
    question: ingested.question,
    questionText: ingested.questionText,
    attachment: ingested.attachment,
    agentOn: ingested.agentOn,
    systemPrompt,
    cap,
    ctx: resolved.ctx,
    provider: resolved.provider,
    teaching: resolved.teaching,
    webMaterial
  })
  if (!planned.ok) return failPrep(startedAt, planned.reason, meta)

  const agentRoot =
    typeof body.rootPath === 'string' && body.rootPath.trim() !== '' ? body.rootPath : ''
  return {
    ok: true,
    prep: {
      requestId: ingested.requestId,
      thinking: ingested.thinking,
      agentOn: ingested.agentOn,
      agentRoot,
      question: ingested.question,
      resolved,
      meta,
      cap,
      systemPrompt,
      plainHistory: planned.plainHistory,
      memory: planned.memory,
      assembleMessages: planned.assembleMessages
    }
  }
}
