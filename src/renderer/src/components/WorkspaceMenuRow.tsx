// 工作区菜单的一行:路径溢出则慢滑到末尾,指针离开后再等 5s 收回。
// 停靠账由菜单本体记,本文件只管这一行的量宽与定时器。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MARQUEE_HOLD_MS, MARQUEE_HOVER_DELAY_MS, marqueePlan, type MarqueePlan } from '../marquee'
import type { RecentProject } from '../recents'
import { TreeIcon } from './Icons'

function markOverflow(row: HTMLElement, clip: HTMLElement, path: HTMLElement): void {
  const plan = marqueePlan(path.getBoundingClientRect().width, clip.getBoundingClientRect().width)
  if (!plan) {
    row.removeAttribute('data-overflow')
    row.removeAttribute('data-marquee')
    return
  }
  row.setAttribute('data-overflow', '')
}

function applyMarqueeVars(row: HTMLElement, plan: MarqueePlan): void {
  row.style.setProperty('--wsm-shift', `${plan.shift}px`)
  row.style.setProperty('--wsm-dur', `${plan.durMs}ms`)
  row.style.setProperty('--wsm-back', `${plan.rewindMs}ms`)
}

/** 从末端慢滑回左边 */
function rewindToStart(row: HTMLElement, clip: HTMLElement, pathEl: HTMLElement): void {
  row.removeAttribute('data-marquee')
  markOverflow(row, clip, pathEl)
}

/** 把路径停在末端:有溢出才停,装得下则清掉跑马灯 */
function parkAtEnd(row: HTMLElement, clip: HTMLElement, pathEl: HTMLElement): MarqueePlan | null {
  const plan = marqueePlan(pathEl.getBoundingClientRect().width, clip.getBoundingClientRect().width)
  if (!plan) {
    row.removeAttribute('data-overflow')
    row.removeAttribute('data-marquee')
    return null
  }
  row.setAttribute('data-overflow', '')
  applyMarqueeVars(row, plan)
  row.setAttribute('data-marquee', '')
  return plan
}

interface WorkspaceRowProps {
  project: RecentProject
  /** 键盘高亮:与悬停共用同一套跑马灯 */
  isActive: boolean
  /** 本次打开已经滑到过末端,离开后再停 5s 收回 */
  isParked: boolean
  onParked: (path: string) => void
  onUnparked: (path: string) => void
  onOpen: (path: string) => void
  onTogglePin: (path: string) => void
  onRemove: (path: string) => void
}

export function WorkspaceRow({
  project,
  isActive,
  isParked,
  onParked,
  onUnparked,
  onOpen,
  onTogglePin,
  onRemove
}: WorkspaceRowProps): React.JSX.Element {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const clipRef = useRef<HTMLSpanElement | null>(null)
  const pathRef = useRef<HTMLSpanElement | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onUnparkedRef = useRef(onUnparked)
  // 指针停稳或焦点落在行内才开跑马灯;路过划过不甩
  const [isEngaged, setIsEngaged] = useState(false)
  const isPinned = project.pin !== undefined
  const isHot = isEngaged || isActive

  const isHotRef = useRef(isHot)
  const parkedRef = useRef(isParked)
  useLayoutEffect(() => {
    isHotRef.current = isHot
  }, [isHot])
  useLayoutEffect(() => {
    parkedRef.current = isParked
  }, [isParked])
  useLayoutEffect(() => {
    onUnparkedRef.current = onUnparked
  }, [onUnparked])

  const clearHoldTimer = (): void => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  /** 每行最多一个 5s 定时器:先清再开,不会堆。划过立刻清掉,离开再重新计。 */
  const startHoldRewind = (): void => {
    clearHoldTimer()
    if (!parkedRef.current) return
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      if (isHotRef.current) return
      parkedRef.current = false
      const row = rowRef.current
      const clip = clipRef.current
      const path = pathRef.current
      if (row && clip && path) rewindToStart(row, clip, path)
      onUnparkedRef.current(project.p)
    }, MARQUEE_HOLD_MS)
  }

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
      clearHoldTimer()
    }
  }, [])

  // 绘制前打上 data-overflow,右缘渐隐才跟首帧对齐,不晚一拍才出现。
  // 盯行宽不盯裁切层:未 pin 悬停不再改内边距,侧栏拖宽才重测。
  // 已经停在末端的行随宽度改位移,离开后再停 5s 收回。
  useLayoutEffect(() => {
    const row = rowRef.current
    const clip = clipRef.current
    const path = pathRef.current
    if (!row || !clip || !path) return
    const measureRest = () => {
      if (isHotRef.current) return
      if (parkedRef.current) parkAtEnd(row, clip, path)
      else markOverflow(row, clip, path)
    }
    measureRest()
    const observer = new ResizeObserver(measureRest)
    observer.observe(row)
    return () => observer.disconnect()
  }, [project.p, isPinned])

  // 去程等本帧画完再甩。指针还在行上就停在末端;离开后再等 5s 收回。
  useEffect(() => {
    const row = rowRef.current
    const clip = clipRef.current
    const path = pathRef.current
    if (!row || !clip || !path) return

    if (!isHot) {
      if (isParked) startHoldRewind()
      return clearHoldTimer
    }

    clearHoldTimer()
    if (!row.hasAttribute('data-overflow') && !isParked) return
    const plan = parkAtEnd(row, clip, path)
    if (!plan) return
    onParked(project.p)
  }, [isHot, isParked, project.p, isPinned, onParked])

  return (
    <div
      ref={rowRef}
      className={`wsm-row${isActive ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}`}
      role="option"
      aria-selected={isActive}
      onPointerEnter={() => {
        clearHoldTimer()
        if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = setTimeout(() => {
          hoverTimerRef.current = null
          setIsEngaged(true)
        }, MARQUEE_HOVER_DELAY_MS)
      }}
      onPointerLeave={() => {
        if (hoverTimerRef.current !== null) {
          clearTimeout(hoverTimerRef.current)
          hoverTimerRef.current = null
        }
        setIsEngaged(false)
        startHoldRewind()
      }}
      onFocus={() => setIsEngaged(true)}
      onBlur={(event) => {
        // 焦点在行内 pin / × 之间移动不算离开
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsEngaged(false)
      }}
    >
      {/* 行首 pin 钮:未 pin 条目悬停才显形(叠在文字上,不挤视窗),已 pin 常驻、悬停换成 pin-off */}
      <button
        type="button"
        className="wsm-pin"
        aria-label={isPinned ? `取消固定 ${project.p}` : `固定 ${project.p} 到列表顶部`}
        data-tip={isPinned ? '取消固定' : '固定到列表顶部'}
        data-tip-side="right"
        onClick={() => onTogglePin(project.p)}
      >
        <span className="wsm-pin-on" aria-hidden="true">
          <TreeIcon name="pinTack" size={13} mono />
        </span>
        <span className="wsm-pin-off" aria-hidden="true">
          <TreeIcon name="pinOff" size={13} mono />
        </span>
      </button>
      <button
        type="button"
        className="wsm-open"
        onClick={() => onOpen(project.p)}
        data-tip={project.p}
        data-tip-side="right"
      >
        <span className="wsm-clip" ref={clipRef}>
          <span className="wsm-path" ref={pathRef}>
            {project.p}
          </span>
        </span>
      </button>
      {/* 行尾 × 即删(拍板:删了就是删了,无撤销) */}
      <button
        type="button"
        className="wsm-del"
        aria-label={`从列表删掉 ${project.p}`}
        onClick={() => onRemove(project.p)}
      >
        ×
      </button>
    </div>
  )
}
