import { useEffect } from 'react'

/**
 * 右键菜单的「用户不要了」三条退路(P2-2 公共件):
 * 点菜单外面、滚轮、按 Esc —— 开着时才上闸,收了就卸。
 * insideSelector 指了的话,点在它命中的元素里不算「外面」;
 * 用捕获期监听,比菜单自己的 stopPropagation 更扛得住嵌套场景。
 */
export function useMenuDismiss(open: boolean, close: () => void, insideSelector?: string): void {
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (insideSelector && e.target instanceof Element && e.target.closest(insideSelector)) return
      close()
    }
    const onWheel = (): void => close()
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
