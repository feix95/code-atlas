// 上下文档位 + 黑板账单:档位走 2 的幂,最大档照模型出厂上限封顶;账单跟着框里的数实时算。
import { useCallback, useMemo, useState } from 'react'
import {
  CONTEXT_NOTCHES,
  FALLBACK_CONTEXT_CAP,
  formatContextBill,
  formatGB,
  type ContextBill
} from '@shared/contextBill'
import { CONTEXT_SIZE_MAX, CONTEXT_SIZE_MIN, DEFAULT_CONTEXT_SIZE } from '@shared/aiDefaults'
import type { AiConfig, ModelContextInfo } from '@shared/types'

/** 上下文输入框的落账规则:空串 = 交回自动探测(undefined);数字夹进合法范围 */
export function clampContextSize(raw: string): number | undefined {
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits === '') return undefined
  return Math.max(CONTEXT_SIZE_MIN, Math.min(CONTEXT_SIZE_MAX, Number(digits)))
}

export function useContextBill(input: {
  config: AiConfig | null
  ctxInfo: ModelContextInfo | null
  commitConfig: (next: AiConfig) => void
}): {
  contextRaw: string
  setContextRaw: React.Dispatch<React.SetStateAction<string>>
  /** 首次读档落定输入框的初始字(打字串和存档数字分开管) */
  seedContextRaw: (size: number | undefined) => void
  contextNotches: number[]
  ctxLine: ContextBill | null
  commitContextValue: (v: number) => void
  onContextBlur: () => void
} {
  const { config, ctxInfo, commitConfig } = input
  // 上下文框的打字串(纯字符串,和存档里的数字分开管,失焦才归账)
  const [contextRaw, setContextRaw] = useState<string>('')

  // 最大档照模型出厂上限封顶,翻不出档案按 64k 兜底
  const contextNotches = useMemo(
    () => CONTEXT_NOTCHES.filter((n) => n <= (ctxInfo?.nativeContext ?? FALLBACK_CONTEXT_CAP)),
    [ctxInfo]
  )
  const committedCtx = clampContextSize(contextRaw)
  const ctxBill = useMemo(
    () =>
      ctxInfo
        ? formatContextBill({
            contextTokens: committedCtx ?? DEFAULT_CONTEXT_SIZE,
            isAuto: committedCtx === undefined,
            modelBytes: ctxInfo.sizeBytes,
            shape: ctxInfo.shape,
            ramBytes: ctxInfo.ramBytes,
            vramBytes: ctxInfo.vramBytes
          })
        : null,
    [ctxInfo, committedCtx]
  )
  // 黑板账的展示口径照稿子短句式(「✓ 16k 可运行(模型 3.2 GB,内存充足)」):
  // 判定照旧走 ctxBill 精算,行上只摆档名 + 结论 + 括号真规格,不摊流水账
  const ctxLine = useMemo((): ContextBill | null => {
    if (!ctxBill || !ctxInfo) return ctxBill
    const label = committedCtx === undefined ? '自动' : `${committedCtx / 1024}k`
    const model = ctxInfo.sizeBytes !== null ? formatGB(ctxInfo.sizeBytes) : '?'
    switch (ctxBill.level) {
      case 'ok':
        return { level: 'ok', text: `✓ ${label} 可运行(模型 ${model}，内存充足)` }
      case 'tight':
        return { level: 'tight', text: `! ${label} 偏紧(模型 ${model}，贴近内存上限)` }
      case 'too-big':
        return { level: 'too-big', text: `✕ ${label} 带不动(模型 ${model}，超出内存上限)` }
      default:
        return { level: 'unknown', text: `… 读不到模型档案，${label} 的黑板账算不了` }
    }
  }, [ctxBill, ctxInfo, committedCtx])

  function commitContextValue(v: number): void {
    setContextRaw(String(v))
    if (config && config.contextSize !== v) {
      commitConfig({ ...config, contextSize: v })
    }
  }

  /** 上下文输入框失焦落账:数字归到合法范围,空串交回自动探测;框里当场改字,眼见为实 */
  function onContextBlur(): void {
    const committed = clampContextSize(contextRaw)
    setContextRaw(committed === undefined ? '' : String(committed))
    if (config && config.contextSize !== committed) {
      commitConfig({ ...config, contextSize: committed })
    }
  }

  // 身份必须稳定:设置页的首读存档 effect 拿它当依赖,每次渲染换个新函数会把
  // 「读配置 → 改状态 → 再渲染 → 再读配置」接成死循环,下拉框选完立刻被旧值顶回去
  const seedContextRaw = useCallback((size: number | undefined): void => {
    setContextRaw(size === undefined ? '' : String(size))
  }, [])

  return {
    contextRaw,
    setContextRaw,
    seedContextRaw,
    contextNotches,
    ctxLine,
    commitContextValue,
    onContextBlur
  }
}
