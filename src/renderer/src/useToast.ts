// 轻量 Toast 状态:同一时刻只留一条,新消息顶掉旧的并重新计时;到点自己消失。
import { useCallback, useEffect, useRef, useState } from 'react'

/** 一条 Toast 停留时长:够读完一句短话,又不挡视线 */
const TOAST_VISIBLE_MS = 2200

export interface ToastState {
  /** 递增序号:相同文案连点也能让 Toast 重播入场动画 */
  id: number
  text: string
}

export function useToast(): {
  toast: ToastState | null
  showToast: (text: string, ms?: number) => void
} {
  const [toast, setToast] = useState<ToastState | null>(null)
  const seq = useRef(0)
  const timer = useRef<number | undefined>(undefined)

  const showToast = useCallback((text: string, ms?: number) => {
    window.clearTimeout(timer.current)
    seq.current += 1
    setToast({ id: seq.current, text })
    const hold = ms !== undefined && ms > 0 ? ms : TOAST_VISIBLE_MS
    timer.current = window.setTimeout(() => setToast(null), hold)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return { toast, showToast }
}
