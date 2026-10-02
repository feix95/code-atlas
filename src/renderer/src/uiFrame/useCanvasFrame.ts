// 画布 iframe 的接线:点选部件、悬停描边、选中框跟随、iframe 自适应高度。
// 选中框与悬停框每帧按元素真实位置摆放(iframe 不滚动,元素坐标即舞台坐标)。
import { useEffect, useRef, useState } from 'react'
import type { IconSlot, ThemeName, UiFrameDoc } from '@shared/uiFrame/types'
import { applyTokens, type CanvasView } from './canvasDoc'

export interface CanvasSelection {
  part: string
  /** 同名部件里的第几个(画布重载后靠它找回元素) */
  index: number
  iconSlot: IconSlot | null
}

/** iframe 里的节点属于 iframe 自己的 window:不能用父窗的 instanceof Element 判断(跨 realm 恒为假) */
function partOf(target: EventTarget | null): Element | null {
  const el = target as Partial<Element> | null
  return el && typeof el.closest === 'function' ? el.closest('[data-uf-part]') : null
}

function selectionOf(el: Element, frameDoc: Document): CanvasSelection {
  const part = el.getAttribute('data-uf-part') ?? ''
  const all = [...frameDoc.querySelectorAll(`[data-uf-part="${part}"]`)]
  const slot =
    el.getAttribute('data-uf-icon') ??
    el.querySelector('[data-uf-icon]')?.getAttribute('data-uf-icon')
  return { part, index: Math.max(0, all.indexOf(el)), iconSlot: (slot as IconSlot | null) ?? null }
}

export function findSelected(frameDoc: Document, sel: CanvasSelection): Element | null {
  return frameDoc.querySelectorAll(`[data-uf-part="${sel.part}"]`)[sel.index] ?? null
}

function placeBox(box: HTMLDivElement | null, el: Element | null): void {
  if (!box) return
  if (!el) {
    box.style.display = 'none'
    return
  }
  const r = el.getBoundingClientRect()
  box.style.display = 'block'
  box.style.transform = `translate(${r.left}px, ${r.top}px)`
  box.style.width = `${r.width}px`
  box.style.height = `${r.height}px`
}

export function useCanvasFrame({
  doc,
  view,
  theme,
  minHeight,
  selection,
  onSelect,
  onKey
}: {
  doc: UiFrameDoc
  view: CanvasView
  theme: ThemeName
  minHeight: number
  selection: CanvasSelection | null
  onSelect: (sel: CanvasSelection | null) => void
  onKey: (e: KeyboardEvent) => void
}): {
  frameRef: React.RefObject<HTMLIFrameElement | null>
  selBoxRef: React.RefObject<HTMLDivElement | null>
  hoverBoxRef: React.RefObject<HTMLDivElement | null>
  frameDoc: Document | null
  onLoad: () => void
  fitHeight: () => void
} {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const selBoxRef = useRef<HTMLDivElement | null>(null)
  const hoverBoxRef = useRef<HTMLDivElement | null>(null)
  const hoverRef = useRef<Element | null>(null)
  const [frameDoc, setFrameDoc] = useState<Document | null>(null)
  const handlersRef = useRef({ onSelect, onKey })
  useEffect(() => {
    handlersRef.current = { onSelect, onKey }
  })

  /** 按 body 实际内容高度定 iframe 高度(documentElement.scrollHeight 不会小于当前视口,换视图后缩不回去) */
  function fitHeight(): void {
    const frame = frameRef.current
    const body = frame?.contentDocument?.body
    if (!frame || !body) return
    frame.style.height = `${Math.max(minHeight, Math.ceil(body.getBoundingClientRect().height))}px`
  }

  function onLoad(): void {
    setFrameDoc(frameRef.current?.contentDocument ?? null)
  }

  // 方案变化 → 只换变量样式;主题 → 只换 data-theme(组件墙自带亮暗两段,恒为亮色底)
  useEffect(() => {
    if (!frameDoc) return
    applyTokens(frameDoc, doc)
    frameDoc.documentElement.setAttribute('data-theme', view === 'page' ? theme : 'light')
  }, [frameDoc, doc, theme, view])

  useEffect(() => {
    if (!frameDoc) return
    const win = frameDoc.defaultView
    const onClick = (e: MouseEvent): void => {
      e.preventDefault()
      const el = partOf(e.target)
      handlersRef.current.onSelect(el ? selectionOf(el, frameDoc) : null)
    }
    const onMove = (e: MouseEvent): void => {
      hoverRef.current = partOf(e.target)
    }
    const onLeave = (): void => {
      hoverRef.current = null
    }
    const onKeyDown = (e: KeyboardEvent): void => handlersRef.current.onKey(e)
    frameDoc.addEventListener('click', onClick, true)
    frameDoc.addEventListener('mousemove', onMove)
    frameDoc.addEventListener('mouseleave', onLeave)
    frameDoc.addEventListener('keydown', onKeyDown)
    // 推迟到下一帧再量:避免改 iframe 高度在同一帧内再次触发观察(ResizeObserver loop)
    let raf = 0
    const ro = win
      ? new win.ResizeObserver(() => {
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(fitHeight)
        })
      : null
    ro?.observe(frameDoc.body)
    return () => {
      frameDoc.removeEventListener('click', onClick, true)
      frameDoc.removeEventListener('mousemove', onMove)
      frameDoc.removeEventListener('mouseleave', onLeave)
      frameDoc.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
    // fitHeight 只读 ref 与 minHeight,随 minHeight 变化重挂即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameDoc, minHeight])

  // 选中框与悬停框:每帧对齐元素真实位置(拖动中元素实时变大变小)
  useEffect(() => {
    if (!frameDoc) return
    let raf = 0
    const tick = (): void => {
      const selected = selection ? findSelected(frameDoc, selection) : null
      placeBox(selBoxRef.current, selected)
      const hovered = hoverRef.current
      placeBox(hoverBoxRef.current, hovered === selected ? null : hovered)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [frameDoc, selection])

  return { frameRef, selBoxRef, hoverBoxRef, frameDoc, onLoad, fitHeight }
}
