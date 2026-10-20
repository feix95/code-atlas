// 工作区菜单(UI v3 §7.1):浮层挂在 workspace 卡下沿 —— 上区 pin 置顶 + 历史区(最多 5 条),
// 分隔线下常驻一条「我的电脑」,点了回这台电脑、文件树给盘符列;条目单行路径文本,点开为工作区;
// 行首 pin 图标悬停显形(pin↔pin-off 互换),行尾 × 悬停显形、单击即删无撤销;↑↓ 方向键移动
// 高亮 + Enter 进入(按键由 workspace 卡的路径输入框转进来 —— 焦点始终在输入框,地址栏手感;
// 键盘高亮只记工作区条目,「我的电脑」走点击)。
// 路径行悬停(或键盘高亮)时慢速右滚露出完整路径,移开快速归位;装得下的短路径不动。
// 底边可向下拖高(只在本次打开期间有效),拖到头正好看全所有条目,不留空白。
import { useEffect, useRef, useState } from 'react'
import { marqueePlan } from '../marquee'
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

/** 悬停后等 pin 滑入动画(--dur-2 = 0.15s)落定再量宽:
 * 量早了会把让给 pin 的那段宽度算进可视区,滚到底时末尾仍差一截 */
const MEASURE_DELAY_MS = 180

interface WorkspaceRowProps {
  project: RecentProject
  /** 键盘高亮:与悬停共用同一套让位与滚动 */
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
  // 指针悬停或焦点落在行内:两者都要触发让位与滚动
  const [isEngaged, setIsEngaged] = useState(false)
  const isPinned = project.pin !== undefined
  const isHot = isEngaged || isActive

  // 位移与两段时长直接写成 CSS 变量,动画交给合成器,React 不参与逐帧。
  // 先等让位动画(--dur-2)落定再量宽:量早了会把让给 pin 的宽度算进可视区,末尾永远差一截。
  // 移开即摘标记与变量,transform 回 0、时长换回 CSS 里的短档,从当前位置快速倒回。
  useEffect(() => {
    const row = rowRef.current
    const clip = clipRef.current
    const path = pathRef.current
    if (!row || !clip || !path) return

    if (!isHot) {
      // 摘掉标记与位移:transform 回 0,基础过渡时长(--wsm-back)负责快速倒回
      row.removeAttribute('data-marquee')
      row.style.removeProperty('--wsm-shift')
      return
    }

    const timer = window.setTimeout(() => {
      const plan = marqueePlan(
        path.getBoundingClientRect().width,
        clip.getBoundingClientRect().width
      )
      // 装得下的短路径不滚,保持静止
      if (!plan) return
      row.style.setProperty('--wsm-shift', `${plan.shift}px`)
      row.style.setProperty('--wsm-dur', `${plan.durMs}ms`)
      row.style.setProperty('--wsm-back', `${plan.rewindMs}ms`)
      row.setAttribute('data-marquee', '')
    }, MEASURE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [isHot, project.p])

  return (
    <div
      ref={rowRef}
      className={`wsm-row${isActive ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}`}
      role="option"
      aria-selected={isActive}
      onPointerEnter={() => setIsEngaged(true)}
      onPointerLeave={() => setIsEngaged(false)}
      onFocus={() => setIsEngaged(true)}
      onBlur={(event) => {
        // 焦点在行内 pin / × 之间移动不算离开
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsEngaged(false)
      }}
    >
      {/* 行首 pin 钮:未 pin 条目悬停才显形(路径右移让位),已 pin 常驻、悬停换成 pin-off */}
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
      {/* 行尾 × 即删(§7.1 拍板:删了就是删了,无撤销) */}
      <button
        type="button"
        className="wsm-del"
        aria-label={`从列表删掉 ${project.p}`}
        data-tip="从列表删掉,不动磁盘上的文件夹"
        data-tip-side="right"
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
