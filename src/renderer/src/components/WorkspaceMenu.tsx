// 工作区菜单(UI v3 §7.1):浮层挂在 workspace 卡下沿 —— 上区 pin 置顶 + 历史区(最多 5 条),
// 分隔线下常驻一条「我的电脑」,点了回这台电脑、文件树给盘符列;条目单行路径文本,点开为工作区;
// 行首 pin 图标悬停显形(pin↔pin-off 互换),行尾 × 悬停显形、单击即删无撤销;↑↓ 方向键移动
// 高亮 + Enter 进入(按键由 workspace 卡的路径输入框转进来 —— 焦点始终在输入框,地址栏手感;
// 键盘高亮只记工作区条目,「我的电脑」走点击)。
// 超长路径平时贴左露出根目录;溢出短则慢滑到末尾,溢出长则两层硬切加微移。
// 装得下的短路径不动。未 pin 行的 pin 叠在文字上,不挤裁切视窗。
// 底边可向下拖高(只在本次打开期间有效),拖到头正好看全所有条目,不留空白。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MARQUEE_CROSSFADE_MS,
  MARQUEE_HOVER_DELAY_MS,
  MARQUEE_TAIL_NUDGE_PX,
  marqueePlan,
  type MarqueePlan
} from '../marquee'
import type { RecentProject } from '../recents'
import { useWorkspaceMenuResize } from '../useWorkspaceMenuResize'
import { TreeIcon } from './Icons'

interface WorkspaceMenuProps {
  pinned: RecentProject[]
  history: RecentProject[]
  /** 键盘高亮的行号(-1 = 还没按过方向键;鼠标悬停高亮交给 CSS) */
  highlight: number
  onOpen: (path: string) => void
  onTogglePin: (path: string) => void
  onRemove: (path: string) => void
  /** 「我的电脑」常驻入口:回家,树区交给「这台电脑」盘符列 */
  onHome: () => void
}

function markOverflow(row: HTMLElement, clip: HTMLElement, path: HTMLElement): void {
  const plan = marqueePlan(path.getBoundingClientRect().width, clip.getBoundingClientRect().width)
  if (!plan) {
    row.removeAttribute('data-overflow')
    row.removeAttribute('data-mode')
    return
  }
  row.setAttribute('data-overflow', '')
  row.setAttribute('data-mode', plan.mode)
}

function applyMarqueeVars(row: HTMLElement, plan: MarqueePlan): void {
  row.style.setProperty('--wsm-shift', `${plan.shift}px`)
  row.style.setProperty('--wsm-dur', `${plan.durMs}ms`)
  row.style.setProperty('--wsm-back', `${plan.rewindMs}ms`)
  row.style.setProperty('--wsm-fade', `${MARQUEE_CROSSFADE_MS}ms`)
  row.style.setProperty('--wsm-nudge', `${MARQUEE_TAIL_NUDGE_PX}px`)
  row.setAttribute('data-mode', plan.mode)
}

interface WorkspaceRowProps {
  project: RecentProject
  /** 键盘高亮:与悬停共用同一套跑马灯 */
  isActive: boolean
  onOpen: (path: string) => void
  onTogglePin: (path: string) => void
  onRemove: (path: string) => void
}

function WorkspaceRow({
  project,
  isActive,
  onOpen,
  onTogglePin,
  onRemove
}: WorkspaceRowProps): React.JSX.Element {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const clipRef = useRef<HTMLSpanElement | null>(null)
  const pathRef = useRef<HTMLSpanElement | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 指针停稳或焦点落在行内才开跑马灯;路过划过不甩
  const [isEngaged, setIsEngaged] = useState(false)
  const isPinned = project.pin !== undefined
  const isHot = isEngaged || isActive

  const isHotRef = useRef(isHot)
  useLayoutEffect(() => {
    isHotRef.current = isHot
  }, [isHot])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  // 绘制前打上 data-overflow,右缘渐隐才跟首帧对齐,不晚一拍才出现。
  // 盯行宽不盯裁切层:未 pin 悬停不再改内边距,侧栏拖宽才重测。
  useLayoutEffect(() => {
    const row = rowRef.current
    const clip = clipRef.current
    const path = pathRef.current
    if (!row || !clip || !path) return
    const measureRest = () => {
      if (isHotRef.current) return
      markOverflow(row, clip, path)
    }
    measureRest()
    const observer = new ResizeObserver(measureRest)
    observer.observe(row)
    return () => observer.disconnect()
  }, [project.p, isPinned])

  // 去程等本帧画完再甩,好让过渡从贴左起跑。未 pin 不再改内边距,裁切宽休息/悬停一致。
  useEffect(() => {
    const row = rowRef.current
    const clip = clipRef.current
    const path = pathRef.current
    if (!row || !clip || !path) return

    if (!isHot) {
      row.removeAttribute('data-marquee')
      markOverflow(row, clip, path)
      return
    }

    // 休息态装得下的短路径不滚
    if (!row.hasAttribute('data-overflow')) return
    const plan = marqueePlan(path.getBoundingClientRect().width, clip.getBoundingClientRect().width)
    if (!plan) return
    applyMarqueeVars(row, plan)
    row.setAttribute('data-marquee', '')
  }, [isHot, project.p, isPinned])

  return (
    <div
      ref={rowRef}
      className={`wsm-row${isActive ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}`}
      role="option"
      aria-selected={isActive}
      onPointerEnter={() => {
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
          <span className="wsm-path wsm-path-tail" aria-hidden="true">
            {project.p}
          </span>
          <span className="wsm-path wsm-path-head" ref={pathRef}>
            {project.p}
          </span>
        </span>
      </button>
      {/* 行尾 × 即删(§7.1 拍板:删了就是删了,无撤销) */}
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

export function WorkspaceMenu({
  pinned,
  history,
  highlight,
  onOpen,
  onTogglePin,
  onRemove,
  onHome
}: WorkspaceMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const resizeRef = useRef<HTMLDivElement | null>(null)
  const resize = useWorkspaceMenuResize(
    menuRef,
    listRef,
    resizeRef,
    `${pinned.length}:${history.length}`
  )
  const hasRows = pinned.length > 0 || history.length > 0

  return (
    // 点击冒泡会落回 ws-card 的「点卡开菜单」把手(openMenu 重置键盘高亮),菜单内一切点击拦在这里
    <div
      id="ws-menu"
      ref={menuRef}
      className="ws-menu"
      role="listbox"
      aria-label="打开过的工作区"
      onClick={(e) => e.stopPropagation()}
    >
      {!hasRows ? (
        <p className="wsm-empty">打开过的项目会列在这里。</p>
      ) : (
        <div className="wsm-list" ref={listRef}>
          {/* 行号 = 平铺顺序(pin 区在前、历史区接后)的下标,和调用方 ↑↓ 记账的 flatRows 一致 */}
          {pinned.map((r, i) => (
            <WorkspaceRow
              key={r.p}
              project={r}
              isActive={i === highlight}
              onOpen={onOpen}
              onTogglePin={onTogglePin}
              onRemove={onRemove}
            />
          ))}
          {pinned.length > 0 && history.length > 0 && (
            <div className="wsm-sep" aria-hidden="true" />
          )}
          {history.map((r, i) => (
            <WorkspaceRow
              key={r.p}
              project={r}
              isActive={pinned.length + i === highlight}
              onOpen={onOpen}
              onTogglePin={onTogglePin}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
      {/* 常驻「我的电脑」(§7.1 拍板):分隔线下固定一条,点了回家、树区给盘符列;
          不归键盘高亮账,鼠标点 */}
      <div className="wsm-sep" aria-hidden="true" />
      <div className="wsm-drives">
        <button
          type="button"
          className="wsm-drive"
          onClick={onHome}
          data-tip="回到这台电脑,文件树给 C:\ D:\ 盘符列"
          data-tip-side="right"
        >
          <TreeIcon name="home" size={13} mono />
          <span className="wsm-path">我的电脑</span>
        </button>
      </div>
      {/* 底边拖拽手柄:平时隐形,悬停亮蓝色功能条;无条目时没有可拉的内容,不出手柄 */}
      {hasRows && (
        <div
          ref={resizeRef}
          className="ws-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖动调整菜单高度,双击恢复默认"
          tabIndex={0}
          {...resize}
        />
      )}
    </div>
  )
}
