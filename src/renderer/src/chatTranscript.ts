// 自由对话的史料整理:发请求带哪些轮、压缩时交哪些账、摘要卡怎么找。
// 纯函数,发得宽(CHAT_HISTORY_SEND_MAX),取舍交给主进程按模型档位定。
import type { AiChatRequest, AiHistoryMessage, ChatMessage } from '@shared/types'
import { TAG } from '@shared/promptTags'
import { collectHistoryRounds, CHAT_HISTORY_SEND_MAX } from '@shared/chatHistory'

/** /compact 压缩完保留最近几条原文:摘要垫底 + 这几条原文,衔接不断片 */
export const COMPACT_KEEP_RECENT = 4

/** 找最新一张摘要卡(从后往前找):压缩过就有,每次发请求都当背景记忆带上 */
export function findSummary(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m.role === 'note' && m.kind === 'summary' && m.state === 'done' && m.text.trim() !== '')
      return m.text
  }
  return null
}

/**
 * /compact 的压缩史料:全量的对话记录,不受 HISTORY_MAX 限制 ——
 * 正是要把「将被扔掉的老对话」交给模型提炼;旧摘要卡转写成打标签的一条,再压时融进新摘要。
 */
export function buildCompactHistory(messages: ChatMessage[]): AiHistoryMessage[] {
  const out: AiHistoryMessage[] = []
  for (const m of messages) {
    if (m.role === 'note') {
      if (m.kind === 'summary' && m.state === 'done' && m.text.trim() !== '') {
        out.push({
          role: 'user',
          content: `${TAG.compressedSummary.open}\n旧摘要,一并融进新摘要:\n${m.text}\n${TAG.compressedSummary.close}`
        })
      }
      continue
    }
    if (m.state !== 'done' || m.text.trim() === '') continue
    out.push({ role: m.role, content: m.text })
  }
  return out
}

/** 历史按「轮」成对收集:只收一问一答都落地的完整轮,报错/取消/半截的整轮扔 */
export function buildHistory(messages: ChatMessage[]): AiChatRequest['history'] {
  return collectHistoryRounds(messages, CHAT_HISTORY_SEND_MAX)
}
