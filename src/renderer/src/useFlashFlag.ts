import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 「亮一下→自己退场」小状态机(P2-1 收的公共件,全 app 的瞬时反馈一枚户口):
 * flash(value, ms) 亮出这个值,ms 后自动退回 idle;连按重新计时;
 * 组件卸载自动清闸,不留「幽灵亮」。返回 [当前值, 点亮, 手动熄灭]。
 * 布尔版见 useFlashFlag;各场景只养自己的时长常量,不共用一份体感表。
 */
export function useFlashValue<T>(idle: T): [T, (value: T, ms: number) => void, () => void] {
  const [value, setValue] = useState<T>(idle)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )
  const flash = useCallback(
    (next: T, ms: number) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setValue(next)
      timerRef.current = setTimeout(() => setValue(idle), ms)
    },
    [idle]
  )
  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setValue(idle)
  }, [idle])
  return [value, flash, dismiss]
}

/** 布尔版:亮 true、熄 false —— 复制成功/按压反馈这类只有两态的用最顺手 */
export function useFlashFlag(ms: number): [boolean, () => void, () => void] {
  const [lit, flashValue, dismiss] = useFlashValue(false)
  const flash = useCallback(() => flashValue(true, ms), [flashValue, ms])
  return [lit, flash, dismiss]
}
