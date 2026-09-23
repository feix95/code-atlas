// ── 三层预测的共享内核(P1-16):概览页和对话页两套钩子曾逐行复刻同一段 ──
// LRU 缓存、竞态闸、请求壳、静默失败 —— 只留这一份;两边各自只管
// 「什么时候点火(放行闸/驻留)」和「塞什么问法」。
import { useEffect, useState } from 'react'
import { parsePredictedQuestions } from '@shared/presetQuestions'

/** 预测结果缓存(内存级,随 app 退出清空):命中秒出,用过挪队尾,超上限丢最老的,不囤积 */
export class PredictionCache {
  private map = new Map<string, string[]>()

  constructor(private readonly max = 40) {}

  get(key: string): string[] | undefined {
    const hit = this.map.get(key)
    if (hit) {
      // LRU 摸一手:用过挪到队尾
      this.map.delete(key)
      this.map.set(key, hit)
    }
    return hit
  }

  set(key: string, questions: string[]): void {
    this.map.delete(key)
    this.map.set(key, questions)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
  }
}

/**
 * AI 预测层(三层预测的第二层):放行闸开着就后台跑一遍 aiExplainFile 出题。
 * 缓存命中立刻回填;要烧模型的预测可带驻留 —— 点得快说明人还在逛,
 * 中途换目标的定时器/请求直接作废,只有最终停下的那个才真出题。
 * 结果带钥匙存:钥匙对不上就自动视为「还没预测」,不用抢跑 setState。
 * 失败/超时/出题不足 2 条一律静默 —— 规则层永远垫底。
 */
export function useAiPredictedQuestions(input: {
  /** 本预测的钥匙(文件/轮次指纹):换了自动作废旧结果 */
  key: string
  /** 放行闸:false 整个第二层下班,一次模型调用都不花 */
  allowed: boolean
  cache: PredictionCache
  /** 点火前的驻留毫秒(0 = 立即) */
  dwellMs?: number
  /** aiExplainFile 的四件行李 */
  rootPath: string
  relPath: string
  languageId: string
  note?: string
  /** 塞给模型的问法原文(只出题不答题的那句) */
  prompt: string
}): string[] | null {
  const { key, allowed, cache, dwellMs = 0, rootPath, relPath, languageId, note, prompt } = input
  const [state, setState] = useState<{ key: string; questions: string[] } | null>(null)

  useEffect(() => {
    if (!allowed) return
    let alive = true
    let activeId = ''
    let dwell: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      // 先让一帧:缓存命中的回填也不跟渲染抢跑(lint 规矩:effect 里不许同步 setState)
      await Promise.resolve()
      const cached = cache.get(key)
      if (cached) {
        if (alive) setState({ key, questions: cached })
        return
      }
      const fire = async () => {
        const requestId = crypto.randomUUID()
        activeId = requestId
        try {
          const res = await window.atlas.aiExplainFile(
            rootPath,
            relPath,
            languageId,
            requestId,
            prompt,
            note
          )
          if (!alive || activeId !== requestId) return
          if (res.status !== 'supported') return
          const questions = parsePredictedQuestions(res.text)
          if (questions.length < 2) return // 模型没出够题,不硬凑
          cache.set(key, questions)
          if (alive) setState({ key, questions })
        } catch {
          // 预测失败不惊动任何人:规则层的问题一直都在
        }
      }
      if (dwellMs > 0) dwell = setTimeout(() => void fire(), dwellMs)
      else void fire()
    })()
    return () => {
      // 卸载/换目标:作废没到点的驻留,掐掉还在路上的预测,别占着模型
      alive = false
      if (dwell) clearTimeout(dwell)
      if (activeId) void window.atlas.aiCancel(activeId)
    }
  }, [key, allowed, cache, dwellMs, rootPath, relPath, languageId, note, prompt])

  return state?.key === key ? state.questions : null
}
