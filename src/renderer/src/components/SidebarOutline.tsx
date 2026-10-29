// 左栏里的大纲:停靠后与文件树合成一块面板,中间只有一条分割线,拖它分上下比例(双击回内容自适应)。
// 标题条按住拖出左栏(指针跨过分界线时露出小牌),松手就放回浮窗;右上角放回钮给键盘用。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { outlineDepths } from '../docOutline'
import { isDragStarted } from '../outlinePlacement'
import {
  clampDockRatio,
  getOutlineDockRatio,
  getOutlineDockState,
  getOutlineSnapshot,
  saveOutlineDockRatio,
  setOutlineDocked,
  subscribeOutlineDock,
  subscribeOutlineSnapshot,
  type OutlineSnapshot
} from '../outlineDock'
import { TreeIcon } from './Icons'

/** 放回钮图标(14px) */
const UNDOCK_ICON_SIZE = 14

/** 分割条上方向键一步挪多少(px):与左栏宽度的分割条同档 */
const SASH_STEP = 24

/** 停靠位那张签的大纲;不在停靠态、左栏不能用、这签没有标题 → 什么都不画 */
export function SidebarOutline({ ownerId }: { ownerId: string | null }): React.JSX.Element | null {
  const { docked, hostUsable } = useSyncExternalStore(subscribeOutlineDock, getOutlineDockState)
  const snap = useSyncExternalStore(subscribeOutlineSnapshot, () => getOutlineSnapshot(ownerId))
  if (!docked || !hostUsable || !snap) return null
  return <DockedOutline snapshot={snap} />
}

function DockedOutline({ snapshot }: { snapshot: OutlineSnapshot }): React.JSX.Element {
  const { items, activeId, jumpTo } = snapshot
  const depths = outlineDepths(items)
  const sectionRef = useRef<HTMLElement>(null)
  const asideRef = useRef<Element | null>(null)
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const outRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  // 大纲占左栏可分配高度的比例;null = 按内容自适应(初次停靠就是这个样子)
  const [ratio, setRatio] = useState<number | null>(() => getOutlineDockRatio() || null)
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
  useEffect(() => () => document.body.classList.remove('is-outline-sash-dragging'), [])

  // ---- 分割线:拖它分配文件树与大纲的比例 ----

  function onSashDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    const section = sectionRef.current
    const room = section?.parentElement?.clientHeight ?? 0
    if (!section || room <= 0) return
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
    document.body.classList.add('is-outline-sash-dragging')
    setSashDragging(true)
  }

  function onSashMove(e: React.PointerEvent<HTMLDivElement>): void {
    const d = sashRef.current
    const section = sectionRef.current
    if (!d || d.id !== e.pointerId || !section) return
    const next = clampDockRatio((d.start - (e.clientY - d.y)) / d.room, d.room)
    // 途中只改这一块的高度,整张大纲列表不跟着重渲
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
    document.body.classList.remove('is-outline-sash-dragging')
    setSashDragging(false)
    // 只是点了一下没拖:退回自适应,别把起手那一刻的比例记成手动尺寸
    if (!d.moved) {
      if (ratio === null) sectionRef.current?.classList.remove('is-sized')
      return
    }
    setRatio(d.ratio)
    saveOutlineDockRatio(d.ratio)
  }

  function onSashKey(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const section = sectionRef.current
    const room = section?.parentElement?.clientHeight ?? 0
    if (!section || room <= 0) return
    const moved = section.offsetHeight + (e.key === 'ArrowUp' ? SASH_STEP : -SASH_STEP)
    const next = clampDockRatio(moved / room, room)
    setRatio(next)
    saveOutlineDockRatio(next)
  }

  function resetSash(): void {
    setRatio(null)
    saveOutlineDockRatio(0)
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
    if (back) setOutlineDocked(false)
  }

  return (
    <>
      <div
        className={`sidebar-outline-sash${sashDragging ? ' is-dragging' : ''}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label="文件树与大纲的分割线:拖动分配上下高度,双击恢复自适应"
        tabIndex={0}
        onPointerDown={onSashDown}
        onPointerMove={onSashMove}
        onPointerUp={endSashDrag}
        onPointerCancel={endSashDrag}
        onDoubleClick={resetSash}
        onKeyDown={onSashKey}
      />
      <section
        className={`sidebar-outline${ratio === null ? '' : ' is-sized'}`}
        ref={sectionRef}
        style={ratio === null ? undefined : { height: `${ratio * 100}%` }}
        aria-label="文档大纲"
      >
        <header
          className={`sidebar-outline-head${dragging ? ' is-dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => finish(e, true)}
          onPointerCancel={(e) => finish(e, false)}
          onLostPointerCapture={(e) => finish(e, false)}
        >
          <span className="sidebar-outline-title">大纲</span>
          <button
            type="button"
            className="sidebar-outline-undock"
            aria-label="把大纲放回浮窗,也可以按住标题条拖出左栏"
            data-tip="放回浮窗"
            data-tip-side="top"
            onClick={() => setOutlineDocked(false)}
          >
            <TreeIcon name="appWindow" size={UNDOCK_ICON_SIZE} mono />
          </button>
        </header>
        <ol className="doc-outline-list sidebar-outline-list">
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                className={`doc-outline-item${item.id === activeId ? ' is-active' : ''}`}
                style={{ '--outline-depth': depths[i] } as React.CSSProperties}
                aria-current={item.id === activeId ? 'location' : undefined}
                onClick={() => jumpTo(item.id)}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ol>
      </section>
      {ghost &&
        createPortal(
          <div className="outline-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
            大纲
          </div>,
          document.body
        )}
    </>
  )
}
