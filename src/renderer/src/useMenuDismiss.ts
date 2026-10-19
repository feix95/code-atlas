import { useEffect } from 'react'

/**
 * 右键菜单的「用户不要了」退路(P2-2 公共件):
 * 点菜单外面、滚轮(外面)、按 Esc —— 开着时才上闸,收了就卸。
 * insideSelector 指了的话,点/滚在它命中的元素里不算「外面」
 * (菜单自己可滚的工作区菜单就指着这条活);
 * 用捕获期监听,比菜单自己的 stopPropagation 更扛得住嵌套场景。
 *
 * 点外面必须听 pointerdown:看图舞台、画布手势会在 pointerdown 上 preventDefault,
 * 浏览器就不发兼容 mousedown,只听 mousedown 会点了外面关不掉。
 */
export type MenuDismissDoc = Pick<Document, 'addEventListener' | 'removeEventListener'>

export function bindMenuDismiss(
  doc: MenuDismissDoc,
  close: () => void,
  insideSelector?: string
): () => void {
  const isInside = (e: Event): boolean =>
    insideSelector !== undefined &&
    hasClosest(e.target) &&
    e.target.closest(insideSelector) !== null

  const onOutsideDown = (e: Event): void => {
    if (isInside(e)) return
    close()
  }
  const onWheel = (e: Event): void => {
    if (isInside(e)) return
    close()
  }
  const onKeyDown = (e: Event): void => {
    if (eventKey(e) === 'Escape') close()
  }
  doc.addEventListener('pointerdown', onOutsideDown, true)
  doc.addEventListener('mousedown', onOutsideDown, true)
  doc.addEventListener('wheel', onWheel, true)
  doc.addEventListener('keydown', onKeyDown, true)
  return () => {
    doc.removeEventListener('pointerdown', onOutsideDown, true)
    doc.removeEventListener('mousedown', onOutsideDown, true)
    doc.removeEventListener('wheel', onWheel, true)
    doc.removeEventListener('keydown', onKeyDown, true)
  }
}

export function useMenuDismiss(
  open: boolean,
  close: () => void,
  insideSelector?: string,
  doc: Document = document // realm 铁律:菜单开在哪个 document,监听就挂哪个
): void {
  useEffect(() => {
    if (!open) return
    return bindMenuDismiss(doc, close, insideSelector)
  }, [open, close, insideSelector, doc])
}

function hasClosest(value: unknown): value is { closest: (selector: string) => unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'closest' in value &&
    typeof (value as { closest: unknown }).closest === 'function'
  )
}

function eventKey(e: Event): string | undefined {
  if (!('key' in e) || typeof e.key !== 'string') return undefined
  return e.key
}
