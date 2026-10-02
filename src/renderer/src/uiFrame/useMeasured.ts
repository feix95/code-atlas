// 尺寸观察:ResizeObserver 回调里不直接改状态,推迟到下一帧再量,
// 避免「改状态 → 布局变化 → 再次触发」在同一帧内连锁(ResizeObserver loop 警告)。
import { useEffect, useState } from 'react'

export function useMeasured<T>(
  ref: React.RefObject<HTMLElement | null>,
  measure: (el: HTMLElement) => T,
  initial: T
): T {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setValue(measure(el)))
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // measure 为调用方的纯量取函数,只在挂载时接线一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref])
  return value
}
