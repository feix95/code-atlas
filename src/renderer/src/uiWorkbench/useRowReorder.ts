// 列表行的按下/拖拽排序手势:图层面板与页面列表共用。
// 按下即触发 onPress(选中/切页),拖过阈值后进入排序:指针所在的「缝」实时回报给 drag,松手时 onDrop 落位。
// 指针追踪与批次收尾复用 trackPointer;行上的按钮/输入框(开关、重命名)不起手势。
import { useState } from 'react'
import { slotFromPointer } from '@shared/uiWorkbench/layers'
import { trackPointer } from './trackPointer'

/** 指针位移超过它才算拖拽,免得点一下就当成排序(CSS px) */
const DRAG_THRESHOLD_PX = 4
/** 行元素的标记属性,hook 靠它量各行位置 */
export const ROW_ATTR = 'data-row'

export interface RowDragState {
  fromRow: number
  /** 当前落点所在的缝,0 = 第一行上方,count = 最后一行下方 */
  slot: number
}

/** 拖拽中的落点指示:缝在某行上方 → 该行画上沿线;缝在最后一行下方 → 最后一行画下沿线 */
export function dropMarkerClass(drag: RowDragState | null, row: number, count: number): string {
  if (!drag) return ''
  if (drag.slot === row) return ' is-drop-before'
  return drag.slot === count && row === count - 1 ? ' is-drop-after' : ''
}

export interface RowReorderApi {
  drag: RowDragState | null
  startRow: (e: React.PointerEvent<HTMLElement>, row: number) => void
}

export function useRowReorder({
  listRef,
  onPress,
  onDrop
}: {
  listRef: React.RefObject<HTMLElement | null>
  onPress: (row: number, isShift: boolean) => void
  onDrop: (fromRow: number, slot: number) => void
}): RowReorderApi {
  const [drag, setDrag] = useState<RowDragState | null>(null)

  function rowMids(): number[] {
    const rows = listRef.current?.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`) ?? []
    return [...rows].map((el) => {
      const box = el.getBoundingClientRect()
      return box.top + box.height / 2
    })
  }

  function startRow(e: React.PointerEvent<HTMLElement>, row: number): void {
    const target = e.target as HTMLElement
    if (e.button !== 0 || target.closest('button, input')) return
    onPress(row, e.shiftKey)
    const startY = e.clientY
    let isDragging = false
    let slot = row
    trackPointer(
      e,
      (ev) => {
        if (!isDragging && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) return
        isDragging = true
        slot = slotFromPointer(rowMids(), ev.clientY)
        setDrag({ fromRow: row, slot })
      },
      () => {
        setDrag(null)
        if (isDragging) onDrop(row, slot)
      }
    )
  }

  return { drag, startRow }
}
