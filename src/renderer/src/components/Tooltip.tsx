import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 全局轻提示(全局规矩「只定义一次」):全场悬停提示的唯一户口。
 * 元素挂 data-tip="文案" 即得(多行用 \n);data-tip-side 指方位,默认 bottom;
 * data-tip-anchor="选择器" 可改锚到内部元素(文件树锚到文件名末端,不贴行尾)。
 * 气泡 fixed 挂 body,不受侧栏 overflow 裁剪;pointer-events 永不吃鼠标。
 * 原生 title 已全场退役:样式不可控、位置不可控、还不能预览。
 */

type TipSide = 'right' | 'left' | 'bottom' | 'top'

interface TipTarget {
  /** 每次亮相自增:key 挂它,气泡换目标就重挂载重量尺寸 */
  id: number
  el: HTMLElement
  text: string
  side: TipSide
}

interface TipPos {
  x: number
  y: number
  side: TipSide
  /** 小尾巴在气泡沿上的位置(右侧出=距气泡顶;下方出=距气泡左),px */
  arrow: number
}

/** 悬停多久才亮提示:VS Code 的悬停件约 300ms,取同档 */
const SHOW_DELAY = 300
/** 气泡与目标之间的缝(小尾巴占掉约 6px,视觉缝 ~4px) */
const GAP = 10
/** 距窗口边缘的最小留白 */
const EDGE = 8

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

function readTip(el: HTMLElement): TipTarget | null {
  const text = el.dataset.tip
  if (!text) return null
  const side = el.dataset.tipSide
  return {
    id: 0,
    el,
    text,
    side: side === 'right' || side === 'left' || side === 'top' ? side : 'bottom'
  }
}

/** 锚矩形:默认取元素自身;data-tip-anchor 给了选择器就锚到内部那个子元素 */
function anchorRect(el: HTMLElement): DOMRect {
  const sel = el.dataset.tipAnchor
  const inner = sel ? el.querySelector(sel) : null
  return (inner ?? el).getBoundingClientRect()
}

/** 按愿望方位摆,摆不下沿「对面→bottom→top」翻;实在全挤就硬压 bottom 加夹子 */
function placeTip(r: DOMRect, b: DOMRect, want: TipSide): TipPos {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cy = r.top + r.height / 2
  const cx = r.left + r.width / 2

  const tryAt = (side: TipSide): TipPos | null => {
    if (side === 'right' || side === 'left') {
      const x = side === 'right' ? r.right + GAP : r.left - GAP - b.width
      if (x < EDGE || x + b.width > vw - EDGE) return null
      const y = clamp(cy - b.height / 2, EDGE, Math.max(EDGE, vh - EDGE - b.height))
      return { x, y, side, arrow: clamp(cy - y, 12, b.height - 12) }
    }
    const y = side === 'bottom' ? r.bottom + GAP : r.top - GAP - b.height
    if (y < EDGE || y + b.height > vh - EDGE) return null
    const x = clamp(cx - b.width / 2, EDGE, Math.max(EDGE, vw - EDGE - b.width))
    return { x, y, side, arrow: clamp(cx - x, 12, b.width - 12) }
  }

  const order: TipSide[] =
    want === 'right' || want === 'left'
      ? [want, want === 'right' ? 'left' : 'right', 'bottom', 'top']
      : [want, want === 'bottom' ? 'top' : 'bottom', 'right', 'left']
  for (const s of order) {
    const p = tryAt(s)
    if (p) return p
  }
  // 四个方向都塞不下(气泡太大/目标卡死):压 bottom 让夹子兜底
  return {
    x: clamp(cx - b.width / 2, EDGE, Math.max(EDGE, vw - EDGE - b.width)),
    y: clamp(r.bottom + GAP, EDGE, Math.max(EDGE, vh - EDGE - b.height)),
    side: 'bottom',
    arrow: b.width / 2
  }
}

let tipSeq = 0

export function TooltipHost(): React.JSX.Element | null {
  const [tip, setTip] = useState<TipTarget | null>(null)
  const [pos, setPos] = useState<TipPos | null>(null)
  /** 当前目标的事件通路镜像:渲染期不碰 ref,只在监听回调里读写 */
  const tipRef = useRef<TipTarget | null>(null)

  // 气泡挂载时量尺寸算落位(setState 在 ref 回调里写是官方认可的测量姿势)。
  // key=tip.id → 换目标就重挂载重测量;卸载回调也走这里,归 null。
  const bubbleCb = useCallback((b: HTMLDivElement | null) => {
    const t = tipRef.current
    if (!b || !t) {
      setPos(null)
      return
    }
    setPos(placeTip(anchorRect(t.el), b.getBoundingClientRect(), t.side))
  }, [])

  useEffect(() => {
    let timer = 0
    let cur: HTMLElement | null = null

    const show = (t: TipTarget): void => {
      t.id = ++tipSeq
      tipRef.current = t
      setTip(t)
    }
    const hide = (): void => {
      window.clearTimeout(timer)
      cur = null
      tipRef.current = null
      setTip(null)
    }

    const plan = (el: HTMLElement): void => {
      const t = readTip(el)
      if (!t) return
      // 已亮着 → 相邻提示源之间游走即时接力,不用每次等延迟
      if (tipRef.current) show(t)
      else timer = window.setTimeout(() => show(t), SHOW_DELAY)
    }

    const onOver = (e: MouseEvent): void => {
      const host = (e.target as Element | null)?.closest?.('[data-tip]')
      const el = host instanceof HTMLElement ? host : null
      if (el === cur) return
      window.clearTimeout(timer)
      cur = el
      if (el) plan(el)
      else if (!tipRef.current) setTip(null)
    }
    const onOut = (e: MouseEvent): void => {
      // 在宿主内部移动(child→child)不算离开;relatedTarget 出了宿主才收
      if (cur && e.relatedTarget instanceof Node && cur.contains(e.relatedTarget)) return
      hide()
    }
    const onFocus = (e: FocusEvent): void => {
      const host = e.target instanceof HTMLElement ? e.target.closest('[data-tip]') : null
      const el = host instanceof HTMLElement ? host : null
      if (el === cur) return
      window.clearTimeout(timer)
      cur = el
      if (el) plan(el)
      else if (!tipRef.current) setTip(null)
    }

    // 滚动/点按/按键/切窗都收摊:目标一旦位移或交互,悬着的提示就是陈账
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('mousedown', hide)
    document.addEventListener('wheel', hide, true)
    window.addEventListener('blur', hide)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('mousedown', hide)
      document.removeEventListener('wheel', hide, true)
      window.removeEventListener('blur', hide)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div
      key={tip.id}
      ref={bubbleCb}
      role="tooltip"
      className="tip-bubble"
      data-side={pos?.side ?? tip.side}
      style={{
        left: pos ? `${pos.x}px` : '-9999px',
        top: pos ? `${pos.y}px` : '-9999px',
        visibility: pos ? 'visible' : 'hidden',
        ['--arrow' as string]: pos ? `${pos.arrow}px` : undefined
      }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
