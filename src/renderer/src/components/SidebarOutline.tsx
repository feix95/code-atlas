// 左栏里的大纲:停靠位那张签的标题清单;外壳(分割线、标题条、拖出小牌)与图谱详情共用。
// 条目本身是真按钮:Tab 能走到、Enter/空格就跳。
import { useSyncExternalStore } from 'react'
import { outlineDepths } from '../docOutline'
import {
  getOutlineDocked,
  getOutlineSnapshot,
  setOutlineDocked,
  subscribeOutlineDocked,
  subscribeOutlineSnapshot,
  type OutlineSnapshot
} from '../outlineDock'
import { getSidebarDockState, subscribeSidebarDock } from '../sidebarDock'
import { SidebarDockSection } from './SidebarDockSection'

/** 停靠位那张签的大纲;不在停靠态、左栏不能用、这签没有标题 → 什么都不画 */
export function SidebarOutline({ ownerId }: { ownerId: string | null }): React.JSX.Element | null {
  const docked = useSyncExternalStore(subscribeOutlineDocked, getOutlineDocked)
  const { hostUsable } = useSyncExternalStore(subscribeSidebarDock, getSidebarDockState)
  const snap = useSyncExternalStore(subscribeOutlineSnapshot, () => getOutlineSnapshot(ownerId))
  if (!docked || !hostUsable || !snap) return null
  return <DockedOutline snapshot={snap} />
}

function DockedOutline({ snapshot }: { snapshot: OutlineSnapshot }): React.JSX.Element {
  const { items, activeId, jumpTo } = snapshot
  const depths = outlineDepths(items)
  return (
    <SidebarDockSection
      title="大纲"
      label="文档大纲"
      undockLabel="把大纲放回浮窗,也可以按住标题条拖出左栏"
      onUndock={() => setOutlineDocked(false)}
    >
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
    </SidebarDockSection>
  )
}
