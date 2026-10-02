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

/** 由 iframe 内元素反推出选中账(部件名 + 同名第几个 + 图标槽位);零件盒定位也用它 */
export function selectionOf(el: Element, frameDoc: Document): CanvasSelection {
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
  viewport,
  selection,
  placedSel,
  onSelect,
  onSelectPlaced,
  onMovePlaced,
  onKey
}: {
  doc: UiFrameDoc
  view: CanvasView
  theme: ThemeName
  /** 画布视口:fixed = 手机定高,内容在 iframe 内部滚动;否则按内容自动长高 */
  viewport: { height: number; fixed: boolean }
  selection: CanvasSelection | null
  /** 底板选中的零件实例 id(M3-a) */
  placedSel: string | null
  onSelect: (sel: CanvasSelection | null) => void
  onSelectPlaced: (id: string | null) => void
  /** 零件拖动落点提交(布局 px,与 PlacedPart.x/y 同坐标系) */
  onMovePlaced: (id: string, x: number, y: number) => void
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
  const handlersRef = useRef({ onSelect, onSelectPlaced, onMovePlaced, onKey })
  useEffect(() => {
    handlersRef.current = { onSelect, onSelectPlaced, onMovePlaced, onKey }
  })

  /** 按 body 实际内容高度定 iframe 高度(documentElement.scrollHeight 不会小于当前视口,换视图后缩不回去);
   *  手机端固定视口高,内容在 iframe 内部滚动 */
  function fitHeight(): void {
    const frame = frameRef.current
    const body = frame?.contentDocument?.body
    if (!frame || !body) return
    if (viewport.fixed) {
      frame.style.height = `${viewport.height}px`
      return
    }
    frame.style.height = `${Math.max(viewport.height, Math.ceil(body.getBoundingClientRect().height))}px`
  }

  function onLoad(): void {
    setFrameDoc(frameRef.current?.contentDocument ?? null)
  }

  // 方案变化 → 只换变量样式;主题 → 只换 data-theme(组件墙自带亮暗两段,恒为亮色底)
  useEffect(() => {
    if (!frameDoc) return
    applyTokens(frameDoc, doc)
    frameDoc.documentElement.setAttribute('data-theme', view === 'bench' ? theme : 'light')
  }, [frameDoc, doc, theme, view])

  useEffect(() => {
    if (!frameDoc) return
    const win = frameDoc.defaultView
    const onClick = (e: MouseEvent): void => {
      e.preventDefault()
      // 底板上的零件先判 placed 壳:点击 = 选中实例(移动/删除),不进变量选中
      const placedEl = (e.target as Partial<Element> | null)?.closest?.('[data-uf-placed]') ?? null
      if (placedEl) {
        handlersRef.current.onSelect(null)
        handlersRef.current.onSelectPlaced(placedEl.getAttribute('data-uf-placed'))
        return
      }
      const el = partOf(e.target)
      handlersRef.current.onSelectPlaced(null)
      handlersRef.current.onSelect(el ? selectionOf(el, frameDoc) : null)
    }
    // 零件拖动(M3-a):pointerdown 在 .uf-placed 上 → 过程位置直接改元素 style,
    // pointerup 才提交一次进撤销栈(不拖一步压一步历史)
    let moveDrag: {
      id: string
      startX: number
      startY: number
      baseX: number
      baseY: number
      el: Element
    } | null = null
    const onPointerDown = (e: PointerEvent): void => {
      const el = (e.target as Partial<Element> | null)?.closest?.('[data-uf-placed]') ?? null
      if (!el || e.button !== 0) return
      const id = el.getAttribute('data-uf-placed')
      if (!id) return
      e.preventDefault()
      handlersRef.current.onSelectPlaced(id)
      moveDrag = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        baseX: parseFloat((el as HTMLElement).style.left) || 0,
        baseY: parseFloat((el as HTMLElement).style.top) || 0,
        el
      }
    }
    const onPointerMove = (e: PointerEvent): void => {
      if (!moveDrag) return
      const x = Math.max(0, moveDrag.baseX + (e.clientX - moveDrag.startX))
      const y = Math.max(0, moveDrag.baseY + (e.clientY - moveDrag.startY))
      ;(moveDrag.el as HTMLElement).style.left = `${x}px`
      ;(moveDrag.el as HTMLElement).style.top = `${y}px`
    }
    // 底板零件是「道具」:mousedown 默认行为会把焦点让给零件里的 input,之后 Delete 会被
    // 「输入框里不删」的守卫拦下;拦住聚焦,点击选中/拖动与 Delete 键删除才始终成立
    const onMouseDown = (e: MouseEvent): void => {
      if ((e.target as Partial<Element> | null)?.closest?.('[data-uf-placed]')) e.preventDefault()
    }
    const onPointerUp = (e: PointerEvent): void => {
      if (!moveDrag) return
      const x = Math.max(0, moveDrag.baseX + (e.clientX - moveDrag.startX))
      const y = Math.max(0, moveDrag.baseY + (e.clientY - moveDrag.startY))
      handlersRef.current.onMovePlaced(moveDrag.id, x, y)
      moveDrag = null
    }
    // 拖出 iframe 边界会收不到 pointerup:pointercancel/指针移出时丢弃这次拖动,不留悬挂状态
    const onPointerCancel = (): void => {
      moveDrag = null
    }
    const onMove = (e: MouseEvent): void => {
      hoverRef.current = partOf(e.target)
    }
    const onLeave = (): void => {
      hoverRef.current = null
    }
    const onKeyDown = (e: KeyboardEvent): void => handlersRef.current.onKey(e)
    // 空格对比需要 keyup 才算松手:iframe 里按住空格,松开时事件落在 iframe 自己的 window 上
    const onKeyUp = (e: KeyboardEvent): void => handlersRef.current.onKey(e)
    frameDoc.addEventListener('click', onClick, true)
    frameDoc.addEventListener('mousemove', onMove)
    frameDoc.addEventListener('mouseleave', onLeave)
    frameDoc.addEventListener('keydown', onKeyDown)
    frameDoc.addEventListener('keyup', onKeyUp)
    frameDoc.addEventListener('mousedown', onMouseDown)
    frameDoc.addEventListener('pointerdown', onPointerDown)
    frameDoc.addEventListener('pointermove', onPointerMove)
    frameDoc.addEventListener('pointerup', onPointerUp)
    frameDoc.addEventListener('pointercancel', onPointerCancel)
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
      frameDoc.removeEventListener('keyup', onKeyUp)
      frameDoc.removeEventListener('mousedown', onMouseDown)
      frameDoc.removeEventListener('pointerdown', onPointerDown)
      frameDoc.removeEventListener('pointermove', onPointerMove)
      frameDoc.removeEventListener('pointerup', onPointerUp)
      frameDoc.removeEventListener('pointercancel', onPointerCancel)
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
    // fitHeight 只读 ref 与 viewport,随视口变化重挂即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameDoc, viewport.height, viewport.fixed])

  // 选中框与悬停框:每帧对齐元素真实位置(拖动中元素实时变大变小)
  useEffect(() => {
    if (!frameDoc) return
    let raf = 0
    const tick = (): void => {
      const selected = selection
        ? findSelected(frameDoc, selection)
        : placedSel
          ? frameDoc.querySelector(`[data-uf-placed="${placedSel}"]`)
          : null
      placeBox(selBoxRef.current, selected)
      const hovered = hoverRef.current
      placeBox(hoverBoxRef.current, hovered === selected ? null : hovered)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [frameDoc, selection, placedSel])

  return { frameRef, selBoxRef, hoverBoxRef, frameDoc, onLoad, fitHeight }
}
