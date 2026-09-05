import { useEffect, useRef, useState } from 'react'
import type { AiChatRequest, ChatContextAttachment, WebLookupMeta } from '@shared/types'
import { friendlyErr } from './errText'

/**
 * 自由对话状态机(纯钩子,不含组件):和文件解释的 useAiAsk 完全分家,
 * 各走各的通道、各记各的账 —— 解释是证据优先的单问单答,这边是带历史的真聊天。
 * 消息只有用户和探针两种;资料附件每次发请求单独带上,绝不混进消息列表,
 * 这样换文件时旧资料自动消失,旧对话也不污染新对象。
 * 探针的联网账本(web)以主进程回传为准:边查边收实时播报,收尾以结果里的账本为准。
 */
export type ChatMsgState = 'busy' | 'done' | 'error' | 'cancelled'

export interface ChatMessage {
  key: string
  role: 'user' | 'assistant'
  text: string
  state: ChatMsgState
  /** 助手消息才挂的联网账本;还没收到任何账本时为 null(界面就不挂标签) */
  web: WebLookupMeta | null
}

/** 历史只带最近几条:本地模型上下文有限,主进程还会再洗一遍兜底 */
const HISTORY_MAX = 8

/** 把答完的轮次整理成对话历史;半截话(取消/失败)不喂回模型 */
function buildHistory(messages: ChatMessage[]): AiChatRequest['history'] {
  const out: AiChatRequest['history'] = []
  for (const m of messages) {
    if (m.state !== 'done' || !m.text) continue
    out.push({ role: m.role, content: m.text })
  }
  return out.slice(-HISTORY_MAX)
}

export function useAiChat(context: ChatContextAttachment | null): {
  messages: ChatMessage[]
  busy: boolean
  send: (question: string) => void
  cancel: () => void
} {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const idRef = useRef('')
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  // 附件的活户口径:发请求时取当下渲染的这份,用户切换选中对象后自动带新的
  const contextRef = useRef(context)
  contextRef.current = context

  // 流式增量:只认当前请求的 id,边生成边往 busy 的探针消息上糊
  useEffect(
    () =>
      window.atlas.onAiDelta((payload) => {
        if (!idRef.current || payload.id !== idRef.current) return
        setMessages((prev) =>
          prev.map((m) => (m.role === 'assistant' && m.state === 'busy' ? { ...m, text: m.text + payload.text } : m))
        )
      }),
    []
  )

  // 联网状态实时播报:查着/没查着都是程序说了算,收到就先挂在 busy 消息上
  // (最终以请求结果里带的账本为准,这边只是让"正在联网查询…"立刻冒出来)
  useEffect(
    () =>
      window.atlas.onChatLookup((payload) => {
        if (!idRef.current || payload.id !== idRef.current) return
        setMessages((prev) =>
          prev.map((m) =>
            m.role === 'assistant' && m.state === 'busy'
              ? {
                  ...m,
                  web: {
                    requested: true,
                    enabled: true,
                    attempted: payload.state !== 'searching',
                    state: payload.state,
                    sources: payload.sources
                  }
                }
              : m
          )
        )
      }),
    []
  )

  // 卸载(换选中/关详情=换 session)把还在生成的掐掉,别占着模型
  useEffect(() => {
    return () => {
      if (idRef.current) void window.atlas.aiCancel(idRef.current)
    }
  }, [])

  function send(question: string): void {
    const q = question.trim()
    if (!q || busyRef.current) return
    const requestId = crypto.randomUUID()
    idRef.current = requestId
    busyRef.current = true
    setBusy(true)
    const botKey = requestId
    setMessages((prev) => [
      ...prev,
      { key: `${requestId}-u`, role: 'user', text: q, state: 'done', web: null },
      { key: botKey, role: 'assistant', text: '', state: 'busy', web: null }
    ])
    void (async () => {
      try {
        // 历史取发送前的消息(不含本轮),当前问题单独走 question 字段
        const req: AiChatRequest = {
          requestId,
          question: q,
          history: buildHistory(messagesRef.current),
          context: contextRef.current
        }
        const res = await window.atlas.aiChat(req)
        if (idRef.current !== requestId) return // 已取消/已换目标,这份旧账作废
        setMessages((prev) =>
          prev.map((m) =>
            m.key === botKey
              ? {
                  ...m,
                  state: res.status === 'supported' || res.status === 'unsupported' ? 'done' : res.status === 'cancelled' ? 'cancelled' : 'error',
                  text: res.text || m.text,
                  web: res.webLookup
                }
              : m
          )
        )
      } catch (err) {
        if (idRef.current !== requestId) return
        setMessages((prev) => prev.map((m) => (m.key === botKey ? { ...m, state: 'error', text: friendlyErr(err) } : m)))
      } finally {
        if (idRef.current === requestId) {
          busyRef.current = false
          idRef.current = ''
          setBusy(false)
        }
      }
    })()
  }

  // 点「停一停」当场标记取消(留着已生成的半截话),主进程的响应回来发现 id 已清,不再覆盖
  function cancel(): void {
    if (!busyRef.current) return
    if (idRef.current) void window.atlas.aiCancel(idRef.current)
    idRef.current = ''
    busyRef.current = false
    setBusy(false)
    setMessages((prev) => prev.map((m) => (m.state === 'busy' ? { ...m, state: 'cancelled' } : m)))
  }

  return { messages, busy, send, cancel }
}

export type AiChatApi = ReturnType<typeof useAiChat>
