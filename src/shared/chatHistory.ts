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
}

/**
 * 按轮收历史(答旧题修复·刀一):从后往前,把「回答 + 它前面紧邻的提问」配成一对,
 * 只收回答是 done 的完整轮;提问找不到 done 回答(报错/取消/还没答)整轮扔 —— 不管它在中间还是结尾。
 * 重复提问只留最新一对(重试场景:旧轮的半截话不陪跑)。note(程序垫的灰字)不进历史,
 * 也不打断配对 —— 步骤播报本来就夹在问答中间。空文本的提问(纯引用问法)整轮不要。
 */
export function collectHistoryRounds(
  messages: readonly HistorySourceMessage[],
  maxMessages: number = FREE_CHAT_HISTORY_MAX
): AiHistoryMessage[] {
  const rounds: AiHistoryMessage[] = [] // 从新到旧,轮内 [assistant, user](从后往前扫的自然序,reverse 后翻正)
  const seenQuestions = new Set<string>()
  let i = messages.length - 1
  while (i >= 0) {
    const answer = messages[i]
    if (answer.role !== 'assistant' || answer.state !== 'done' || !answer.text?.trim()) {
      i -= 1
      continue
    }
    // 往前找紧邻的提问:中间只许隔着 note,隔了别的回答就算没配对
    let j = i - 1
    while (j >= 0 && messages[j].role === 'note') j -= 1
    const question = j >= 0 ? messages[j] : undefined
    const qText = question?.text?.trim() ?? ''
    if (!question || question.role !== 'user' || question.state !== 'done' || !qText || seenQuestions.has(qText)) {
      i -= 1
      continue
    }
    seenQuestions.add(qText)
    rounds.push({ role: 'assistant', content: answer.text.trim() }, { role: 'user', content: qText })
    i = j - 1
  }
  return rounds.reverse().slice(-maxMessages)
}
