import { useEffect, useRef, useState } from 'react'
import type { AiChatRequest, ChatCodeRef, ChatContextAttachment, ChatMessage } from '@shared/types'
import type { ChatImage } from '@shared/chatImage'
import type { ChatFileAttachment } from '@shared/chatFiles'
import { readFlagPref, writeFlagPref } from '@shared/localPrefs'
import { friendlyErr } from './errText'
import { applyChatDelta } from './chatStream'
import {
  buildCompactHistory,
  buildHistory,
  COMPACT_KEEP_RECENT,
  findSummary
} from './chatTranscript'

// ChatMessage/ChatMsgState 登记在 shared/types.ts —— 转一手,老朋友照旧从这里进
export type { ChatMessage, ChatMsgState } from '@shared/types'

/**
 * 自由对话状态机(纯钩子,不含组件):和文件解释的 useAiAsk 完全分家,
 * 各走各的通道、各记各的账 —— 解释是证据优先的单问单答,这边是带历史的真聊天。
 * 消息只有用户和探针两种;资料附件每次发请求单独带上,绝不混进消息列表,
 * 这样换文件时旧资料自动消失,旧对话也不污染新对象。
 * 探针的联网状态表(web)以主进程回传为准:边查边收实时播报,收尾以结果里的状态表为准。
 */

/** 只引了代码没写字时替他说一句(主进程也有同一句兜底) */
export const REF_ONLY_QUESTION = '讲讲选中的这段代码'

/** 思考开关存档的 localStorage 键(第一百一十五批)。
 *  键名是横杠系:全仓别的键走 'atlas.*' 点号系,这俩是早期定的老键,
 *  改名会弄丢已存档的开关状态 —— 命名风格不统一是已知差异,为存档兼容刻意保留(P2-4 补注) */
const THINKING_KEY = 'atlas-freechat-thinking'

/** 翻文件(agent)开关的 localStorage 键(第一百二十八批)。命名同上,刻意保留 */
const AGENT_KEY = 'atlas-freechat-agent'

/** 历史按「轮」成对收集的口径住在 chatTranscript(渲染层与自测共用同一份) */

export function useAiChat(
  context: ChatContextAttachment | null,
  /** 翻文件模式(agent)的项目根:沙盒的墙,工具只许在这目录里看;没开项目传 null */
  rootPath: string | null
): {
  messages: ChatMessage[]
  busy: boolean
  /** 思考模式开关(第一百一十五批):开着 = 允许模型先想一遍,思考过程折叠展示 */
  thinking: boolean
  setThinking: (on: boolean) => void
  /** 翻文件模式开关(第一百二十八批):开着 = 允许小探针自己列名单/读文件(只读) */
  agent: boolean
  setAgent: (on: boolean) => void
  /** 程序垫一条灰字(第一百二十四批):如「探针正答着话」,不进历史、不发给模型 */
  note: (text: string) => void
  /** 开新对话(第一百二十七批):清空消息从头聊;探针忙着回答就先掐掉。记录只在内存,清了就是真没了 */
  newChat: () => void
  /** /compact 手动压缩(第一百四十二批):把目前为止的对话提炼成摘要卡,之后的请求都带着它走 */
  compact: () => void
  /**
   * 发送:refs = 引用的代码段;images = 这轮带的图片(第一百五十二批);files = 这轮带的文件附件
   * (文件附件批次,对齐 Claude Code 的 @文件);允许只发图/只发文件不发字
   */
  send: (
    question: string,
    refs?: ChatCodeRef[],
    images?: ChatImage[],
    files?: ChatFileAttachment[]
  ) => void
  cancel: () => void
} {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [])
  const [busy, setBusy] = useState(false)
  // 思考开关记在本地:换文件、重启应用都记住用户的选择
  const [thinking, setThinkingState] = useState(() => readFlagPref(THINKING_KEY, true))
  const thinkingRef = useRef(thinking)
  thinkingRef.current = thinking
  // 翻文件开关同样记在本地;默认关 —— 让模型自己动手是能力升级,但由用户点名才开。
  const [agent, setAgentState] = useState(() => readFlagPref(AGENT_KEY, false))
  const agentRef = useRef(agent)
  agentRef.current = agent
  const busyRef = useRef(false)
  const idRef = useRef('')
  // 会话编号:一场对话一个,「新对话」换新;主进程凭它记住每轮翻文件的完整往来
  const conversationIdRef = useRef(crypto.randomUUID())
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  // 附件的活登记径:发请求时取当下渲染的这份,用户切换选中对象后自动带新的
  const contextRef = useRef(context)
  contextRef.current = context

  // 流式增量:只认当前请求的 id,边生成边往 busy 的探针消息上糊
  // (reset/seal/step/matches/正文的归账规矩住在 chatStream)
  useEffect(
    () =>
      window.atlas.onAiDelta((payload) => {
        if (!idRef.current || payload.id !== idRef.current) return
        setMessages((prev) => applyChatDelta(prev, payload))
      }),
    []
  )

  // 联网状态实时播报:查着/没查着都是程序说了算,收到就先挂在 busy 消息上
  // (最终以请求结果里带的状态表为准,这边只是让"正在联网查询…"立刻冒出来)
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

  function send(
    question: string,
    refs?: ChatCodeRef[],
    images?: ChatImage[],
    files?: ChatFileAttachment[]
  ): void {
    const q = question.trim()
    // 带引用/文件允许「只发资料不发问题」,带图也一样:图和文件本身就是问题,主进程会给兜底问法
    const useRefs = refs && refs.length > 0 ? refs : undefined
    const useImages = images && images.length > 0 ? images : undefined
    const useFiles = files && files.length > 0 ? files : undefined
    if ((!q && !useRefs && !useImages && !useFiles) || busyRef.current) return
    const requestId = crypto.randomUUID()
    idRef.current = requestId
    busyRef.current = true
    setBusy(true)
    const botKey = requestId
    setMessages((prev) => [
      ...prev,
      {
        key: `${requestId}-u`,
        role: 'user',
        text: q,
        state: 'done',
        web: null,
        refs: useRefs,
        files: useFiles,
        images: useImages
      },
      { key: botKey, role: 'assistant', text: '', state: 'busy', web: null }
    ])
    void (async () => {
      try {
        // 历史取发送前的消息(不含本轮),当前问题单独走 question 字段;
        // 压缩过的摘要卡不进历史,单独走 summary 字段当背景记忆(第一百四十二批);
        const summary = findSummary(messagesRef.current)
        const agentOn = agentRef.current
        const req: AiChatRequest = {
          requestId,
          question: q,
          history: buildHistory(messagesRef.current),
          conversationId: conversationIdRef.current,
          context: contextRef.current,
          codeRefs: useRefs,
          files: useFiles,
          images: useImages,
          thinking: thinkingRef.current,
          agent: agentOn || undefined,
          rootPath: rootPath ?? undefined,
          summary: summary ?? undefined
        }
        const res = await window.atlas.aiChat(req)
        if (idRef.current !== requestId) return // 已取消/已换目标,这份旧账作废
        setMessages((prev) =>
          prev.map((m) =>
            m.key === botKey
              ? {
                  ...m,
                  state:
                    res.status === 'supported' || res.status === 'unsupported'
                      ? 'done'
                      : res.status === 'cancelled'
                        ? 'cancelled'
                        : 'error',
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
        setMessages((prev) =>
          prev.map((m) => (m.key === botKey ? { ...m, state: 'error', text: friendlyErr(err) } : m))
        )
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

  /**
   * /compact 手动压缩(第一百四十二批):输入框拦下命令后走这条。
   * 生成中显示成一个正在回答的气泡(流式增量照糊上去),成功后气泡当场变身摘要卡 ——
   * 旧对话(含上一代摘要)全数交给模型提炼,只留最近几条原文,之后的请求靠 summary 字段
   * 把摘要带给模型。没聊过东西就不劳烦模型,垫一句灰字了事。
   */
  function compact(): void {
    if (busyRef.current) return
    const history = buildCompactHistory(messagesRef.current)
    if (history.length === 0) {
      note('还没聊什么,没东西可压:先聊几句再来 /compact')
      return
    }
    const requestId = crypto.randomUUID()
    idRef.current = requestId
    busyRef.current = true
    setBusy(true)
    const botKey = requestId
    setMessages((prev) => [
      ...prev,
      { key: botKey, role: 'assistant', text: '', state: 'busy', web: null }
    ])
    void (async () => {
      try {
        const res = await window.atlas.aiCompact({ requestId, history })
        if (idRef.current !== requestId) return // 已取消/已换目标,这份旧账作废
        if (res.status === 'supported' && res.text.trim() !== '') {
          setMessages((prev) => {
            const card: ChatMessage = {
              key: `${requestId}-summary`,
              role: 'note',
              kind: 'summary',
              text: res.text.trim(),
              state: 'done',
              web: null
            }
            // 旧对话让位:只留最近几条做好的原文(摘要里已包含更早的),旧摘要卡一并退休
            const kept = prev.filter(
              (m) =>
                m.role !== 'note' && m.state === 'done' && m.text.trim() !== '' && m.key !== botKey
            )
            return [card, ...kept.slice(-COMPACT_KEEP_RECENT)]
          })
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.key === botKey
                ? {
                    ...m,
                    state: res.status === 'cancelled' ? 'cancelled' : 'error',
                    text: res.text || m.text
                  }
                : m
            )
          )
        }
      } catch (err) {
        if (idRef.current !== requestId) return
        setMessages((prev) =>
          prev.map((m) => (m.key === botKey ? { ...m, state: 'error', text: friendlyErr(err) } : m))
        )
      } finally {
        if (idRef.current === requestId) {
          busyRef.current = false
          idRef.current = ''
          setBusy(false)
        }
      }
    })()
  }

  function setThinking(on: boolean): void {
    setThinkingState(on)
    writeFlagPref(THINKING_KEY, on)
  }

  function setAgent(on: boolean): void {
    setAgentState(on)
    writeFlagPref(AGENT_KEY, on)
  }

  function note(text: string): void {
    setMessages((prev) => [
      ...prev,
      { key: crypto.randomUUID(), role: 'note', text, state: 'done', web: null }
    ])
  }

  function newChat(): void {
    // 探针还在答就先掐话头,别让旧对话的残响落进新状态表
    if (idRef.current) void window.atlas.aiCancel(idRef.current)
    idRef.current = ''
    busyRef.current = false
    conversationIdRef.current = crypto.randomUUID()
    setBusy(false)
    setMessages([])
  }

  return {
    messages,
    busy,
    thinking,
    setThinking,
    agent,
    setAgent,
    note,
    newChat,
    compact,
    send,
    cancel
  }
}

export type AiChatApi = ReturnType<typeof useAiChat>
