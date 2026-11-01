// 图谱页签的键盘入口:Ctrl+F 聚焦搜索,Backspace / Alt+左返回上一层。
import type { KeyboardEvent } from 'react'
import type { GraphNav } from './useGraphNav'

export function graphKeyHandler(
  nav: GraphNav,
  focusSearch: () => void
): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      focusSearch()
      return
    }
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
      e.preventDefault()
      nav.goUp()
    }
  }
}
