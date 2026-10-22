// 最大化时给 body 挂类:圆角描边收掉,挂在 body 上的抽屉跟着一起换装。
import { useEffect } from 'react'
import { useWindowMaximized } from './useWindowMaximized'

export function useMaximizedBodyClass(): void {
  const maximized = useWindowMaximized()
  useEffect(() => {
    document.body.classList.toggle('is-maximized', maximized)
    return () => document.body.classList.remove('is-maximized')
  }, [maximized])
}
