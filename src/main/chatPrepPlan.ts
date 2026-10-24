// 自由对话请求的预算与组消息:联网预搜、图片缩放到座、附件块、历史规划、引用额度。
// 入口安检在 chatPrepBody,编排在 chatContext。
import { electronFetchText, electronPostJson, sendChatLookup } from './aiEvidence.ts'
import { planChatMemory } from './chatMemory.ts'
import { estimateThreadTokens, toPlainHistory } from '../ai/chatThread.ts'
import { buildAttachmentBlock } from './chatAttachments.ts'
import { planImageBudget, type ChatImage, type ChatMessageContent } from '../shared/chatImage.ts'
import type { ChatFileAttachment } from '../shared/chatFiles.ts'
import { shrinkChatImage } from './imageShrink.ts'
import type { AgentChatMessage } from '../ai/agent.ts'
import type { IpcMainInvokeEvent } from 'electron'
import {
  codeRefsBudget,
  estimateTokens,
  buildAttachmentText,
  buildFreeChatMessages,
  pickWebLookupQuery,
  resolveWebLookupMeta,
  sanitizeCodeRefs,
  shouldPreSearchWeb
} from '../ai/index.ts'
import { webLookupDetailed } from '../ai/weblookup.ts'
import { sanitizeCompactSummary } from '../shared/compact.ts'
import type { AiProviderKind, ChatContextAttachment, WebLookupMeta } from '../shared/types.ts'
import type { TeachingLevel } from '../shared/personalization.ts'

/** 讲解请求认的消息形状(与 buildFreeChatMessages 的产出一致) */
export type ExplainMessage = { role: 'system' | 'user' | 'assistant'; content: ChatMessageContent }

export type WebMaterial = { query: string; material: string }

export async function lookupChatWeb(input: {
  event: IpcMainInvokeEvent
  requestId: string
  questionText: string
  attachment: ChatContextAttachment | null
  requested: boolean
  enabled: boolean
  agentOn: boolean
  tavilyKey?: string
}): Promise<{ meta: WebLookupMeta; webMaterial: WebMaterial | null }> {
  let outcome:
    | { kind: 'skipped' }
    | { kind: 'attempted'; material: string; sources: string[]; queries?: string[] }
    | { kind: 'error' } = { kind: 'skipped' }
  let webMaterial: WebMaterial | null = null
  if (shouldPreSearchWeb(input.requested, input.enabled, input.agentOn)) {
    const query = pickWebLookupQuery(input.questionText, input.attachment)
    sendChatLookup(input.event, input.requestId, 'searching', [])
    try {
      const found = await webLookupDetailed(query, {
        fetchText: electronFetchText,
        postJson: electronPostJson,
        tavilyKey: input.tavilyKey
      })
      outcome = {
        kind: 'attempted',
        material: found.material,
        sources: found.sources,
        queries: found.queries
      }
      if (found.material) {
        webMaterial = { query: found.queries[0] ?? query, material: found.material }
      }
    } catch {
      outcome = { kind: 'error' }
    }
    const finalState =
      outcome.kind === 'attempted' ? (outcome.material === '' ? 'empty' : 'completed') : 'failed'
    sendChatLookup(
      input.event,
      input.requestId,
      finalState,
      outcome.kind === 'attempted' ? outcome.sources : [],
      outcome.kind === 'attempted' ? (outcome.queries ?? []) : []
    )
  }
  return {
    meta: resolveWebLookupMeta(input.requested, input.enabled, outcome),
    webMaterial
  }
}

function seatImages(
  images: ChatImage[],
  ctxTokens: number,
  replyTokens: number,
  otherTokens: number
): { ok: true; images: ChatImage[]; tokens: number } | { ok: false; reason: string } {
  const plan = planImageBudget({
    ctxTokens,
    replyTokens,
    otherTokens,
    images: images.map((img) => ({ width: img.width, height: img.height }))
  })
  if (!plan.ok) return { ok: false, reason: plan.reason }
  return {
    ok: true,
    tokens: plan.items.reduce((sum, it) => sum + it.tokens, 0),
    images: images.map((img, i) => {
      const seat = plan.items[i]
      return seat.width === img.width && seat.height === img.height
        ? img
        : shrinkChatImage(img, seat.width, seat.height)
    })
  }
}

export type ChatRoundPlan =
  | { ok: false; reason: string }
  | {
      ok: true
      memory: ReturnType<typeof planChatMemory>
      plainHistory: AgentChatMessage[]
      assembleMessages: (history: AgentChatMessage[]) => ExplainMessage[]
    }

/** 按本轮窗口给人设/图/文件/历史/引用留座,交出组消息函数 */
export async function planChatRound(input: {
  body: Record<string, unknown>
  images: ChatImage[]
  files: ChatFileAttachment[]
  question: string
  questionText: string
  attachment: ChatContextAttachment | null
  agentOn: boolean
  systemPrompt: string
  cap: number
  ctx: number
  provider: AiProviderKind
  teaching: TeachingLevel
  webMaterial: WebMaterial | null
}): Promise<ChatRoundPlan> {
  let sendImages = input.images
  let imageTokens = 0
  const baseFixedTokens =
    estimateTokens(input.systemPrompt) +
    estimateTokens(input.attachment ? buildAttachmentText(input.attachment) : '') +
    estimateTokens(input.questionText) +
    estimateTokens(input.webMaterial ? input.webMaterial.material : '')
  if (input.images.length > 0) {
    const seated = seatImages(input.images, input.ctx, input.cap, baseFixedTokens)
    if (!seated.ok) return seated
    imageTokens = seated.tokens
    sendImages = seated.images
  }
  const attachBlock = await buildAttachmentBlock({
    files: input.files,
    conversationId: input.body.conversationId,
    ctxTokens: input.ctx,
    replyTokens: input.cap,
    otherTokens: baseFixedTokens + imageTokens,
    agentOn: input.agentOn
  })
  const fileTokens = attachBlock ? estimateTokens(attachBlock) : 0
  const fixedTokens = baseFixedTokens + imageTokens + fileTokens
  const memory = planChatMemory({
    body: input.body,
    provider: input.provider,
    contextTokens: input.ctx,
    fixedTokens,
    replyTokens: input.cap
  })
  const plainHistory = toPlainHistory(memory.planned.messages)
  const otherTokens =
    fixedTokens + estimateThreadTokens(input.agentOn ? memory.planned.messages : plainHistory)
  const refsBudget = codeRefsBudget({
    contextTokens: input.ctx,
    otherTokens,
    replyTokens: input.cap
  })
  const codeRefs = sanitizeCodeRefs(input.body.codeRefs, refsBudget)
  const questionText =
    input.question || (codeRefs.length > 0 ? '讲讲选中的这段代码' : input.questionText)
  const summary = sanitizeCompactSummary(input.body.summary)
  const assembleMessages = (chatHistory: AgentChatMessage[]): ExplainMessage[] =>
    buildFreeChatMessages(
      input.systemPrompt,
      input.attachment,
      chatHistory,
      questionText,
      input.webMaterial,
      codeRefs,
      input.teaching,
      summary,
      sendImages,
      attachBlock ?? undefined
    ) as ExplainMessage[]
  return { ok: true, memory, plainHistory, assembleMessages }
}
