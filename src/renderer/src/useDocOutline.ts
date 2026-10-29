// 大纲的现场账:正文换了就重收标题、滚动时算当前节、点条目在预览栏里平滑滚过去。
// 只滚预览栏自己(scrollTo),不用 scrollIntoView —— 那会连带把外层布局一起滚动。
// 标题元素按「正文顺序」现取(number 对 number),不依赖挂在节点上的临时编号:
// 编号在正文重挂时会丢(Word 大文档遇到过),标题顺序不会变。
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { activeOutlineId, collectOutline, outlineHeadingEls, type OutlineItem } from './docOutline'

/** 读线落在视口上方这个比例处:标题滚过它就算进入这一节 */
const READING_LINE_RATIO = 0.25

function headingEl(view: HTMLElement, items: OutlineItem[], id: string): HTMLElement | null {
  const index = items.findIndex((item) => item.id === id)
  return index < 0 ? null : (outlineHeadingEls(view)[index] ?? null)
}

function offsetIn(view: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - view.getBoundingClientRect().top
}

function prefersReducedMotion(view: HTMLElement): boolean {
  return (
    view.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false
  )
}

export function useDocOutline(
  viewRef: React.RefObject<HTMLDivElement | null>,
  contentKey: string | undefined
): { items: OutlineItem[]; activeId: string | null; jumpTo: (id: string) => void } {
  const [items, setItems] = useState<OutlineItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // 正文是同一次提交里画好的,布局副作用跑时标题已在 DOM 里;contentKey 变了才重收
  useLayoutEffect(() => {
    const view = viewRef.current
    setItems(contentKey === undefined || !view ? [] : collectOutline(view))
  }, [viewRef, contentKey])

  useEffect(() => {
    const view = viewRef.current
    if (!view || items.length === 0) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const line = view.clientHeight * READING_LINE_RATIO
      const els = outlineHeadingEls(view)
      // 正文节点被整棵换过(Word 预览重挂):按新 DOM 重收,免得旧条目指错
      if (els.length !== items.length) {
        setItems(collectOutline(view))
        return
      }
      const heads = items.flatMap((item, i) => {
        const el = els[i]
        return el ? [{ id: item.id, top: offsetIn(view, el) }] : []
      })
      setActiveId(activeOutlineId(heads, line))
    }
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    measure()
    view.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      view.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [viewRef, items])

  const jumpTo = useCallback(
    (id: string): void => {
      const view = viewRef.current
      const el = view ? headingEl(view, items, id) : null
      if (!view || !el) return
      const padTop = parseFloat(getComputedStyle(view).paddingTop) || 0
      view.scrollTo({
        top: view.scrollTop + offsetIn(view, el) - padTop,
        behavior: prefersReducedMotion(view) ? 'auto' : 'smooth'
      })
    },
    [viewRef, items]
  )

  return { items, activeId, jumpTo }
}
