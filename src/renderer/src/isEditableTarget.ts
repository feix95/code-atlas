/** 键盘事件落在可编辑元素上(输入框/下拉/可编辑区)时,画布快捷键不接管 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

// 不消费文本编辑键的 INPUT 类型:没有原生撤销可让渡,挡住 Ctrl+Z 只会变成死键
const NON_TEXT_INPUT = /^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/

/** 事件目标是否真的会消费文本编辑组合键(Ctrl+Z/X/C/V 有原生编辑行为才算):
 *  文本类输入框、多行框、可编辑区为真;SELECT 与色板/开关/滑块这类非文本控件为假——
 *  它们不吃 Ctrl+*,让渡出去等于把快捷键变死键 */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUT.test((el as HTMLInputElement).type)
  return false
}
