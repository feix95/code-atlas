/** 键盘事件落在可编辑元素上(输入框/下拉/可编辑区)时,画布快捷键不接管 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}
