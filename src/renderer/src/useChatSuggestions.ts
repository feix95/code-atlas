// ── 第一百一十二锤:预览对话的推荐问题随对话演进(三层,和概览页一个套路)──
// 第一层(规则):没聊过按文件类别出题、聊过就换追问真言,零延迟;
// 第二层(AI):每答完一轮,后台悄悄拿「最近一轮问答」去预测下一轮该问什么,好了无缝替换;
// 第三层(兜底):AI 没配/超时/出题不足 2 条,规则层永远在。
// 第二层的缓存/竞态闸/请求壳是 predictedQuestions.ts 的共享内核,这里只管
// 「按轮次点火、不驻留」和「带上一轮问答的问法」。
import { useMemo } from 'react'
import type { ScanFileNode } from '@shared/types'
import { ruleChatSuggestions } from '@shared/chatSuggestions'
import { PredictionCache, useAiPredictedQuestions } from './predictedQuestions'
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
const cache = new PredictionCache(40)

export function useChatSuggestions(input: {
  rootPath: string
  file: ScanFileNode
  messages: ChatMessage[]
  busy: boolean
  /** 总闸(聊天偏好开关):关掉时规则题不出、AI 预测不跑,一律空手而回 */
  enabled: boolean
}): { questions: string[]; source: 'ai' | 'rule' } {
  const { rootPath, file, messages, busy, enabled } = input

  // 预测吃这口证据:答完的轮数 + 最近一轮的一问一答
  const turns = messages.filter((m) => m.role === 'assistant' && m.state === 'done' && m.text !== '').length
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.state === 'done' && m.text !== '')
  const lastQuestion = lastUser?.text ?? ''
  const lastAnswer = (lastAssistant?.text ?? '').slice(0, ANSWER_DIGEST_MAX)

  // 第一层:规则预测,换轮次瞬间就有;总闸关了就一道题都不出
  const rule = useMemo(
    () =>
      enabled
        ? ruleChatSuggestions(turns > 0, {
            name: file.name,
            icon: file.summary?.icon,
            text: file.summary?.text,
            languageId: file.language?.id
          })
        : [],
    [enabled, turns, file]
  )

  const currentKey = `${rootPath.replace(/[\\/]+/g, '/').toLowerCase()}#${file.relPath}#${turns}#${lastQuestion}`

  // 第二层:AI 预测(共享内核)。没聊过不麻烦模型(规则层按文件出的题就够),
  // 正在回答时也不抢 —— 让模型专心答题,答完再预测下一问;
  // 总闸关了整个第二层直接下班,一次模型调用都不花
  const aiQuestions = useAiPredictedQuestions({
    key: currentKey,
    allowed: enabled && !busy && turns > 0,
    cache,
    rootPath,
    relPath: file.relPath,
    languageId: file.language?.id ?? '',
    prompt: buildFollowUpPrompt(lastQuestion, lastAnswer)
  })

  return { questions: aiQuestions ?? rule, source: aiQuestions ? 'ai' : 'rule' }
}
