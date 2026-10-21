/**
 * 文本输入框的右键编辑菜单(复制/粘贴)。
 * 自由对话输入舱与 workspace 路径栏共用:Electron 没有原生编辑菜单,
 * 这里统一摆一张窄身菜单,选中态在开菜单前定格(右键落点即光标位)。
 */
import type { MouseEvent as ReactMouseEvent } from 'react'
import { openContextMenu, type ContextMenuItem } from './contextMenuStore'

type TextControl = HTMLInputElement | HTMLTextAreaElement

export function openTextEditMenu<T extends TextControl>({
  event,
  value,
  setValue
}: {
  event: ReactMouseEvent<T>
  value: string
  setValue: (next: string) => void
}): void {
  event.preventDefault()
  const el = event.currentTarget
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? start
  const picked = value.slice(start, end)
  const x = event.clientX
  const y = event.clientY
  /** 受控输入改字:新值交给 setValue,光标摁到指定位置 */
  const applyEdit = (next: string, caret: number): void => {
    setValue(next)
    el.focus()
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = caret
    })
  }
  /** 在右键落点插字:受控输入走 setValue,光标摁到插完的位置接着写 */
  const splice = (inserted: string): void => {
    applyEdit(value.slice(0, start) + inserted + value.slice(end), start + inserted.length)
  }
  const buildItems = (clip: string): ContextMenuItem[] => [
    {
      label: '剪切',
      disabled: !picked,
      run: () =>
        navigator.clipboard
          .writeText(picked)
          .then(() => {
            applyEdit(value.slice(0, start) + value.slice(end), start)
            return '已剪切 ✓'
          })
          .catch(() => '没剪切成,剪贴板被顶住了')
    },
    {
      label: '复制',
      disabled: !picked,
      run: () =>
        navigator.clipboard
          .writeText(picked)
          .then(() => {
            el.focus()
            return '已复制 ✓'
          })
          .catch(() => '没复制成,剪贴板被顶住了')
    },
    { label: '粘贴', disabled: clip === '', run: () => splice(clip) },
    {
      label: '全选',
      disabled: value === '',
      run: () => {
        el.focus()
        el.select()
      }
    }
  ]
  const open = (clip: string): void =>
    openContextMenu({
      x,
      y,
      doc: el.ownerDocument,
      compact: true,
      preferRight: true,
      items: buildItems(clip)
    })
  void navigator.clipboard
    .readText()
    .then(open)
    .catch(() => open(''))
}
