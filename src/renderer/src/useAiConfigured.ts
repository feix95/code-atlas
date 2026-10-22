// AI 配置状态:开机读一次,设置页保存后就地翻面 —— 不必重启也能让引导条和入口跟着变。
import { useEffect, useState } from 'react'
import { isAiConfigured } from '@shared/aiSetup'

type AiConfigPayload = Awaited<ReturnType<typeof window.atlas.aiConfigGet>>

export function useAiConfigured(): {
  aiConfigured: boolean | null
  applyAiConfig: (config: AiConfigPayload) => void
} {
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    void window.atlas
      .aiConfigGet()
      .then((c) => {
        if (!alive) return
        setAiConfigured(isAiConfigured(c))
      })
      .catch(() => {
        if (alive) setAiConfigured(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return {
    aiConfigured,
    applyAiConfig: (config) => setAiConfigured(isAiConfigured(config))
  }
}
