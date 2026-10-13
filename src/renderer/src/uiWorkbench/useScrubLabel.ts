// 数值框标签的拖拽调值手势(Photoshop 式):按住标签左右拖动,右增左减,Shift 10 倍。
// 拖动期间挂 window 级监听,指针飞出面板也不断;整笔拖动是一个批次 = 一步撤销;
// 光标钉在文档根上保持左右拖拽样式;blur / pointercancel 兜底收尾,批次不挂起。
import { useEffect, useRef } from 'react'
import { scrubStep } from '@shared/uiWorkbench/scrub'
import { docActions } from './documentStore'
import { isEditableTarget } from './isEditableTarget'

const SCRUB_CURSOR = 'ew-resize'

interface ScrubSource {
  /** 当前数值;null(多值混合)不支持拖拽 */
  value: number | null
  /** 与输入框同一套解析:返回钳到合法范围的整数,非法为 null */
  parse: (raw: string) => number | null
  onCommit: (value: number) => void
}

export function useScrubLabel(source: ScrubSource): (e: React.PointerEvent) => void {
  // 手势期间 value 会随提交刷新,用 ref 取最新而不是闭包里的旧值
  const sourceRef = useRef(source)
  useEffect(() => {
    sourceRef.current = source
  })

  return (down) => {
    if (down.button !== 0 || sourceRef.current.value === null) return
    const target = down.currentTarget
    const win = target.ownerDocument.defaultView
    if (!win) return
    // 不让浏览器把焦点交给标签所属的输入框,也不选中文字;已在编辑的输入框先收起
    down.preventDefault()
    const active = target.ownerDocument.activeElement
    if (isEditableTarget(active)) (active as HTMLElement).blur()

    const root = win.document.documentElement
    const prevCursor = root.style.cursor
    root.style.cursor = SCRUB_CURSOR
    let rest = 0
    let lastX = down.clientX
    let current = sourceRef.current.value

    const move = (e: PointerEvent): void => {
      const step = scrubStep(rest, e.clientX - lastX, e.shiftKey)
      lastX = e.clientX
      rest = step.rest
      if (step.delta === 0) return
      const next = sourceRef.current.parse(String(current + step.delta))
      if (next === null || next === current) return
      current = next
      sourceRef.current.onCommit(next)
    }
    const end = (): void => {
      win.removeEventListener('pointermove', move)
      win.removeEventListener('pointerup', end)
      win.removeEventListener('pointercancel', end)
      win.removeEventListener('blur', end)
      root.style.cursor = prevCursor
      docActions.endBatch()
    }
    try {
      target.setPointerCapture(down.pointerId)
    } catch (err) {
      root.style.cursor = prevCursor
      throw err
    }
    docActions.beginBatch()
    win.addEventListener('pointermove', move)
    win.addEventListener('pointerup', end)
    win.addEventListener('pointercancel', end)
    win.addEventListener('blur', end)
  }
}
