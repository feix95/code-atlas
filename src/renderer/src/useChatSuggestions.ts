// ── 第一百一十二锤:预览对话的推荐问题随对话演进(三层,和概览页一个套路)──
// 第一层(规则):没聊过按文件类别出题、聊过就换追问真言,零延迟;
// 第二层(AI):每答完一轮,后台悄悄拿「最近一轮问答」去预测下一轮该问什么,好了无缝替换;
// 第三层(兜底):AI 没配/超时/出题不足 2 条,规则层永远在。
// 垃圾回收:结果按「文件 + 轮次 + 上一个问题」缓存,LRU 上限 40,不囤积。
import { useEffect, useMemo, useState } from 'react'
import type { ScanFileNode } from '@shared/types'
import { ruleChatSuggestions } from '@shared/chatSuggestions'
import { parsePredictedQuestions } from '@shared/presetQuestions'
import type { ChatMessage } from './useAiChat'

/** 塞进预测问法里的回答摘要上限:预测不值当为它花掉半屏上下文 */
export const ANSWER_DIGEST_MAX = 300

/**
 * 只出题不答题的问法(带上一轮对话):输出短、格式死,小模型也稳。
 * 把最近一问一答摆出来,模型才能顺着对话猜下一步 —— 这是和概览页预测的唯一区别。
 */
export function buildFollowUpPrompt(question: string, answer: string): string {
  return [
    '不要解释这个文件。下面是用户和你最近一轮的对话 ——',
    `用户问:${question}`,
    `你答:${answer}`,
    '',
    '只根据这轮对话,预测用户接下来最可能想问的 3 个问题:每行一个、以数字开头、每个不超过 24 个字。不要回答这些问题,不要解释。'
  ].join('\n')
}

/** 预测结果缓存:同一轮第二次渲染秒出(内存级,随 app 退出清空) */
const cache = new Map<string, string[]>()
const CACHE_MAX = 40

export function useChatSuggestions(input: {
  rootPath: string
  file: ScanFileNode
  messages: ChatMessage[]
  busy: boolean
}): { questions: string[]; source: 'ai' | 'rule' } {
  const { rootPath, file, messages, busy } = input

  // 预测吃这口证据:答完的轮数 + 最近一轮的一问一答
  const turns = messages.filter((m) => m.role === 'assistant' && m.state === 'done' && m.text !== '').length
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.state === 'done' && m.text !== '')
  const lastQuestion = lastUser?.text ?? ''
  const lastAnswer = (lastAssistant?.text ?? '').slice(0, ANSWER_DIGEST_MAX)

  // 第一层:规则预测,换轮次瞬间就有
  const rule = useMemo(
    () =>
      ruleChatSuggestions(turns > 0, {
        name: file.name,
        icon: file.summary?.icon,
        text: file.summary?.text,
        languageId: file.language?.id
      }),
    [turns, file]
  )

  // AI 预测结果带钥匙存:换了轮次钥匙就对不上,自动视为「还没预测」,不用抢跑 setState
  const currentKey = `${rootPath.replace(/[\\/]+/g, '/').toLowerCase()}#${file.relPath}#${turns}#${lastQuestion}`
  const [aiState, setAiState] = useState<{ key: string; questions: string[] } | null>(null)
  const aiQuestions = aiState?.key === currentKey ? aiState.questions : null

  // 第二层:AI 预测,后台跑;没聊过不麻烦模型(规则层按文件出的题就够),
  // 正在回答时也不抢 —— 让模型专心答题,答完再预测下一问
  useEffect(() => {
    if (busy || turns === 0) return
    const key = currentKey
    let alive = true
    let activeId = ''
    void (async () => {
      // 先让一帧:缓存命中的回填也不跟渲染抢跑(lint 规矩:effect 里不许同步 setState)
      await Promise.resolve()
      const cached = cache.get(key)
      if (cached) {
        // LRU 摸一手:用过挪到队尾
        cache.delete(key)
        cache.set(key, cached)
        if (alive) setAiState({ key, questions: cached })
        return
      }
      const requestId = crypto.randomUUID()
      activeId = requestId
      try {
        const res = await window.atlas.aiExplainFile(
          rootPath,
          file.relPath,
          file.language?.id ?? '',
          requestId,
          buildFollowUpPrompt(lastQuestion, lastAnswer)
        )
        if (!alive || activeId !== requestId) return
        if (res.status !== 'supported') return
        const questions = parsePredictedQuestions(res.text)
        if (questions.length < 2) return // 模型没出够题,不硬凑
        cache.delete(key)
        cache.set(key, questions)
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
        if (alive) setAiState({ key, questions })
      } catch {
        // 预测失败不惊动任何人:规则层一直都在
      }
    })()
    return () => {
      // 卸载/换轮次:还在路上的预测掐掉,别占着模型
      alive = false
      if (activeId) void window.atlas.aiCancel(activeId)
    }
    // 依赖带 currentKey:每一轮答完都重跑一次预测
  }, [currentKey, busy, turns, rootPath, file, lastQuestion, lastAnswer])

  return { questions: aiQuestions ?? rule, source: aiQuestions ? 'ai' : 'rule' }
}
