import { useEffect } from 'react'

/**
 * 右键菜单的「用户不要了」三条退路(P2-2 公共件):
 * 点菜单外面、滚轮(外面)、按 Esc —— 开着时才上闸,收了就卸。
 * insideSelector 指了的话,点/滚在它命中的元素里不算「外面」
 * (菜单自己可滚的工作区菜单就指着这条活);
 * 用捕获期监听,比菜单自己的 stopPropagation 更扛得住嵌套场景。
 */
export function useMenuDismiss(open: boolean, close: () => void, insideSelector?: string): void {
  useEffect(() => {
    if (!open) return
    const isInside = (e: Event): boolean =>
      insideSelector !== undefined &&
      e.target instanceof Element &&
      e.target.closest(insideSelector) !== null
    const onMouseDown = (e: MouseEvent): void => {
      if (isInside(e)) return
      close()
    }
    const onWheel = (e: WheelEvent): void => {
      if (isInside(e)) return
      close()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('wheel', onWheel, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('wheel', onWheel, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, close, insideSelector])
}
