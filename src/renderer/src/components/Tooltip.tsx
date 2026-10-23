import { useCallback, useEffect, useRef, useState } from 'react'
import { OVERLAY_EDGE_FALLBACK_PX, readTokenPx } from '../overlayLayout'

/**
 * 全局轻提示(全局规矩「只定义一次」):全场悬停提示的唯一登记。
 * 元素挂 data-tip="文案" 即得(多行用 \n);data-tip-side 指方位,默认 bottom;
 * data-tip-anchor="选择器" 可改锚到内部元素(如文件名末端,不贴行尾)。
 * data-tip-group="组名" 挂在元素或祖先上 = 圈成「提示组」:组是一片区域不是一个点,
 * 成员间游走即时接力(自定义大延迟也吃),行间缝/组内空白不关闭;进组第一颗才按自己的延迟亮。
 * 气泡 position:absolute 渲染在 .app 内(JSX 原位)——这扇窗是透明玻璃窗,
 * Chromium 会把「不在不透明面内」的根层 fixed 件裁掉不画(命中测试活着、像素为零),
 * 浮层一律走 absolute+锚 .app(与 ws-menu 等浮层同一条已验证的路);
 * .app overflow:hidden 正好把气泡裁在窗框圆角内,坐标换算补 offsetParent 原点差。
 * pointer-events 永不吃鼠标。原生 title 已全场退役:样式不可控、不能预览。
 */

type TipSide = 'right' | 'left' | 'bottom' | 'top'

interface TipTarget {
  /** 每次亮相自增:key 挂它,气泡换目标就重挂载重适配估算寸 */
  id: number
  el: HTMLElement
  text: string
  side: TipSide
  /** 提示组登记(元素或祖先的 data-tip-group);空串/没挂 = null 散兵 */
  group: string | null
}

interface TipPos {
  x: number
  y: number
  side: TipSide
  /** 小尾巴在气泡沿上的位置(右侧出=距气泡顶;下方出=距气泡左),px */
  arrow: number
}

/** 悬停多久才亮提示:读元素的 --tip-delay token(tokens.css 全场统一 1s);
 *  个别元素要不同延迟,在它自己的 CSS 里局部改这变量。
 *  变量读不出来/写坏了回 1000ms 兜底(与 token 同值) */
const FALLBACK_DELAY_MS = 1000

function tipDelayOf(el: HTMLElement, view: Window): number {
  const raw = view.getComputedStyle(el).getPropertyValue('--tip-delay').trim()
  const v = Number.parseFloat(raw)
  if (!Number.isFinite(v) || v < 0) return FALLBACK_DELAY_MS
  return raw.endsWith('ms') ? v : v * 1000
}
/** 气泡与目标之间的缝:小尾巴约占 --space-2,再留 --space-1 视觉缝,合计 --space-3 */
const TIP_GAP_FALLBACK_PX = 12

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** 元素归哪个提示组:自己或最近祖先身上的 data-tip-group;空串/没挂 = 散兵(null) */
function groupOf(el: Element | null): string | null {
  const g = el?.closest('[data-tip-group]')?.getAttribute('data-tip-group')
  return g || null
}

function readTip(el: HTMLElement): TipTarget | null {
  const text = el.dataset.tip
  if (!text) return null
  const side = el.dataset.tipSide
  return {
    id: 0,
    el,
    text,
    side: side === 'right' || side === 'left' || side === 'top' ? side : 'bottom',
    group: groupOf(el)
  }
}

/** 锚矩形:默认取元素自身;data-tip-anchor 给了选择器就锚到内部那个子元素 */
function anchorRect(el: HTMLElement): DOMRect {
  const sel = el.dataset.tipAnchor
  const inner = sel ? el.querySelector(sel) : null
  return (inner ?? el).getBoundingClientRect()
}

/** 按愿望方位摆,摆不下沿「对面→bottom→top」翻;实在全挤就硬压 bottom 加夹子 */
function placeTip(
  r: DOMRect,
  b: DOMRect,
  want: TipSide,
  view: Window,
  edge: number,
  gap: number
): TipPos {
  const vw = view.innerWidth
  const vh = view.innerHeight
  const cy = r.top + r.height / 2
  const cx = r.left + r.width / 2

  const tryAt = (side: TipSide): TipPos | null => {
    if (side === 'right' || side === 'left') {
      const x = side === 'right' ? r.right + gap : r.left - gap - b.width
      if (x < edge || x + b.width > vw - edge) return null
      const y = clamp(cy - b.height / 2, edge, Math.max(edge, vh - edge - b.height))
      return { x, y, side, arrow: clamp(cy - y, gap, b.height - gap) }
    }
    const y = side === 'bottom' ? r.bottom + gap : r.top - gap - b.height
    if (y < edge || y + b.height > vh - edge) return null
    const x = clamp(cx - b.width / 2, edge, Math.max(edge, vw - edge - b.width))
    return { x, y, side, arrow: clamp(cx - x, gap, b.width - gap) }
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
    x: clamp(cx - b.width / 2, edge, Math.max(edge, vw - edge - b.width)),
    y: clamp(r.bottom + gap, edge, Math.max(edge, vh - edge - b.height)),
    side: 'bottom',
    arrow: b.width / 2
  }
}

let tipSeq = 0

/**
 * 一台提示台只管一个 document(页签独立窗口·渲染域隔离):主窗一台,每扇子窗
 * 在自己的 .app 里再挂一台 —— Portal 渲染的组件跑的还是主 realm,监听挂全局
 * document 会只听见主窗的动静,子窗里的悬停提示就聋了。
 */
export function TooltipHost({ doc = document }: { doc?: Document }): React.JSX.Element | null {
  const [tip, setTip] = useState<TipTarget | null>(null)
  const [pos, setPos] = useState<TipPos | null>(null)
  /** 当前目标的事件通路镜像:渲染期不碰 ref,只在监听回调里读写 */
  const tipRef = useRef<TipTarget | null>(null)
  const view = doc.defaultView ?? window

  // 气泡挂载时适配估算寸算落位(setState 在 ref 回调里写是官方认可的测量姿势)。
  // key=tip.id → 换目标就重挂载重测量;卸载回调也走这里,归 null。
  const bubbleCb = useCallback(
    (b: HTMLDivElement | null) => {
      const t = tipRef.current
      if (!b || !t) {
        setPos(null)
        return
      }
      const edge = readTokenPx(b, view, '--overlay-edge', OVERLAY_EDGE_FALLBACK_PX)
      const gap = readTokenPx(b, view, '--space-3', TIP_GAP_FALLBACK_PX)
      const p = placeTip(anchorRect(t.el), b.getBoundingClientRect(), t.side, view, edge, gap)
      // absolute 的定位基准是 .app 内缘(offsetParent 内容盒),视口坐标减它
      const host = b.offsetParent as HTMLElement | null
      if (host) {
        const hr = host.getBoundingClientRect()
        const hs = getComputedStyle(host)
        p.x -= hr.left + (parseFloat(hs.borderLeftWidth) || 0)
        p.y -= hr.top + (parseFloat(hs.borderTopWidth) || 0)
      }
      setPos(p)
    },
    [view]
  )

  useEffect(() => {
    let timer = 0
    let cur: HTMLElement | null = null

    const show = (t: TipTarget): void => {
      // 亮相前最后查一次岗:预约时没拖,开火时拖起来了也拦得住(预约在阈值前、开火在拖拽中)
      if (doc.body.classList.contains('is-tab-dragging')) return
      t.id = ++tipSeq
      tipRef.current = t
      setTip(t)
    }
    const hide = (): void => {
      view.clearTimeout(timer)
      cur = null
      tipRef.current = null
      setTip(null)
    }

    const plan = (el: HTMLElement): void => {
      // 页签拖拽中禁亮:指针捕获把 mouseover 全路由给源签,
      // 不拦的话按住拖一会儿提示又冒出来(小葵截图里的悬浮气泡)
      if (doc.body.classList.contains('is-tab-dragging')) return
      const t = readTip(el)
      if (!t) return
      // 已亮着 → 即时换手(VS Code 同款):延迟只管「从无到有的第一颗」,串门不收不等
      if (tipRef.current !== null) show(t)
      else timer = view.setTimeout(() => show(t), tipDelayOf(el, view))
    }

    const onOver = (e: MouseEvent): void => {
      const host = (e.target as Element | null)?.closest?.('[data-tip]')
      const el = host instanceof HTMLElement ? host : null
      if (el === cur) return
      // 指针掠过同组区域里没有 data-tip 的缝(行间 margin/组内空白):不算离开 ——
      // 保持旧目标与热账,等下一颗接力;出了组区域才算真走
      const overEl = e.target instanceof Element ? e.target : null
      if (el === null && tipRef.current?.group != null && groupOf(overEl) === tipRef.current.group)
        return
      view.clearTimeout(timer)
      cur = el
      if (el) plan(el)
      else if (!tipRef.current) setTip(null)
    }
    const onOut = (e: MouseEvent): void => {
      // 在宿主内部移动(child→child)不算离开;relatedTarget 出了宿主才收
      if (cur && e.relatedTarget instanceof Node && cur.contains(e.relatedTarget)) return
      // 出了宿主还在同组区域内(行间缝):不关闭,留给下一颗接力
      const rt = e.relatedTarget
      if (
        tipRef.current?.group != null &&
        rt instanceof Element &&
        groupOf(rt) === tipRef.current.group
      )
        return
      hide()
    }
    const onFocus = (e: FocusEvent): void => {
      const host = e.target instanceof HTMLElement ? e.target.closest('[data-tip]') : null
      const el = host instanceof HTMLElement ? host : null
      if (el === cur) return
      view.clearTimeout(timer)
      cur = el
      if (el) plan(el)
      else if (!tipRef.current) setTip(null)
    }

    // 滚动/点按/按键/切窗都关闭:目标一旦位移或交互,悬着的提示就是陈账
    doc.addEventListener('mouseover', onOver)
    doc.addEventListener('mouseout', onOut)
    doc.addEventListener('focusin', onFocus)
    doc.addEventListener('focusout', hide)
    doc.addEventListener('scroll', hide, true)
    doc.addEventListener('mousedown', hide)
    doc.addEventListener('wheel', hide, true)
    // 页签拖拽开工清场:按住页签熬满延迟刚亮、紧跟着拖起来的那颗提示靠它收
    // (捕获期 mouseout 全部回退到源签,常规关闭链路在拖拽中收不到事件)
    doc.addEventListener('atlas:tab-drag-start', hide)
    view.addEventListener('blur', hide)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    doc.addEventListener('keydown', onKey)
    return () => {
      view.clearTimeout(timer)
      doc.removeEventListener('mouseover', onOver)
      doc.removeEventListener('mouseout', onOut)
      doc.removeEventListener('focusin', onFocus)
      doc.removeEventListener('focusout', hide)
      doc.removeEventListener('scroll', hide, true)
      doc.removeEventListener('mousedown', hide)
      doc.removeEventListener('wheel', hide, true)
      doc.removeEventListener('atlas:tab-drag-start', hide)
      view.removeEventListener('blur', hide)
      doc.removeEventListener('keydown', onKey)
    }
  }, [doc, view])

  if (!tip) return null
  return (
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
    </div>
  )
}
