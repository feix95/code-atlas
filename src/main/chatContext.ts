// 自由对话请求的前置装配:收编图片/文件附件、能力闸、联网查询、预算与历史规划、
// 消息组装。ipcChat 只管流程(翻文件 or 普通问答),这里把「这一轮带什么」备齐。
import { userDataDir } from './paths.ts'
import {
  electronFetchText,
  electronPostJson,
  resolveChatTargetOrError,
  sendChatLookup
} from './aiEvidence.ts'
import { sendAgentStep } from './agentTools.ts'
import { planChatMemory } from './chatMemory.ts'
import { estimateThreadTokens, toPlainHistory } from '../ai/chatThread.ts'
import { buildAttachmentBlock } from './chatAttachments.ts'
import { imageGate, planImageBudget, sanitizeChatImages } from '../shared/chatImage.ts'
import type { ChatMessageContent } from '../shared/chatImage.ts'
import { sanitizeChatFiles } from '../shared/chatFiles.ts'
import { shrinkChatImage } from './imageShrink.ts'
import { probeChatVision } from './modelStatus.ts'
import type { AgentChatMessage } from '../ai/agent.ts'
import type { IpcMainInvokeEvent } from 'electron'
import { THINKING_EXTRA_TOKENS } from '../shared/aiDefaults.ts'
import {
  codeRefsBudget,
  estimateTokens,
  hasSearchIntent,
  buildAttachmentText,
  sanitizeAttachment,
  sanitizeCodeRefs,
  buildFreeChatMessages,
  pickWebLookupQuery,
  resolveWebLookupMeta
} from '../ai/index.ts'
import { webLookupDetailed } from '../ai/weblookup.ts'
import { loadAiConfig } from '../ai/config.ts'
import { sanitizeCompactSummary } from '../shared/compact.ts'
import { buildChatSystem } from '../ai/prompts.ts'
import { withPersonalization } from '../shared/personalization.ts'
import type { AiChatResult, WebLookupMeta } from '../shared/types.ts'

const NOT_REQUESTED: WebLookupMeta = {
  requested: false,
  enabled: false,
  attempted: false,
  state: 'not_requested',
  sources: []
}

/** 讲解请求认的消息形状(与 buildFreeChatMessages 的产出一致) */
type ExplainMessage = { role: 'system' | 'user' | 'assistant'; content: ChatMessageContent }

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
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  // 图片附件(第一百五十二批):先洗白收编 —— 数量/格式/魔数/大小都验过。
  // 带了图却一张没进来的,直接说清为什么不放行,不静默丢图
  const imgSan = sanitizeChatImages(body.images)
  const images = imgSan.images
  if (Array.isArray(body.images) && body.images.length > 0 && images.length === 0) {
    return {
      ok: false,
      result: {
        status: 'error',
        text: `图片没能收进来:${imgSan.rejected.join(';') || '格式不支持'}`,
        model: '',
        durationMs: Date.now() - startedAt,
        webLookup: NOT_REQUESTED
      }
    }
  }
  // 文件附件(对齐 Claude Code 的 @文件):同图片一个口径先洗白收编 ——
  // 数量/形状都验过;带了文件却一个都没进来的,直接说清为什么不放行,不静默丢文件
  const fileSan = sanitizeChatFiles(body.files)
  const files = fileSan.files
  if (Array.isArray(body.files) && body.files.length > 0 && files.length === 0) {
    return {
      ok: false,
      result: {
        status: 'error',
        text: `文件没能收进来:${fileSan.rejected.join(';') || '读不出内容'}`,
        model: '',
        durationMs: Date.now() - startedAt,
        webLookup: NOT_REQUESTED
      }
    }
  }
  // 带引用/文件就允许「只发资料不发问题」,这时给一句通用问法当题目 ——
  // 光甩几段代码过去,模型不知道该讲哪一面。先用保底账探一下有没有引用,
  // 真正按本轮上下文窗口裁额度,要等模型服务和思考开关都落定之后(见下方 codeRefs);
  // 只发图、只发文件都不发字也行 —— 图和文件本身就是题目,给一句兜底问法
  const hasRefs = sanitizeCodeRefs(body.codeRefs).length > 0
  if (!question && !hasRefs && images.length === 0 && files.length === 0) {
    return {
      ok: false,
      result: {
        status: 'error',
        text: '先输入一句话再发送',
        model: '',
        durationMs: 0,
        webLookup: NOT_REQUESTED
      }
    }
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId : ''
  const questionText =
    question ||
    (files.length > 0
      ? images.length > 0
        ? '看看带进来的图片和文件,说说里面是什么'
        : '看看带进来的文件,说说里面是什么'
      : images.length > 0
        ? '看看这张图片,说说你看到了什么'
        : '讲讲选中的这段代码')
  const attachment = sanitizeAttachment(body.context)
  // 思考模式(第一百一十五批):界面开关说了算;开着就允许模型先想一遍,思考过程展示给用户
  const thinking = body.thinking === true
  const requested = hasSearchIntent(questionText)
  // 图片入口的能力闸:带图先问模型认不认图 —— 渲染层置灰和这里拦截用同一把尺 imageGate;
  // 纯文本模型直接拦下说人话,绝不把图悄悄扔了当纯文字发
  if (images.length > 0) {
    const gate = imageGate(await probeChatVision(await loadAiConfig(userDataDir())), images.length)
    if (!gate.allow) {
      return {
        ok: false,
        result: {
          status: 'error',
          text: gate.reason ?? '当前模型看不了图片',
          model: '',
          durationMs: Date.now() - startedAt,
          webLookup: NOT_REQUESTED
        }
      }
    }
    if (gate.hint) sendAgentStep(event, requestId, gate.hint)
    if (imgSan.rejected.length > 0)
      sendAgentStep(event, requestId, `有图片没带进来:${imgSan.rejected.join(';')}`)
  }
  // 翻文件模式跟图片不对付(第一百五十二批):带图这轮强制不翻,垫句灰字说清楚
  // (文件附件是纯文本,跟翻文件不冲突,两者可以一起用 —— 附件截断时探针还能顺着 offset 续读)
  const agentOn = body.agent === true && images.length === 0
  if (body.agent === true && !agentOn) sendAgentStep(event, requestId, '这一轮带图片,没有翻文件')
  // 有文件没带进来的(部分被拒):垫句灰字照实说,别装无事发生
  if (files.length > 0 && fileSan.rejected.length > 0)
    sendAgentStep(event, requestId, `有文件没带进来:${fileSan.rejected.join(';')}`)

  const resolved = await resolveChatTargetOrError()
  if ('error' in resolved) {
    // 模型服务都没通,查询自然也没发生:如实记成 failed,不让状态表装无事发生
    const meta: WebLookupMeta = requested
      ? { requested: true, enabled: false, attempted: false, state: 'failed', sources: [] }
      : NOT_REQUESTED
    return {
      ok: false,
      result: {
        status: 'error',
        text: resolved.error,
        model: '',
        durationMs: Date.now() - startedAt,
        webLookup: meta
      }
    }
  }

  // 联网查询先行:状态边查边播报(searching → completed/failed/empty),不等模型开金口
  const enabled = resolved.webLookup
  let outcome:
    | { kind: 'skipped' }
    | { kind: 'attempted'; material: string; sources: string[] }
    | { kind: 'error' } = { kind: 'skipped' }
  let webMaterial: { query: string; material: string } | null = null
  if (requested && enabled) {
    const query = pickWebLookupQuery(questionText, attachment)
    sendChatLookup(event, requestId, 'searching', [])
    try {
      // 源队列在纯函数层:Tavily 有 Key 打头,没 Key 走免费链(DDG → 维基)
      const found = await webLookupDetailed(query, {
        fetchText: electronFetchText,
        postJson: electronPostJson,
        tavilyKey: resolved.tavilyKey
      })
      outcome = { kind: 'attempted', material: found.material, sources: found.sources }
      if (found.material) webMaterial = { query, material: found.material }
    } catch {
      outcome = { kind: 'error' }
    }
    const finalState =
      outcome.kind === 'attempted' ? (outcome.material === '' ? 'empty' : 'completed') : 'failed'
    sendChatLookup(
      event,
      requestId,
      finalState,
      outcome.kind === 'attempted' ? outcome.sources : []
    )
  }

  const meta = resolveWebLookupMeta(requested, enabled, outcome)
  // 闲聊底座 = 内核 + 聊天切片;翻文件开着时无工具切片不挂(翻文件切片由 agent 路自己追加)
  const systemPrompt = withPersonalization(buildChatSystem({ agent: agentOn }), resolved.style)
  // 开思考就多给一笔推理额度:思考段也算在 max_tokens 里,不加额度思考就把答案吃光(第一百一十五批)
  const cap = thinking
    ? resolved.budgets.replyTokens + THINKING_EXTRA_TOKENS
    : resolved.budgets.replyTokens
  // 图片优先让路(第一百五十二批):预算规划给每张图定缩到的尺寸与估算 token,
  // 估算并进固定开销 —— 历史和代码引用自然从剩余配额里划,不另开同一数据源;
  // 装不下就报人话错误,绝不静默丢图
  let sendImages = images
  let imageTokens = 0
  const baseFixedTokens =
    estimateTokens(systemPrompt) +
    estimateTokens(attachment ? buildAttachmentText(attachment) : '') +
    estimateTokens(questionText) +
    estimateTokens(webMaterial ? webMaterial.material : '')
  if (images.length > 0) {
    const plan = planImageBudget({
      ctxTokens: resolved.ctx,
      replyTokens: cap,
      otherTokens: baseFixedTokens,
      images: images.map((img) => ({ width: img.width, height: img.height }))
    })
    if (!plan.ok) {
      return {
        ok: false,
        result: {
          status: 'error',
          text: plan.reason,
          model: '',
          durationMs: Date.now() - startedAt,
          webLookup: meta
        }
      }
    }
    imageTokens = plan.items.reduce((sum, it) => sum + it.tokens, 0)
    sendImages = images.map((img, i) => {
      const seat = plan.items[i]
      return seat.width === img.width && seat.height === img.height
        ? img
        : shrinkChatImage(img, seat.width, seat.height)
    })
  }
  const attachBlock = await buildAttachmentBlock({
    files,
    conversationId: body.conversationId,
    ctxTokens: resolved.ctx,
    replyTokens: cap,
    otherTokens: baseFixedTokens + imageTokens,
    agentOn
  })
  const fileTokens = attachBlock ? estimateTokens(attachBlock) : 0
  // 对话记忆:按模型档位规划历史(小模型档按预算装会话线程,大模型档保持旧行为);
  // 固定开销 = 人设+附件+本轮问题+联网资料+图片+文件,历史预算从剩余配额里划
  const fixedTokens = baseFixedTokens + imageTokens + fileTokens
  const memory = planChatMemory({
    body,
    provider: resolved.provider,
    contextTokens: resolved.ctx,
    fixedTokens,
    replyTokens: cap
  })
  const plainHistory = toPlainHistory(memory.planned.messages)
  // 引用的动态账(第一百二十六批):上下文窗口先给人设+附件+历史+问题留座,回答(含思考预留)也占座,
  // 剩下的折成字符才是引用能带的量;穷保底、富封顶,额度跟着用户设的上下文走
  const otherTokens =
    fixedTokens + estimateThreadTokens(agentOn ? memory.planned.messages : plainHistory)
  const refsBudget = codeRefsBudget({
    contextTokens: resolved.ctx,
    otherTokens,
    replyTokens: cap
  })
  const codeRefs = sanitizeCodeRefs(body.codeRefs, refsBudget)
  const questionText2 = question || (codeRefs.length > 0 ? '讲讲选中的这段代码' : questionText)
  // 手动压缩的早前对话摘要(第一百四十二批):/compact 之后每次请求都带,垫在历史前面当背景记忆
  const summary = sanitizeCompactSummary(body.summary)
  const assembleMessages = (chatHistory: AgentChatMessage[]): ExplainMessage[] =>
    buildFreeChatMessages(
      systemPrompt,
      attachment,
      chatHistory,
      questionText2,
      webMaterial,
      codeRefs,
      resolved.teaching,
      summary,
      sendImages,
      attachBlock ?? undefined
    ) as ExplainMessage[]
  const agentRoot =
    typeof body.rootPath === 'string' && body.rootPath.trim() !== '' ? body.rootPath : ''
  return {
    ok: true,
    prep: {
      requestId,
      thinking,
      agentOn,
      agentRoot,
      question,
      resolved,
      meta,
      cap,
      systemPrompt,
      plainHistory,
      memory,
      assembleMessages
    }
  }
}
