// 会话记忆库(只在内存,不落盘:符合「不写入无意义缓存」的契约):
// 按会话编号记每轮的完整工具往来,供下一轮请求对账加料(见 chatThread.ts)。
// 数量双封顶:会话数按最久没用的先忘,单会话只记最近几轮。
import { SMALL_TIER_MEMORY } from '../shared/aiTier.ts'
import type { TurnRecord } from './chatThread.ts'

export interface ChatSessionStore {
  turns: (conversationId: string) => readonly TurnRecord[]
  record: (conversationId: string, turn: TurnRecord) => void
  clear: (conversationId: string) => void
}

/** 会话编号洗成干净字符串:形状不对/超长一律当「没编号」(回空串,不记也不查) */
export function sanitizeConversationId(raw: unknown): string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 64 ? raw : ''
}

export function createChatSessionStore(
  limits: { sessionsMax: number; turnsPerSessionMax: number } = SMALL_TIER_MEMORY
): ChatSessionStore {
  const sessions = new Map<string, TurnRecord[]>()
  return {
    turns: (conversationId) => sessions.get(conversationId) ?? [],
    record: (conversationId, turn) => {
      if (conversationId === '') return
      const turns = [...(sessions.get(conversationId) ?? []), turn].slice(
        -limits.turnsPerSessionMax
      )
      sessions.delete(conversationId) // 删了重插 = 挪到「最近用过」的队尾
      sessions.set(conversationId, turns)
      while (sessions.size > limits.sessionsMax) {
        const oldest = sessions.keys().next().value
        if (oldest === undefined) break
        sessions.delete(oldest)
      }
    },
    clear: (conversationId) => void sessions.delete(conversationId)
  }
}
