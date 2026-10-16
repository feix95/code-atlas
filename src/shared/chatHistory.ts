/**
 * 自由聊天的历史账本(答旧题修复锤):渲染层和自测共用同一份口径。
 * 病根:以前渲染层按「条」收历史,报错/取消轮的提问一发出就永久是 done、照样入史,
 * 它的回答却被过滤 —— 历史里留下一道「问了从没被答」的悬空旧问题,沉到历史中间;
 * 合并逻辑再把旧问题和下一问粘成一条,小模型看见「连问两件事只有一条回答」,
 * 扭头就去补答旧题。这就是「无视最新问题、回答之前的问题」的精确机制。
 * 治法:历史只收「一问一答都落地了」的完整轮,半截的、报错的、被停的整轮扔掉。
 */
import type { AiHistoryMessage } from './types.ts'
import { TAG } from './promptTags.ts'

/** 历史只带最近几条(单位:消息条数,不是问答对数):本地模型上下文有限。
 *  对账:渲染层发上限 8 条,主进程 sanitizeHistory(ai/index.ts 的 CHAT_HISTORY_MAX)
 *  还会再掐到 6 条兜底 —— 这里多带两条是给主进程的配对收拢留余量,别当成「实际进提示词」的量 */
export const FREE_CHAT_HISTORY_MAX = 8

/** 渲染层实际发给主进程的历史条数上限(单位:消息条数):发得多,让主进程按模型档位自己取舍 ——
 *  小模型档按上下文预算装(ai/chatThread.ts),大模型档仍由 sanitizeHistory 掐到最近 6 条,行为不变 */
export const CHAT_HISTORY_SEND_MAX = 40

/**
 * 当前问题的注意力锚(答旧题修复·刀三,2.0 换成 XML 包裹):历史洗干净后,旧问题都是
 * 干净短句,当前问题后面却粘着联网资料、参考资料指路话 —— 小模型按「长得最像待答问题」
 * 作答就会偏。给当前问题包一对 <current_question> 标签;早前问答都只是历史背景。
 * 主进程 agent 链取问题时用 stripCurrentQuestionAnchor 剥掉这对标签。
 */
export const CURRENT_QUESTION_PREFIX = `${TAG.currentQuestion.open}\n`
export const CURRENT_QUESTION_SUFFIX = `\n${TAG.currentQuestion.close}`

/**
 * 剥掉注意力锚:agent 工具轮的提醒卡要引用干净的问题原文,别把标签一起带上。
 * 闭合标签后面还粘着联网资料、参考资料指路话 —— 那些是垫给模型的上下文,不是问题本体,
 * 一见到闭合标签就收刀。
 */
export function stripCurrentQuestionAnchor(text: string): string {
  let out = text
  if (out.startsWith(CURRENT_QUESTION_PREFIX)) out = out.slice(CURRENT_QUESTION_PREFIX.length)
  const closeIdx = out.indexOf(TAG.currentQuestion.close)
  if (closeIdx >= 0) out = out.slice(0, closeIdx)
  return out.replace(/^\s+/, '').replace(/\s+$/, '')
}

/** 成对收集认的最小形状:渲染层的 ChatMessage 天然满足,自测传裸对象也行 */
export interface HistorySourceMessage {
  role: 'user' | 'assistant' | 'note'
  state?: string
  text?: string
  /** 这轮附带的图片(第一百五十二锤):历史只记「附过几张图」一句话,图片本体不进历史 */
  images?: readonly unknown[]
}

/**
 * 按轮收历史(答旧题修复·刀一):每个提问起一「轮」,到下一个提问之前的内容都归它;
 * 轮里取**最后一个回答气泡**当这轮的答案(翻文件模式中途封板的叙述气泡「我先读一下」
 * 不许顶替最终答案进历史),它必须是 done;答案不是 done(报错/取消/还没答)整轮扔,
 * 悬空的旧问题(后面直接又是提问)同理。从新往旧扫,重复提问只留最新一对
 * (重试场景:旧轮的半截话不陪跑)。note(程序垫的灰字)不进历史,也不打断配对。
 * 空文本的提问(纯引用问法)整轮不要。
 */
export function collectHistoryRounds(
  messages: readonly HistorySourceMessage[],
  maxMessages: number = FREE_CHAT_HISTORY_MAX
): AiHistoryMessage[] {
  const rounds: AiHistoryMessage[] = [] // 从新到旧,轮内 [assistant, user](从后往前扫的自然序,reverse 后翻正)
  const seenQuestions = new Set<string>()
  let roundEnd = messages.length // 当前轮的右边界(不含):下一个提问的位置
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const question = messages[i]
    if (question.role !== 'user') continue
    let answerAt = roundEnd - 1
    while (answerAt > i && messages[answerAt].role !== 'assistant') answerAt -= 1
    const answer = answerAt > i ? messages[answerAt] : undefined
    roundEnd = i
    const qText = question.text?.trim() ?? ''
    // 附过图的那轮在历史里留一句话交代(第一百五十二锤):图片本体是 data URL,
    // 绝不进历史 —— 不然一轮旧图就把小模型的上下文吃干抹净
    const imageCount = question.images?.length ?? 0
    const imageMark =
      imageCount > 0 ? `(这一轮附了 ${imageCount} 张图片,图片本身不在当前上下文里)` : ''
    const qContent = imageMark ? (qText ? `${qText}\n${imageMark}` : imageMark) : qText
    if (
      question.state !== 'done' ||
      !qContent ||
      seenQuestions.has(qContent) ||
      !answer ||
      answer.state !== 'done' ||
      !answer.text?.trim()
    )
      continue
    seenQuestions.add(qContent)
    rounds.push(
      { role: 'assistant', content: answer.text.trim() },
      { role: 'user', content: qContent }
    )
  }
  return rounds.reverse().slice(-maxMessages)
}
