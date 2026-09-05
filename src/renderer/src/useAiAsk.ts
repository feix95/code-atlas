import { useEffect, useRef, useState } from 'react'
import type { AiExplainResult, AiHistoryMessage } from '@shared/types'
import { friendlyErr } from './errText'

/**
 * AI 问答状态机(纯钩子,不含组件):选中文件/文件夹后绝不自动请求,
 * AI 只在用户点了按钮或挑了问题后才跑。
 * 一轮问答记成一条 turn:请求中 → 完成/失败/取消(→ 重试)。
 * 追问带历史:发起新一轮时,把之前答完的轮次整理成对话历史一起递给主进程,
 * 模型接得住"这个能删吗"这种话茬,不会每次都从零开始失忆。
 * requestId + aiCancel 机制原样保留:每轮请求带随机 id,取消就掐;
 * 旧请求回来发现 id 已换人,直接作废,绝不能盖上新目标的结果。
 */
export type AiTurnState = 'busy' | 'done' | 'unsupported' | 'error' | 'cancelled'

export interface AiTurn {
  key: string
  /** 用户点名的问题;null = 通用「解释这个文件/文件夹」 */
  question: string | null
  state: AiTurnState
  text: string
}

/** 发起函数由调用方注入(文件/文件夹/git 改动各有各的 IPC),钩子只管状态 */
export type AiSendFn = (requestId: string, question: string | null, history: AiHistoryMessage[]) => Promise<AiExplainResult>

export type AiAssistApi = ReturnType<typeof useAiAsk>

/** 历史只留最近几条:本地模型上下文有限,证据每轮都要全量重摆,历史垫底就行 */
const HISTORY_MAX = 5

/** 把答完的轮次整理成对话历史;只有答完的才配进历史(取消/失败的半截话不喂回模型) */
function buildHistory(turns: AiTurn[]): AiHistoryMessage[] {
  const messages: AiHistoryMessage[] = []
  for (const turn of turns) {
    if (turn.state !== 'done') continue
    if (turn.question) messages.push({ role: 'user', content: turn.question })
    messages.push({ role: 'assistant', content: turn.text })
  }
  return messages.slice(-HISTORY_MAX)
}

export function useAiAsk(send: AiSendFn): {
  turns: AiTurn[]
  busy: boolean
  ask: (question?: string | null) => void
  cancel: () => void
} {
  const [turns, setTurns] = useState<AiTurn[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const idRef = useRef('')
  const turnsRef = useRef(turns)
  turnsRef.current = turns

  // 订阅流式增量:只认自己当前请求的 id,边生成边显示;卸载时退订
  useEffect(() => {
    return window.atlas.onAiDelta((payload) => {
      if (!idRef.current || payload.id !== idRef.current) return
      setTurns((prev) => prev.map((t) => (t.state === 'busy' ? { ...t, text: t.text + payload.text } : t)))
    })
  }, [])

  // 卸载(换选中/关详情)把还在生成的掐掉,别占着模型 —— 沿用旧 ExplainCard 的取消语义
  useEffect(() => {
    return () => {
      if (idRef.current) void window.atlas.aiCancel(idRef.current)
    }
  }, [])

  function ask(question?: string | null): void {
    if (busyRef.current) return // 请求中不许重复发起
    const requestId = crypto.randomUUID()
    idRef.current = requestId
    busyRef.current = true
    setBusy(true)
    const key = requestId
    setTurns((prev) => [...prev, { key, question: question ?? null, state: 'busy', text: '' }])
    void (async () => {
      try {
        const res = await send(requestId, question ?? null, buildHistory(turnsRef.current))
        if (idRef.current !== requestId) return // 已取消/已换目标,这份旧账作废
        setTurns((prev) =>
          prev.map((t) =>
            t.key === key
              ? {
                  ...t,
                  state: res.status === 'supported' ? 'done' : res.status === 'unsupported' ? 'unsupported' : 'error',
                  text: res.text
                }
              : t
          )
        )
      } catch (err) {
        if (idRef.current !== requestId) return
        setTurns((prev) => prev.map((t) => (t.key === key ? { ...t, state: 'error', text: friendlyErr(err) } : t)))
      } finally {
        if (idRef.current === requestId) {
          busyRef.current = false
          idRef.current = ''
          setBusy(false)
        }
      }
    })()
  }

  // 点「取消分析」这一刻就知道结果了:当场标记已取消(留着已生成的部分),
  // 主进程的响应回来发现 id 已清,不再覆盖
  function cancel(): void {
    if (!busyRef.current) return
    if (idRef.current) void window.atlas.aiCancel(idRef.current)
    idRef.current = ''
    busyRef.current = false
    setBusy(false)
    setTurns((prev) => prev.map((t) => (t.state === 'busy' ? { ...t, state: 'cancelled' } : t)))
  }

  return { turns, busy, ask, cancel }
}

/** 文件详情的预设问题:点了就问,不用自己组织话 */
export const FILE_PRESETS = ['它是做什么的？', '从哪里开始读？', '修改它会影响什么？', '怎么给它加新功能？']

/** 追问的推荐问题:文件和文件夹通吃的高频行动问题(点了是填进输入框,不是直接发) */
export const CHAT_PRESETS = ['这个能删吗？', '删了会有什么影响？', '这是什么软件留下的？']
