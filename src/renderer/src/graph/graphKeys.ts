// 图谱页签的键盘入口:Ctrl+F 聚焦搜索,Backspace / Alt+左返回上一层。
import type { KeyboardEvent } from 'react'
import { isEditableTarget } from '../isEditableTarget'
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
    // 搜索框等输入控件自己要用 Backspace 删字,不能被「返回上一层」抢走
    if (isEditableTarget(e.target)) return
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
      e.preventDefault()
      nav.goUp()
    }
  }
}
