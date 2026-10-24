import { useEffect, useState } from 'react'
import type { VisionSupport } from '@shared/types'

/**
 * 当前模型的视觉能力:订阅模型状态广播,取 vision 账;
 * 缺省/认不出都是 unknown —— 渲染层按 imageGate 的口径用(unknown 放行带提醒)。
 * 订阅姿势照 RailAiStatus 同款:先 get 一份当下账,再跟广播走。
 */
export function useModelVision(): VisionSupport {
  const [vision, setVision] = useState<VisionSupport>('unknown')
  useEffect(() => {
    let alive = true
    void window.atlas
      .modelStatusGet()
      .then((s) => {
        if (alive) setVision(s.vision ?? 'unknown')
      })
      .catch(() => {})
    const off = window.atlas.onModelStatus((s) => setVision(s.vision ?? 'unknown'))
    return () => {
      alive = false
      off()
    }
  }, [])
  return vision
}
