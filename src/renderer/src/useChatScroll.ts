// 对话消息区的滚动账:粘底跟滚、上翻不抢滚动条、面板重挂按对话指纹回原位。
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from './useAiChat'

/**
 * 聊天面板的滚动记忆(按对话指纹记名):点聊天里的绿字跳预览时,聊天面板会从另一个
 * 条件分支整个重挂,粘底开关一重置,面板就被压到最底,用户正看着的那条直接滚出视野。
 * 按「首尾消息指纹」记一份滚动位置:同一场对话重挂就回到原地;真新对话才对不上、滚到最新。
 */
interface ChatScrollMemory {
  fingerprint: string
  top: number
  atBottom: boolean
}
let chatScrollMemory: ChatScrollMemory | null = null

function messagesFingerprint(messages: ChatMessage[]): string {
  const first = messages[0]?.key ?? ''
  const last = messages[messages.length - 1]?.key ?? ''
  return `${messages.length}:${first}:${last}`
}

export function useChatScroll(
  messages: ChatMessage[],
  chatZoom: number
): {
  scrollRef: React.RefObject<HTMLDivElement | null>
  showJump: boolean
  onMessagesScroll: () => void
  jumpToLatest: () => void
  forceBottom: () => void
} {
  // 粘底跟滚:消息区自己滚;贴着底部看就跟滚,上翻过就不抢滚动条,浮出箭头报个位。
  // 箭头浮出时轻弹一次报信;流式期间保持安静 —— 逐段重放弹跳动画会变成高频闪动
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  function onMessagesScroll(): void {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    atBottomRef.current = nearBottom
    setShowJump(!nearBottom)
    chatScrollMemory = {
      fingerprint: messagesFingerprint(messages),
      top: el.scrollTop,
      atBottom: nearBottom
    }
  }

  function jumpToLatest(): void {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = true
    setShowJump(false)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }

  /** 自己发消息 = 强制回底部:自己的话自己得看见,发出去这一眼不被上翻状态挡住 */
  function forceBottom(): void {
    atBottomRef.current = true
    setShowJump(false)
  }

  // 流式增量每补一段,消息数组就换一次新引用;粘着底部就压到底,不在底就什么都不做。
  // 面板挂载后的第一轮是「认门」:同一场对话从别的分支重挂过来(点绿字跳预览最常见),
  // 按滚动记忆回到用户刚才的位置;真新对话(指纹对不上)才滚到最新
  const restoredRef = useRef(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!restoredRef.current) {
      restoredRef.current = true
      const fp = messagesFingerprint(messages)
      const saved = chatScrollMemory?.fingerprint === fp ? chatScrollMemory : null
      atBottomRef.current = saved ? saved.atBottom : true
      // 位置一设,scroll 事件会自己来报信,贴底箭头交给 onMessagesScroll 接管
      el.scrollTop = saved && !saved.atBottom ? saved.top : el.scrollHeight
      chatScrollMemory = { fingerprint: fp, top: el.scrollTop, atBottom: atBottomRef.current }
      return
    }
    if (atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // 换档后原本贴着底部就继续贴底:字号放大把行程拉长,scrollTop 留在原处会看着「浮上去」
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [chatZoom])

  return { scrollRef, showJump, onMessagesScroll, jumpToLatest, forceBottom }
}
