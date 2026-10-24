// 自由对话请求的入口安检:图片/文件洗白、空题拦截、看图能力闸、翻文件与带图/没项目互斥。
// prepareChat 的编排在 chatContext,预算与联网在 chatPrepPlan。
import { userDataDir } from './paths.ts'
import { sendAgentStep } from './agentTools.ts'
import { imageGate, sanitizeChatImages, type ChatImage } from '../shared/chatImage.ts'
import { sanitizeChatFiles, type ChatFileAttachment } from '../shared/chatFiles.ts'
import { probeChatVision } from './modelStatus.ts'
import type { IpcMainInvokeEvent } from 'electron'
import { hasSearchIntent, sanitizeAttachment, sanitizeCodeRefs } from '../ai/index.ts'
import { agentOnThisRound } from '../ai/agentGuard.ts'
import { loadAiConfig } from '../ai/config.ts'
import type { AiChatResult, ChatContextAttachment, WebLookupMeta } from '../shared/types.ts'

export const NOT_REQUESTED: WebLookupMeta = {
  requested: false,
  enabled: false,
  attempted: false,
  state: 'not_requested',
  sources: [],
  queries: []
}

export function failPrep(
  startedAt: number,
  text: string,
  webLookup: WebLookupMeta = NOT_REQUESTED,
  durationMs = Date.now() - startedAt
): { ok: false; result: AiChatResult } {
  return {
    ok: false,
    result: {
      status: 'error',
      text,
      model: '',
      durationMs,
      webLookup
    }
  }
}

export type ChatBodyIngest =
  | { ok: false; result: AiChatResult }
  | {
      ok: true
      question: string
      questionText: string
      images: ChatImage[]
      files: ChatFileAttachment[]
      requestId: string
      thinking: boolean
      requested: boolean
      agentOn: boolean
      attachment: ChatContextAttachment | null
    }

function fallbackQuestion(files: ChatFileAttachment[], images: ChatImage[]): string {
  if (files.length > 0) {
    return images.length > 0
      ? '看看带进来的图片和文件,说说里面是什么'
      : '看看带进来的文件,说说里面是什么'
  }
  return images.length > 0 ? '看看这张图片,说说你看到了什么' : '讲讲选中的这段代码'
}

/** 把申请体收到能开装配的程度;过不了闸就直接是回给界面的错误 */
export async function ingestChatBody(
  event: IpcMainInvokeEvent,
  body: Record<string, unknown>,
  startedAt: number
): Promise<ChatBodyIngest> {
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const imgSan = sanitizeChatImages(body.images)
  const images = imgSan.images
  if (Array.isArray(body.images) && body.images.length > 0 && images.length === 0) {
    return failPrep(startedAt, `图片没能收进来:${imgSan.rejected.join(';') || '格式不支持'}`)
  }
  const fileSan = sanitizeChatFiles(body.files)
  const files = fileSan.files
  if (Array.isArray(body.files) && body.files.length > 0 && files.length === 0) {
    return failPrep(startedAt, `文件没能收进来:${fileSan.rejected.join(';') || '读不出内容'}`)
  }
  const hasRefs = sanitizeCodeRefs(body.codeRefs).length > 0
  if (!question && !hasRefs && images.length === 0 && files.length === 0) {
    return failPrep(startedAt, '先输入一句话再发送', NOT_REQUESTED, 0)
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId : ''
  const questionText = question || fallbackQuestion(files, images)
  const attachment = sanitizeAttachment(body.context)
  const thinking = body.thinking === true
  const requested = hasSearchIntent(questionText)
  if (images.length > 0) {
    const gate = imageGate(await probeChatVision(await loadAiConfig(userDataDir())), images.length)
    if (!gate.allow) return failPrep(startedAt, gate.reason ?? '当前模型看不了图片')
    if (gate.hint) sendAgentStep(event, requestId, gate.hint)
    if (imgSan.rejected.length > 0) {
      sendAgentStep(event, requestId, `有图片没带进来:${imgSan.rejected.join(';')}`)
    }
  }
  const agentOn = agentOnThisRound({
    agent: body.agent === true,
    imageCount: images.length,
    rootPath: body.rootPath
  })
  if (body.agent === true && images.length > 0) {
    sendAgentStep(event, requestId, '这一轮带图片,没有翻文件')
  }
  if (files.length > 0 && fileSan.rejected.length > 0) {
    sendAgentStep(event, requestId, `有文件没带进来:${fileSan.rejected.join(';')}`)
  }
  return {
    ok: true,
    question,
    questionText,
    images,
    files,
    requestId,
    thinking,
    requested,
    agentOn,
    attachment
  }
}
