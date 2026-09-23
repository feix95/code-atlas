// ── 第一百零九锤:预设问题三层预测的钩子 ──
// 第一层(规则):选中瞬间按类别出题,零延迟;第二层(AI):后台悄悄让小模型按文件证据
// 预测更贴合的问题,好了就无缝替换;第三层(兜底):AI 没配/超时/失败,规则层永远在。
// 第二层的缓存/竞态闸/请求壳是 predictedQuestions.ts 的共享内核,这里只管
// 「选中哪个文件 + 500ms 驻留」的业务参数。
import { useMemo } from 'react'
import type { ScanFileNode } from '@shared/types'
import { rulePresetQuestions } from '@shared/presetQuestions'
import { PredictionCache, useAiPredictedQuestions } from './predictedQuestions'

/** 让模型只出题不答题的问法:输出短、格式死,小模型也稳 */
const PREDICT_QUESTION =
  '不要解释这个文件。只根据上面的证据,预测用户最可能想问的 3 个问题:每行一个、以数字开头、每个不超过 24 个字。不要回答这些问题,不要解释。'

/** 预测结果缓存:同文件第二次选中秒出(内存级,随 app 退出清空) */
const cache = new PredictionCache(40)

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
  /** 总闸(设置里的「推荐问题」):关了不出题,连烧模型的 AI 预测也不许跑 */
  enabled: boolean
  allowAi?: boolean
}): { questions: string[]; source: 'ai' | 'rule' } {
  const { rootPath, file, note, enabled, allowAi = false } = input
  // 第一层:规则预测,选中瞬间就有
  const rule = useMemo(
    () =>
      rulePresetQuestions({
        name: file.name,
        icon: file.summary?.icon,
        text: file.summary?.text,
        languageId: file.language?.id
      }),
    [file]
  )
  const currentKey = cacheKey(rootPath, file.relPath)

  // 第二层:AI 预测(共享内核)。总闸关着就整个歇业:题不显示,预测更不许烧模型
  // (拨回开 = 关闸,驻留/请求照样作废);规则层的问题一直在,等待期界面不空
  const aiQuestions = useAiPredictedQuestions({
    key: currentKey,
    allowed: enabled && allowAi,
    cache,
    dwellMs: DWELL_MS,
    rootPath,
    relPath: file.relPath,
    languageId: file.language?.id ?? '',
    note,
    prompt: PREDICT_QUESTION
  })

  // 总闸关着交白卷(界面自然一颗题都不画);开着才按「AI 优先,规则垫底」出牌
  return {
    questions: enabled ? (aiQuestions ?? rule) : [],
    source: enabled && aiQuestions ? 'ai' : 'rule'
  }
}
