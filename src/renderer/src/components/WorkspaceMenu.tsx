// 工作区菜单:浮层挂在 workspace 卡下沿 —— 上区 pin 置顶 + 历史区(最多 5 条),
// 分隔线下常驻一条「我的电脑」,点了回这台电脑、文件树给盘符列;条目单行路径文本,点开为工作区;
// 行首 pin 图标悬停显形(pin↔pin-off 互换),行尾 × 悬停显形、单击即删无撤销;↑↓ 方向键移动
// 高亮 + Enter 进入(按键由 workspace 卡的路径输入框转进来 —— 焦点始终在输入框,地址栏手感;
// 键盘高亮只记工作区条目,「我的电脑」走点击)。
// 超长路径平时贴左露出根目录;溢出则慢滑到末尾。
// 滑到末端先停着;指针离开后再等 5s 收回。再悬停立刻取消倒数,离开后重新计时。
// 停靠账只活在本次菜单打开期间,关掉即卸,下次打开全部贴左。
// 装得下的短路径不动。未 pin 行的 pin 叠在文字上,不挤裁切视窗。
// 底边可向下拖高(只在本次打开期间有效),拖到头正好看全所有条目,不留空白。
import { useCallback, useRef, useState } from 'react'
import type { RecentProject } from '../recents'
import { useWorkspaceMenuResize } from '../useWorkspaceMenuResize'
import { TreeIcon } from './Icons'
import { WorkspaceRow } from './WorkspaceMenuRow'

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
  // 滑到过末端的路径;菜单关掉组件卸载,这张表一起丢
  const [parkedPaths, setParkedPaths] = useState(() => new Set<string>())
  const parkPath = useCallback((path: string) => {
    setParkedPaths((prev) => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }, [])
  const unparkPath = useCallback((path: string) => {
    setParkedPaths((prev) => {
      if (!prev.has(path)) return prev
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }, [])

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
              isParked={parkedPaths.has(r.p)}
              onParked={parkPath}
              onUnparked={unparkPath}
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
              isParked={parkedPaths.has(r.p)}
              onParked={parkPath}
              onUnparked={unparkPath}
              onOpen={onOpen}
              onTogglePin={onTogglePin}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
      {/* 常驻「我的电脑」(拍板):分隔线下固定一条,点了回家、树区给盘符列;
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
