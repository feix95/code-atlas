/**
 * /compact 手动压缩命令(第一百四十二锤):把早前的对话提炼成一份要点摘要,
 * 之后的每次请求都带着这份摘要走 —— 旧对话不再被「只带最近几条」的规矩悄悄扔掉,
 * 长聊不断片。纯逻辑都住这里:命令识别、历史清洗、压缩提示词拼装、摘要洗消,
 * 渲染进程(拦命令)、主进程(调模型)、自测三边共用同一份口径。
 */
import type { AiHistoryMessage } from './types.ts'

/** 聊天输入框认的压缩命令(小葵拍的板:只认英文这一个写法,大小写不拘) */
export const COMPACT_COMMAND = '/compact'

/** 输入框里这句话是不是「压缩」命令:整句就是 /compact 才算,后面跟了字的不算 */
export function isCompactCommand(text: string): boolean {
  return text.trim().toLowerCase() === COMPACT_COMMAND
}

/** 摘要的自报家门:历史里认这个前缀,知道这条是压缩出来的摘要(再压时融进新摘要) */
export const COMPACT_SUMMARY_TAG = '【早前对话的摘要(程序压缩生成)】'

/** 压缩员的专属人设:只记聊过的内容,不寒暄不编造 */
export const COMPACT_SYSTEM_PROMPT = `你是 Code Atlas 的「对话压缩员」。
你会收到一段此前的对话记录(用户和探针的话)。请把它提炼成一份要点摘要,供后续对话当背景记忆使用。
要求:
1. 只记对话里真正聊过的内容:聊到的结论、决定、提过的文件/数值/事实,按主题归成几条短句。
2. 不寒暄、不评论、不补编对话里没有的内容。
3. 用中文,总长不超过 15 行。`

/** 压缩请求的收尾指令(单独一条 user 消息,垫在对话记录后面) */
export const COMPACT_INSTRUCTION = '请把上面的对话提炼成要点摘要。'

/** 压缩请求最多带多少条对话记录:再多更早的就不进了,反正它们正是要被摘掉的部分 */
export const COMPACT_HISTORY_MAX_MESSAGES = 40

/** 压缩请求里单条对话的字数上限:超长的话只留前一半就够提炼要点了 */
export const COMPACT_HISTORY_MSG_CHARS = 1500

/** 摘要本体的字数上限:旧摘要融进新摘要时按这个上限放行,别把上一代的成果截没了 */
export const COMPACT_SUMMARY_CHARS = 4000

/**
 * 渲染进程传来的压缩史料先洗干净:只收 user/assistant 两条腿,单条长度封顶,
 * 总条数取最近的 COMPACT_HISTORY_MAX_MESSAGES 条。摘要打头的条目(旧摘要)按更大的
 * 上限放行 —— 它本来就是提炼过的,再压时应该完整地融进新摘要。
 */
export function sanitizeCompactHistory(history: unknown): AiHistoryMessage[] {
  if (!Array.isArray(history)) return []
  const cleaned: AiHistoryMessage[] = []
  for (const item of history) {
    if (typeof item !== 'object' || item === null) continue
    const { role, content } = item as { role?: unknown; content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    const text = content.trim()
    if (!text) continue
    const cap = text.startsWith(COMPACT_SUMMARY_TAG) ? COMPACT_SUMMARY_CHARS : COMPACT_HISTORY_MSG_CHARS
    cleaned.push({ role, content: text.length > cap ? `${text.slice(0, cap)}……(后半截省略)` : text })
  }
  return cleaned.slice(-COMPACT_HISTORY_MAX_MESSAGES)
}

/** 拼压缩请求的消息序列:压缩员人设 + 洗干净的对话记录 + 收尾指令 */
export function buildCompactMessages(history: AiHistoryMessage[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system', content: COMPACT_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: COMPACT_INSTRUCTION }
  ]
}

/** 渲染进程传来的旧摘要先洗干净:形状不对回空串,超长截断(截断的话说明真太长了) */
export function sanitizeCompactSummary(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const text = raw.trim()
  if (!text) return ''
  return text.length > COMPACT_SUMMARY_CHARS ? `${text.slice(0, COMPACT_SUMMARY_CHARS)}……(摘要过长,只取前一部分)` : text
}

/**
 * 摘要拼成每次请求都带的背景块:和资料附件同一个防御口径 —— 写明它是程序压缩生成的
 * 背景记忆,不是用户指令;模型照着它续上下文,但不许把摘要原文复读一遍当回答。
 */
export function buildSummaryText(summary: string): string {
  return [
    '<earlier_chat_summary>',
    `${COMPACT_SUMMARY_TAG}`,
    '下面是本会话早前对话的要点摘要,程序压缩生成。回答时把它当背景记忆,不要把摘要原文复读一遍。',
    '',
    summary,
    '</earlier_chat_summary>'
  ].join('\n')
}
