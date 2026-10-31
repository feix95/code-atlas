// 左栏里的停靠块外壳(大纲与图谱节点详情共用):与文件树合成一块面板,中间只有一条分割线,
// 拖它分上下比例(双击回内容自适应);标题条按住拖出左栏(指针跨过分界线时露出小牌),松手就放回浮窗;
// 右上角放回钮给键盘用,可另配一颗关闭钮。正文自己滚,高度由拖线分配。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isDragStarted } from '../floatPlacement'
import { clampDockRatio, getSidebarDockRatio, saveSidebarDockRatio } from '../sidebarDock'
import { TreeIcon } from './Icons'

/** 标题条上的图标(14px) */
const HEAD_ICON_SIZE = 14

/** 分割条上方向键一步挪多少(px):与左栏宽度的分割条同档 */
const SASH_STEP = 24

/** 停靠块参与分高度的那层容器:图谱详情经 display:contents 的槽位画进来,槽位量不出高度,往上找第一个有盒子的父级 */
function dockRoomOf(section: HTMLElement): number {
  let el: HTMLElement | null = section.parentElement
  while (el && el.clientHeight <= 0) el = el.parentElement
  return el?.clientHeight ?? 0
}

export function SidebarDockSection({
  title,
  label,
  undockLabel,
  onUndock,
  onClose,
  head,
  children
}: {
  /** 标题条上的名字,也是拖出左栏时小牌上的字 */
  title: string
  /** 整块的读屏名 */
  label: string
  /** 放回钮的读屏名(顺带说明可以拖标题条) */
  undockLabel: string
  onUndock: () => void
  /** 传了就在放回钮右边多一颗关闭钮 */
  onClose?: () => void
  /** 自定义标题条内容:传了就不再画默认的标题与放回/关闭钮,放回钮由它自己画;拖动仍归外壳 */
  head?: React.ReactNode
  /** 正文:自己滚,撑满标题条以下的高度 */
  children: React.ReactNode
}): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null)
  const asideRef = useRef<Element | null>(null)
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const outRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  // 停靠块占左栏可分配高度的比例;null = 按内容自适应(初次停靠就是这个样子)
  const [ratio, setRatio] = useState<number | null>(() => getSidebarDockRatio() || null)
  const sashRef = useRef<{
    id: number
    y: number
    start: number
    room: number
    ratio: number
    moved: boolean
  } | null>(null)
  const [sashDragging, setSashDragging] = useState(false)

  // 拖线拖到一半停靠被撤下(左栏收起、换签):把全局光标状态收干净
  useEffect(() => () => document.body.classList.remove('is-dock-sash-dragging'), [])

  // ---- 分割线:拖它分配文件树与停靠块的比例 ----

  function onSashDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    const section = sectionRef.current
    if (!section) return
    const room = dockRoomOf(section)
    if (room <= 0) return
    e.preventDefault()
    const start = section.getBoundingClientRect().height
    sashRef.current = {
      id: e.pointerId,
      y: e.clientY,
      start,
      room,
      ratio: start / room,
      moved: false
    }
    // 自适应态带着内容高度上限,拖动期间先按手动尺寸算,松手再决定这个类去留
    section.classList.add('is-sized')
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('is-dock-sash-dragging')
    setSashDragging(true)
  }

  function onSashMove(e: React.PointerEvent<HTMLDivElement>): void {
    const d = sashRef.current
    const section = sectionRef.current
    if (!d || d.id !== e.pointerId || !section) return
    const next = clampDockRatio((d.start - (e.clientY - d.y)) / d.room, d.room)
    // 途中只改这一块的高度,正文不跟着重渲
    section.style.height = `${next * 100}%`
    d.ratio = next
    d.moved = true
  }

  function endSashDrag(e: React.PointerEvent<HTMLDivElement>): void {
    const d = sashRef.current
    if (!d || d.id !== e.pointerId) return
    sashRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.classList.remove('is-dock-sash-dragging')
    setSashDragging(false)
    // 只是点了一下没拖:退回自适应,别把起手那一刻的比例记成手动尺寸
    if (!d.moved) {
      if (ratio === null) sectionRef.current?.classList.remove('is-sized')
      return
    }
    setRatio(d.ratio)
    saveSidebarDockRatio(d.ratio)
  }

  function onSashKey(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const section = sectionRef.current
    if (!section) return
    const room = dockRoomOf(section)
    if (room <= 0) return
    const moved = section.offsetHeight + (e.key === 'ArrowUp' ? SASH_STEP : -SASH_STEP)
    const next = clampDockRatio(moved / room, room)
    setRatio(next)
    saveSidebarDockRatio(next)
  }

  function resetSash(): void {
    setRatio(null)
    saveSidebarDockRatio(0)
  }

  // ---- 标题条:按住拖出左栏 = 放回浮窗 ----

  function onPointerDown(e: React.PointerEvent<HTMLElement>): void {
    if (e.button !== 0 || (e.target as Element).closest('button')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    asideRef.current = e.currentTarget.closest('.sidebar')
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    outRef.current = false
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>): void {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    if (!dragging && !isDragStarted(e.clientX - d.x, e.clientY - d.y)) return
    setDragging(true)
    const r = asideRef.current?.getBoundingClientRect()
    const outside = r ? e.clientX >= r.right || e.clientY < r.top || e.clientY > r.bottom : false
    outRef.current = outside
    setGhost(outside ? { x: e.clientX, y: e.clientY } : null)
  }

  function finish(e: React.PointerEvent<HTMLElement>, commit: boolean): void {
    if (dragRef.current?.id !== e.pointerId) return
    dragRef.current = null
    asideRef.current = null
    setDragging(false)
    setGhost(null)
    const back = commit && outRef.current
    outRef.current = false
    if (back) onUndock()
  }

  const headClass = `sidebar-dock-head${head === undefined ? '' : ' is-custom'}${dragging ? ' is-dragging' : ''}`
  const headHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => finish(e, true),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => finish(e, false),
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => finish(e, false)
  }

  return (
    <>
      <div
        className={`sidebar-dock-sash${sashDragging ? ' is-dragging' : ''}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label="文件树与停靠面板的分割线:拖动分配上下高度,双击恢复自适应"
        tabIndex={0}
        onPointerDown={onSashDown}
        onPointerMove={onSashMove}
        onPointerUp={endSashDrag}
        onPointerCancel={endSashDrag}
        onDoubleClick={resetSash}
        onKeyDown={onSashKey}
      />
      <section
        className={`sidebar-dock${ratio === null ? '' : ' is-sized'}`}
        ref={sectionRef}
        style={ratio === null ? undefined : { height: `${ratio * 100}%` }}
        aria-label={label}
      >
        {head === undefined ? (
          <header className={headClass} {...headHandlers}>
            <span className="sidebar-dock-title">{title}</span>
            <button
              type="button"
              className="sidebar-dock-undock"
              aria-label={undockLabel}
              data-tip="放回浮窗"
              data-tip-side="top"
              onClick={onUndock}
            >
              <TreeIcon name="appWindow" size={HEAD_ICON_SIZE} mono />
            </button>
            {onClose && (
              <button
                type="button"
                className="sidebar-dock-close"
                aria-label="关闭详情"
                data-tip="关闭详情"
                data-tip-side="top"
                onClick={onClose}
              >
                <TreeIcon name="x" size={HEAD_ICON_SIZE} mono />
              </button>
            )}
          </header>
        ) : (
          <div className={headClass} {...headHandlers}>
            {head}
          </div>
        )}
        {children}
      </section>
      {ghost &&
        createPortal(
          <div
            className="sidebar-dock-ghost"
            style={{ left: ghost.x, top: ghost.y }}
            aria-hidden="true"
          >
            {title}
          </div>,
          document.body
        )}
    </>
  )
}
