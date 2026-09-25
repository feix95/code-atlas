// 顶栏页签区(UI v3 · §5.1 Chrome 式):每个页签组一条胶囊带,
// 条带与下方分屏列一一对齐 —— 第一组按 paneSplit 占宽,
// 两组之间的细柱 = 下方分割条中线的上延。
// 几何账:顶栏页签区比内容列窄一个窗控块(9rem)、起点早半个 sash(0.15625rem),
// 折成 「组宽% + 9×占比 rem + 常量 rem」 的纯加减式,calc 不碰乘法。
import { Fragment } from 'react'
import type { PaneGroup, PaneTab } from '../paneTabs'
import type { PaneKind } from '../paneKinds'
import { TabBar } from './TabBar'

/** 窗控三键总宽 9rem:页签区右端比内容列右端短这么一截,对齐账里要补回来 */
const WIN_CTL_REM = 9

export function TopBarTabs({
  groups,
  visibleOfGroup,
  flashTabId,
  activateTab,
  closeTab,
  pinToggleTab,
  moveTab,
  setDraggingTab,
  onTabDragEnd,
  onDetachTab,
  enabledKinds,
  toggleKind,
  paneSplit,
  sidebarCollapsed
}: {
  groups: PaneGroup[]
  visibleOfGroup: (g: PaneGroup | null) => PaneTab[]
  flashTabId: string | null
  activateTab: (id: string) => void
  closeTab: (id: string) => void
  pinToggleTab: (id: string) => void
  moveTab: (id: string, toGroup: 'sibling' | null, atIndex: number | null) => void
  setDraggingTab: React.Dispatch<React.SetStateAction<string | null>>
  onTabDragEnd: (id: string) => void
  onDetachTab: (id: string) => void
  enabledKinds: Set<PaneKind>
  toggleKind: (kind: PaneKind, on: boolean) => void
  /** 第一组分屏列占内容宽的比例(usePaneTabs 的账本,顶部条带认同一份) */
  paneSplit: number
  sidebarCollapsed: boolean
}): React.JSX.Element {
  // 第一组条带宽 = paneSplit × 内容列宽。用页签区宽当分母折回:
  //   条带宽 = 占比 × (页签区宽 + 窗控宽 − 起点差) + 起点差
  // 起点差 = sash 半宽 0.15625rem(侧栏收起时页签区与内容列同起点,差为 0)
  const off = sidebarCollapsed ? 0 : 0.15625 * (1 - paneSplit)
  const firstBasis = `calc(${(paneSplit * 100).toFixed(3)}% + ${(WIN_CTL_REM * paneSplit).toFixed(4)}rem + ${off.toFixed(4)}rem)`
  return (
    <>
      {groups.map((g, gi) => (
        <Fragment key={g.id}>
          {gi > 0 && <div className="topbar-split" aria-hidden="true" />}
          <div
            className="topbar-strip"
            style={groups.length === 2 && gi === 0 ? { flex: `0 0 ${firstBasis}` } : undefined}
          >
            <TabBar
              tabs={visibleOfGroup(g)}
              activeId={g.activeId}
              flashId={flashTabId}
              canMoveToSiblingGroup={groups.length > 1}
              onActivate={activateTab}
              onClose={closeTab}
              onPinToggle={pinToggleTab}
              onMoveTab={moveTab}
              onDragTab={setDraggingTab}
              onTabDragEnd={onTabDragEnd}
              onDetachTab={onDetachTab}
              enabledKinds={enabledKinds}
              onToggleKind={toggleKind}
            />
          </div>
        </Fragment>
      ))}
    </>
  )
}
