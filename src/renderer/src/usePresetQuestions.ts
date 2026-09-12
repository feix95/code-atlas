// ── 第一百零九锤:预设问题三层预测的钩子 ──
// 第一层(规则):选中瞬间按类别出题,零延迟;第二层(AI):后台悄悄让小模型按文件证据
// 预测更贴合的问题,好了就无缝替换;第三层(兜底):AI 没配/超时/失败,规则层永远在。
// 垃圾回收铁律:预测结果按文件缓存,LRU 上限 40 个,不囤积。
import { useEffect, useMemo, useState } from 'react'
import type { ScanFileNode } from '@shared/types'
import { parsePredictedQuestions, rulePresetQuestions } from '@shared/presetQuestions'

/** 让模型只出题不答题的问法:输出短、格式死,小模型也稳 */
const PREDICT_QUESTION =
  '不要解释这个文件。只根据上面的证据,预测用户最可能想问的 3 个问题:每行一个、以数字开头、每个不超过 24 个字。不要回答这些问题,不要解释。'

/** 预测结果缓存:同文件第二次选中秒出(内存级,随 app 退出清空) */
const cache = new Map<string, string[]>()
const CACHE_MAX = 40

function cacheKey(rootPath: string, relPath: string): string {
  return `${rootPath.replace(/[\\/]+/g, '/').toLowerCase()}#${relPath}`
}

/** AI 出题的驻留门槛(小葵拍的板):点得快 = 还在逛,只给最终停下的文件烧模型 */
const DWELL_MS = 500

export function usePresetQuestions(input: {
  rootPath: string
  file: ScanFileNode
  /** 小葵的备注原话:预测也吃这口证据 */
  note?: string
}): { questions: string[]; source: 'ai' | 'rule' } {
  const { rootPath, file, note } = input
  // 第一层:规则预测,选中瞬间就有
  const rule = useMemo(
    () => rulePresetQuestions({ name: file.name, icon: file.summary?.icon, text: file.summary?.text, languageId: file.language?.id }),
    [file]
  )
  // AI 预测结果带钥匙存:换文件时钥匙对不上就自动视为「还没预测」,不用抢跑 setState
  const [aiState, setAiState] = useState<{ key: string; questions: string[] } | null>(null)
  const currentKey = cacheKey(rootPath, file.relPath)
  const aiQuestions = aiState?.key === currentKey ? aiState.questions : null

  // 第二层:AI 预测,后台跑;失败/超时/没配模型就当无事发生,规则层永远垫底。
  // 垃圾回收铁律 + 省钱(第一百三十六锤补):缓存命中立刻回填;要烧模型的预测先等
  // 500ms 驻留 —— 点得快说明人还在逛,中途换目标的定时器直接作废,只有最终停下的
  // 那个文件才真出题(规则层的问题一直在,等待期界面不空)
  useEffect(() => {
    const key = currentKey
    let alive = true
    let activeId = ''
    let dwell: ReturnType<typeof setTimeout> | undefined
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
      dwell = setTimeout(() => {
        void (async () => {
          const requestId = crypto.randomUUID()
          activeId = requestId
          try {
            const res = await window.atlas.aiExplainFile(
              rootPath,
              file.relPath,
              file.language?.id ?? '',
              requestId,
              PREDICT_QUESTION,
              note
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
            // 预测失败不惊动任何人:规则层的问题一直都在
          }
        })()
      }, DWELL_MS)
    })()
    return () => {
      // 卸载/换文件:作废没到点的驻留,掐掉还在路上的预测,别占着模型
      alive = false
      if (dwell) clearTimeout(dwell)
      if (activeId) void window.atlas.aiCancel(activeId)
    }
    // 依赖带 currentKey:换文件/换项目时重跑预测;rootPath 是出题请求要用的钥匙半边
  }, [currentKey, file, note, rootPath])

  return { questions: aiQuestions ?? rule, source: aiQuestions ? 'ai' : 'rule' }
}
