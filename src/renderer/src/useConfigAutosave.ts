// 设置页的即改即存:控件每拨一下当场生效,连击 300ms 聚成一笔写盘,卸载前冲线。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiConfig } from '@shared/types'
import { friendlyErr } from './errText'

export function useConfigAutosave(onAiConfigSaved?: (config: AiConfig) => void): {
  config: AiConfig | null
  /** 从磁盘/外部回执装账(首次读档、货架下载完重读都走这条) */
  applyConfig: (next: AiConfig) => void
  /** 控件唯一改账口:新配置立刻进界面,落盘走防抖 */
  commitConfig: (next: AiConfig) => void
  saveError: string | null
} {
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // configRef 永远装最新配置;pendingSave 记「还有没写完的笔」
  const configRef = useRef<AiConfig | null>(null)
  const pendingSave = useRef(false)
  const saveTimer = useRef<number | null>(null)
  // 卸载冲线那一笔也要把存档回喊给调用方:回调本身可能换过届,走 ref 拿最新一届
  const onSavedRef = useRef(onAiConfigSaved)
  useEffect(() => {
    onSavedRef.current = onAiConfigSaved
  }, [onAiConfigSaved])

  const flushConfigSave = useCallback(async (): Promise<void> => {
    if (!pendingSave.current || !configRef.current) return
    pendingSave.current = false
    try {
      const saved = await window.atlas.aiConfigSave(configRef.current)
      onSavedRef.current?.(saved)
      setSaveError(null)
    } catch (err) {
      setSaveError(friendlyErr(err))
    }
  }, [])

  const applyConfig = useCallback((next: AiConfig): void => {
    configRef.current = next
    setConfig(next)
  }, [])

  const commitConfig = useCallback(
    (next: AiConfig): void => {
      configRef.current = next
      setConfig(next)
      pendingSave.current = true
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void flushConfigSave(), 300)
    },
    [flushConfigSave]
  )

  // 卸载冲线:没跑完的防抖落盘补写
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      if (pendingSave.current && configRef.current) {
        pendingSave.current = false
        void window.atlas
          .aiConfigSave(configRef.current)
          .then((saved) => onSavedRef.current?.(saved))
          .catch(() => {})
      }
    }
  }, [])

  return { config, applyConfig, commitConfig, saveError }
}
