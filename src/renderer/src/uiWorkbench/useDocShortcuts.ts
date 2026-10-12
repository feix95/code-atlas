// 文档级快捷键:Ctrl+Z 撤销;Ctrl+Shift+Z / Ctrl+Y 重做(macOS Cmd 同理,键位认 e.code 不认 e.key)。
// 与 useToolKeys 的分工:那边是画布悬停才生效的单键(V/R/Delete);这里是文档快捷键——
// 不要求鼠标在画布上(面板改完数值鼠标还停在面板,Ctrl+Z 照样要灵),
// 但焦点在输入框/可编辑区时不接管,保住输入框的原生文字撤销;
// 焦点落在工作台 DOM 之外的控件上(双分屏另一侧)也不抢键。
import { useEffect } from 'react'
import { docActions } from './documentStore'
import { isEditableTarget } from './isEditableTarget'
import type { CanvasViewportApi } from './useCanvasViewport'

export function useDocShortcuts(viewport: CanvasViewportApi): void {
  const { viewportRef } = viewport
  useEffect(() => {
    const win = viewportRef.current?.ownerDocument.defaultView
    if (!win) return
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const isUndo = e.code === 'KeyZ' && !e.shiftKey
      const isRedo = (e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY'
      if (!isUndo && !isRedo) return
      if (isEditableTarget(e.target)) return
      // 工作台在分屏里保活挂载时,别窗/别组里的按键不归它管
      const root = viewportRef.current?.closest('.ui-workbench') ?? null
      const target = e.target
      if (
        target instanceof win.Element &&
        root !== null &&
        !root.contains(target) &&
        target !== win.document.body &&
        target !== win.document.documentElement
      ) {
        return
      }
      if (isUndo) docActions.undo()
      else docActions.redo()
      e.preventDefault()
    }
    win.addEventListener('keydown', onKey, true)
    return () => win.removeEventListener('keydown', onKey, true)
  }, [viewportRef])
}
