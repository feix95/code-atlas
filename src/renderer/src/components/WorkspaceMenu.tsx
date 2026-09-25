// 工作区菜单(UI v3 §7.1):浮层挂在 workspace 卡下沿,pin 区置顶 + 历史区(最多 5 条),
// 两区去重、条目单行路径文本。点条目 = 开为工作区;行首 pin 图标悬停显形(pin↔pin-off
// 互换),行尾 × 悬停显形、单击即删无撤销;↑↓ 方向键移动高亮 + Enter 进入(按键由 workspace
// 卡的路径输入框转进来 —— 焦点始终在输入框,地址栏手感)。
// 菜单为纯工作区列表,无功能行(「打开项目」入口整体移除)。
import type { RecentProject } from '../recents'
import { TreeIcon } from './Icons'

interface WorkspaceMenuProps {
  pinned: RecentProject[]
  history: RecentProject[]
  /** 键盘高亮的行号(-1 = 还没按过方向键;鼠标悬停高亮交给 CSS) */
  highlight: number
  onOpen: (path: string) => void
  onTogglePin: (path: string) => void
  onRemove: (path: string) => void
}

export function WorkspaceMenu({
  pinned,
  history,
  highlight,
  onOpen,
  onTogglePin,
  onRemove
}: WorkspaceMenuProps): React.JSX.Element {
  // 行号 = 平铺顺序(pin 区在前、历史区接后)的下标,和调用方 ↑↓ 记账的 flatRows 一致
  function renderRow(r: RecentProject, idx: number): React.JSX.Element {
    const mine = idx === highlight
    const isPinned = r.pin !== undefined
    return (
      <div
        key={r.p}
        className={`wsm-row${mine ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}`}
        role="option"
        aria-selected={mine}
      >
        {/* 行首 pin 钮:未 pin 条目悬停才显形(路径右移让位),已 pin 常驻、悬停换成 pin-off */}
        <button
          type="button"
          className="wsm-pin"
          aria-label={isPinned ? `取消固定 ${r.p}` : `固定 ${r.p} 到列表顶部`}
          data-tip={isPinned ? '取消固定' : '固定到列表顶部'}
          data-tip-side="right"
          onClick={() => onTogglePin(r.p)}
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
          onClick={() => onOpen(r.p)}
          data-tip={r.p}
          data-tip-side="right"
        >
          <span className="wsm-path">{r.p}</span>
        </button>
        {/* 行尾 × 即删(§7.1 拍板:删了就是删了,无撤销) */}
        <button
          type="button"
          className="wsm-del"
          aria-label={`从列表删掉 ${r.p}`}
          data-tip="从列表删掉,不动磁盘上的文件夹"
          data-tip-side="right"
          onClick={() => onRemove(r.p)}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    // 点击冒泡会落回 ws-card 的「点卡开菜单」把手(openMenu 重置键盘高亮),菜单内一切点击拦在这里
    <div
      id="ws-menu"
      className="ws-menu"
      role="listbox"
      aria-label="打开过的工作区"
      onClick={(e) => e.stopPropagation()}
    >
      {pinned.length === 0 && history.length === 0 ? (
        <p className="wsm-empty">打开过的项目会列在这里。</p>
      ) : (
        <>
          {pinned.map((r, i) => renderRow(r, i))}
          {pinned.length > 0 && history.length > 0 && (
            <div className="wsm-sep" aria-hidden="true" />
          )}
          {history.map((r, i) => renderRow(r, pinned.length + i))}
        </>
      )}
    </div>
  )
}
