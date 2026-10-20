// 工作区菜单的底边拖拽(与 useSidebarSash 同一套手感):pointer capture 拖、
// 双击回内容自适应、方向键微调。高度只在本会话有效 —— 这个功能是「这次想多看几条」,
// 不是每次都要的偏好,所以不落盘。上限口径见 menuResize.ts。
import { useEffect, useRef } from 'react'
import { clampMenuHeight, menuHeightBounds, type MenuHeightBounds } from './menuResize'

/** 方向键一步的高度(px) */
const KEY_STEP = 24

/** 条目全展开时的高度 = 现有菜单高 - 列表可视高 + 列表内容高。
 * 列表已经全展开时两项相等,结果就是当前高度(不允许再拉出空白)。 */
function measureBoundsOf(menu: HTMLElement, list: HTMLElement): MenuHeightBounds {
  const rect = menu.getBoundingClientRect()
  const listRect = list.getBoundingClientRect()
  const contentHeight = rect.height - listRect.height + list.scrollHeight
  const minHeight = Number.parseFloat(getComputedStyle(menu).minHeight)
  return menuHeightBounds(contentHeight, rect.top, window.innerHeight, minHeight)
}

/** 写高度并切到「条目区吃满高度」的布局;返回实际落下的整数高度 */
function applyHeightTo(menu: HTMLElement, height: number, bounds: MenuHeightBounds): number {
  const next = Math.round(clampMenuHeight(height, bounds))
  menu.style.height = `${next}px`
  menu.setAttribute('data-resized', '')
  return next
}

function publishBounds(handle: HTMLElement | null, bounds: MenuHeightBounds): void {
  if (!handle) return
  handle.setAttribute('aria-valuemin', String(Math.round(bounds.min)))
  handle.setAttribute('aria-valuemax', String(Math.round(bounds.max)))
}

export interface MenuResizeHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
}

export function useWorkspaceMenuResize(
  menuRef: React.RefObject<HTMLDivElement | null>,
  listRef: React.RefObject<HTMLDivElement | null>,
  handleRef: React.RefObject<HTMLDivElement | null>,
  /** 条目增减的指纹(pin 数:历史数):删条目后把已拉高的菜单收回条目实际高度,不留空白 */
  contentKey: string
): MenuResizeHandlers {
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const boundsRef = useRef<MenuHeightBounds | null>(null)

  // 开菜单时先把上下限报给读屏;窗口变小时把已经拉高的菜单重夹一遍
  useEffect(() => {
    const menu = menuRef.current
    const list = listRef.current
    if (menu && list) publishBounds(handleRef.current, measureBoundsOf(menu, list))

    function onWindowResize(): void {
      const current = menuRef.current
      const currentList = listRef.current
      if (!current || !currentList || !current.hasAttribute('data-resized')) return
      const bounds = measureBoundsOf(current, currentList)
      publishBounds(handleRef.current, bounds)
      current.style.height = `${Math.round(
        clampMenuHeight(current.getBoundingClientRect().height, bounds)
      )}px`
    }

    window.addEventListener('resize', onWindowResize)
    return () => {
      window.removeEventListener('resize', onWindowResize)
      document.body.classList.remove('is-menu-resizing')
    }
  }, [menuRef, listRef, handleRef])

  // 条目增减(删一条、pin 一条)后重夹:只对已经拖高过的菜单生效,收回多出来的空白
  useEffect(() => {
    const menu = menuRef.current
    if (!menu || !menu.hasAttribute('data-resized')) return
    const list = listRef.current
    // 条目删光了:列表不在了,高度退回内容自适应,别留一个空壳
    if (!list) {
      menu.style.removeProperty('height')
      menu.removeAttribute('data-resized')
      return
    }
    const bounds = measureBoundsOf(menu, list)
    publishBounds(handleRef.current, bounds)
    const next = Math.round(clampMenuHeight(menu.getBoundingClientRect().height, bounds))
    menu.style.height = `${next}px`
    handleRef.current?.setAttribute('aria-valuenow', String(next))
  }, [contentKey, menuRef, listRef, handleRef])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    const menu = menuRef.current
    const list = listRef.current
    if (!menu || !list) return
    e.preventDefault()
    const bounds = measureBoundsOf(menu, list)
    boundsRef.current = bounds
    dragRef.current = { startY: e.clientY, startHeight: menu.getBoundingClientRect().height }
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('is-menu-resizing')
    publishBounds(handleRef.current, bounds)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    const bounds = boundsRef.current
    const menu = menuRef.current
    if (!drag || !bounds || !menu) return
    const next = applyHeightTo(menu, drag.startHeight + (e.clientY - drag.startY), bounds)
    handleRef.current?.setAttribute('aria-valuenow', String(next))
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) return
    dragRef.current = null
    boundsRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    document.body.classList.remove('is-menu-resizing')
  }

  // 双击:交还给内容自适应,回到「最多 5 条 + 我的电脑」的默认样子
  function onDoubleClick(): void {
    const menu = menuRef.current
    if (!menu) return
    menu.style.removeProperty('height')
    menu.removeAttribute('data-resized')
    const list = listRef.current
    if (list) publishBounds(handleRef.current, measureBoundsOf(menu, list))
    handleRef.current?.setAttribute('aria-valuenow', '')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const menu = menuRef.current
    const list = listRef.current
    if (!menu || !list) return
    e.preventDefault()
    const bounds = measureBoundsOf(menu, list)
    publishBounds(handleRef.current, bounds)
    const current = menu.getBoundingClientRect().height
    const next = applyHeightTo(
      menu,
      current + (e.key === 'ArrowDown' ? KEY_STEP : -KEY_STEP),
      bounds
    )
    handleRef.current?.setAttribute('aria-valuenow', String(next))
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick,
    onKeyDown
  }
}
