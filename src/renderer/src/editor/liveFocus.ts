/**
 * 「焦点在块替身里」标记:
 * 表格格子等替身对编辑器是 ignoreEvent 的,点进去编辑器自己的选区纹丝不动,
 * 旧光标还停在上一次点的列表项/标题上 —— 那个块就一直卸妆露源码,直到再点正文才恢复。
 * 替身拿到焦点时打上这个标记,装饰重算当作「光标不在任何块里」;
 * 编辑器出现任何显式选区变化(点正文、方向键、撤销)标记自动清掉。
 */
import { StateEffect, StateField } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

const widgetFocusChanged = StateEffect.define<boolean>()

export const widgetFocus = StateField.define<boolean>({
  create: () => false,
  update(isFocused, tr) {
    let next = tr.selection ? false : isFocused
    for (const effect of tr.effects) if (effect.is(widgetFocusChanged)) next = effect.value
    return next
  }
})

/** 替身(表格格子/格选区外框)拿到焦点时调用;已打过标记不重复派事务 */
export function markWidgetFocused(view: EditorView): void {
  // 字段没装(非 live 档)返回 undefined,什么都不做
  if (view.state.field(widgetFocus, false) === false)
    view.dispatch({ effects: widgetFocusChanged.of(true) })
}
