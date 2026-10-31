// Esc 收起详情与悬停:焦点可能已经落在左栏停靠块、正文选择或页面上,
// 只挂在画布容器的按键收不到;改挂整个 document,自己处理 Esc 的输入框与浮层除外。
import { useEffect } from 'react'

/** 自己处理 Esc 的控件与浮层:焦点在它们里面时,这一下留给它们 */
const IGNORE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]'

export function useGraphEscape(onEscape: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target
      if (target instanceof Element && target.closest(IGNORE_SELECTOR)) return
      onEscape()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onEscape])
}
