import { useEffect, useRef, useState } from 'react'
import type { AiStreamStats, AiUsage, AiChatRequest, ChatCodeRef, ChatContextAttachment, WebLookupMeta } from '@shared/types'
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
  /** note = 程序垫的灰字条(如「参考资料换成了 xxx」),不发模型、不进历史 */
  role: 'user' | 'assistant' | 'note'
  text: string
  state: ChatMsgState
  /** 模型的思考过程(第一百一十五锤):思考型模型才有的字,界面折叠展示 */
  reasoning?: string
  /** 助手消息才挂的联网账本;还没收到任何账本时为 null(界面就不挂标签) */
  /** 本次问答收尾的 token 账(第八十四锤):引擎肯报才有 */
  /** 流式过程中的实时账(第八十四锤) */
  stats?: AiStreamStats
  usage?: AiUsage
  web: WebLookupMeta | null
  /** 发这条消息时带的引用代码(第一百一十一锤):重试要原样带上,不然重答的题就换了 */
  refs?: ChatCodeRef[]
}

/** 历史只带最近几条:本地模型上下文有限,主进程还会再洗一遍兜底 */
const HISTORY_MAX = 8

/** 思考开关存档的 localStorage 键(第一百一十五锤) */
const THINKING_KEY = 'atlas-freechat-thinking'

/** 把答完的轮次整理成对话历史;半截话(取消/失败)不喂回模型;程序垫的灰字条(note)也不喂 */
function buildHistory(messages: ChatMessage[]): AiChatRequest['history'] {
  const out: AiChatRequest['history'] = []
  for (const m of messages) {
    if (m.role === 'note' || m.state !== 'done' || !m.text) continue
    out.push({ role: m.role, content: m.text })
  }
  return out.slice(-HISTORY_MAX)
}

export function useAiChat(context: ChatContextAttachment | null): {
  messages: ChatMessage[]
  busy: boolean
  /** 思考模式开关(第一百一十五锤):开着 = 允许模型先想一遍,思考过程折叠展示 */
  thinking: boolean
  setThinking: (on: boolean) => void
  /** 程序垫一条灰字(第一百二十四锤):如「参考资料换成了 xxx」,不进历史、不发给模型 */
  note: (text: string) => void
  /** 开新对话(第一百二十七锤):清空消息从头聊;探针忙着回答就先掐掉。记录只在内存,清了就是真没了 */
  newChat: () => void
  send: (question: string, refs?: ChatCodeRef[]) => void
  cancel: () => void
} {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  // 思考开关记在本地:换文件、重启应用都记住用户的选择
  const [thinking, setThinkingState] = useState(() => localStorage.getItem(THINKING_KEY) !== 'off')
  const thinkingRef = useRef(thinking)
  thinkingRef.current = thinking
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
          prev.map((m) =>
            m.role === 'assistant' && m.state === 'busy'
              ? {
                  ...m,
                  text: m.text + payload.text,
                  reasoning: payload.reasoning ? (m.reasoning ?? '') + payload.reasoning : m.reasoning,
                  stats: payload.stats ?? m.stats
                }
              : m
          )
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

  function send(question: string, refs?: ChatCodeRef[]): void {
    const q = question.trim()
    // 带引用的允许「只发代码不发问题」:主进程会给一句兜底问法(光甩代码过去没题目,说不清要讲哪面)
    const useRefs = refs && refs.length > 0 ? refs : undefined
    if ((!q && !useRefs) || busyRef.current) return
    const requestId = crypto.randomUUID()
    idRef.current = requestId
    busyRef.current = true
    setBusy(true)
    const botKey = requestId
    setMessages((prev) => [
      ...prev,
      { key: `${requestId}-u`, role: 'user', text: q, state: 'done', web: null, refs: useRefs },
      { key: botKey, role: 'assistant', text: '', state: 'busy', web: null }
    ])
    void (async () => {
      try {
        // 历史取发送前的消息(不含本轮),当前问题单独走 question 字段
        const req: AiChatRequest = {
          requestId,
          question: q,
          history: buildHistory(messagesRef.current),
          context: contextRef.current,
          codeRefs: useRefs,
          thinking: thinkingRef.current
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
                  reasoning: res.reasoning || m.reasoning,
                  web: res.webLookup,
                  usage: res.usage,
                  stats: undefined
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

  function setThinking(on: boolean): void {
    setThinkingState(on)
    localStorage.setItem(THINKING_KEY, on ? 'on' : 'off')
  }

  function note(text: string): void {
    setMessages((prev) => [...prev, { key: crypto.randomUUID(), role: 'note', text, state: 'done', web: null }])
  }

  function newChat(): void {
    // 探针还在答就先掐话头,别让旧对话的残响落进新账本
    if (idRef.current) void window.atlas.aiCancel(idRef.current)
    idRef.current = ''
    busyRef.current = false
    setBusy(false)
    setMessages([])
  }

  return { messages, busy, thinking, setThinking, note, newChat, send, cancel }
}

export type AiChatApi = ReturnType<typeof useAiChat>
