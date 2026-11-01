// 通用右键菜单的行拖动排序(从 ContextMenu 拆出:一个文件只管一件职责,也守住行数闸)。
// 按住带 dragId 的行上下拖,按每行中线算落点;落点蓝线交给组件画,
// 松手把新的 dragId 顺序交回调用方,由它决定怎么落账、要不要原位重开菜单。
import { useRef, useState } from 'react'
import { MENU_SEP, isMenuHeading, type ContextMenuRequest } from './contextMenuStore'

/** 按住行拖多远才算拖动:低于这个距离仍按点击处理(开关照常拨) */
const DRAG_THRESHOLD_PX = 4

/** 正在拖的行:pointerId 认人,slot 是落点在这串可拖行里的序号 */
interface RowDrag {
  pointerId: number
  startY: number
  dragId: string
  active: boolean
  slot: number
}

/** 落点蓝线:卡片内坐标 */
export interface MenuDropLine {
  dragId: string
  top: number
}

export interface MenuRowReorderOptions {
  request: ContextMenuRequest
  /** 菜单卡片:落点坐标按它换算 */
  cardRef: React.RefObject<HTMLDivElement | null>
  /** 拖过阈值真正动起来时调(收起二级菜单) */
  onActivate?: () => void
  /** 松手落点已定、即将交回新行序时调(菜单会重建,按行号记的本地账作废) */
  onCommit?: () => void
}

export interface MenuRowReorder {
  canReorder: boolean
  dropLine: MenuDropLine | null
  /** 行元素登记口:拖动时按每行盒子算落点 */
  setRowEl: (index: number, el: HTMLElement | null) => void
  startDrag: (e: React.PointerEvent<HTMLElement>, dragId: string) => void
  moveDrag: (e: React.PointerEvent<HTMLElement>) => void
  endDrag: (e: React.PointerEvent<HTMLElement>) => void
  cancelDrag: () => void
  /** 拖完松手补的那个 click:吃掉一次,别顺手把开关拨了 */
  consumeSuppressedClick: () => boolean
}

export function useMenuRowReorder({
  request,
  cardRef,
  onActivate,
  onCommit
}: MenuRowReorderOptions): MenuRowReorder {
  const [dropLine, setDropLine] = useState<MenuDropLine | null>(null)
  const rowEls = useRef(new Map<number, HTMLElement>())
  const drag = useRef<RowDrag | null>(null)
  const suppressClick = useRef(false)

  const dragRows = request.items.flatMap((item, index) =>
    item !== MENU_SEP && !isMenuHeading(item) && item.dragId !== undefined && !item.disabled
      ? [{ index, id: item.dragId }]
      : []
  )
  const dragIds = dragRows.map((row) => row.id)
  const canReorder = request.onReorder !== undefined && dragIds.length > 1

  function insertionAt(clientY: number): { slot: number; top: number } | null {
    const card = cardRef.current
    if (!card) return null
    const rows = dragRows.flatMap(({ index }) => {
      const el = rowEls.current.get(index)
      return el ? [el] : []
    })
    if (rows.length === 0) return null
    const cardTop = card.getBoundingClientRect().top + card.clientTop
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return { slot: i, top: rect.top - cardTop }
    }
    const last = rows[rows.length - 1].getBoundingClientRect()
    return { slot: rows.length, top: last.bottom - cardTop }
  }

  function startDrag(e: React.PointerEvent<HTMLElement>, dragId: string): void {
    if (!canReorder || e.button !== 0) return
    const slot = dragIds.indexOf(dragId)
    // 置灰的行不在可拖名单里:不接这一手,免得拖出个不存在的落点
    if (slot < 0) return
    suppressClick.current = false
    drag.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      dragId,
      active: false,
      slot
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function moveDrag(e: React.PointerEvent<HTMLElement>): void {
    const current = drag.current
    if (!current || current.pointerId !== e.pointerId) return
    if (!current.active) {
      if (Math.abs(e.clientY - current.startY) < DRAG_THRESHOLD_PX) return
      current.active = true
      onActivate?.()
    }
    const at = insertionAt(e.clientY)
    if (!at) return
    current.slot = at.slot
    setDropLine({ dragId: current.dragId, top: at.top })
  }

  function endDrag(e: React.PointerEvent<HTMLElement>): void {
    const current = drag.current
    if (!current || current.pointerId !== e.pointerId) return
    drag.current = null
    if (!current.active) return
    suppressClick.current = true
    setDropLine(null)
    onCommit?.()
    const from = dragIds.indexOf(current.dragId)
    if (from < 0) return
    const next = dragIds.filter((id) => id !== current.dragId)
    next.splice(current.slot > from ? current.slot - 1 : current.slot, 0, current.dragId)
    if (next.every((id, i) => id === dragIds[i])) return
    request.onReorder?.(next)
  }

  function cancelDrag(): void {
    drag.current = null
    setDropLine(null)
  }

  return {
    canReorder,
    dropLine,
    setRowEl: (index, el) => {
      if (el) rowEls.current.set(index, el)
      else rowEls.current.delete(index)
    },
    startDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    consumeSuppressedClick: () => {
      if (!suppressClick.current) return false
      suppressClick.current = false
      return true
    }
  }
}
