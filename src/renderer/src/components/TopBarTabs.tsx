// 顶栏页签区(UI v3 · §5.1 Chrome 式):每个页签组一条胶囊带,
// 条带与下方分屏列一一对齐 —— 第一组按 paneSplit 占宽,
// 两组之间的细柱 = 下方分割条中线的上延。
// 几何账:顶栏页签区比内容列窄一个窗控块(3×1u);页签区与内容列同起点,
// 折成 「组宽% + 占比×3u」 的纯加减式,窗控宽挂 --u 跟着缩放,不写死 rem。
//
// 拖拽本体(开拖、跟手、让位、跨窗落账)在 useTabDragSession;这里只管摆画。
import { Fragment } from 'react'
import { createPortal } from 'react-dom'
import type { PaneDropMark, PaneGroup, PaneTab } from '../paneTabs'
import { WIN_CTL_U } from '../tabDragTypes'
import type { DragWindowRef } from '../tabDragWindows'
import { useTabDragSession } from '../useTabDragSession'
import { TreeIcon } from './Icons'
import { TabBar } from './TabBar'

export function TopBarTabs({
  groups,
  visibleOfGroup,
  flashTabId,
  activateTab,
  closeTab,
  closeTabsInGroup,
  moveTab,
  setDropMark,
  onTabDragEnd,
  onDetachTab,
  onRevealInTree,
  onTranslate,
  workspaceRoot,
  paneSplit,
  host,
  dragWindows,
  onMoveTabToHostAt
}: {
  groups: PaneGroup[]
  visibleOfGroup: (g: PaneGroup | null) => PaneTab[]
  flashTabId: string | null
  activateTab: (id: string) => void
  closeTab: (id: string) => void
  /** 批量关签(右键「关其他/关右侧/关全部」):一次算清再落账,不循环单关 */
  closeTabsInGroup: (groupId: string, ids: readonly string[]) => void
  /** 挪页签:toGroup 空 = 同组重排,'sibling' = 另一组(单组按 splitSide 拆新组) */
  moveTab: (
    id: string,
    toGroup: 'sibling' | null,
    atIndex: number | null,
    splitSide?: 'left' | 'right'
  ) => void
  setDropMark: React.Dispatch<React.SetStateAction<PaneDropMark | null>>
  /** 拖出本窗松手(页签独立窗口:拆去新子窗,语义由 App 定,这里只报是谁) */
  onTabDragEnd: (id: string) => void
  /** 右键菜单「移到新窗口」:不拖也可拆出,所有签一视同仁 */
  onDetachTab?: (id: string) => void
  /** 右键菜单「在文件列表中显示当前文件」:回侧栏树里指出来(App 的活) */
  onRevealInTree?: (id: string) => void
  /** 右键菜单「翻译成…」:开译文镜像签并自动分屏(App 的活) */
  onTranslate?: (tab: PaneTab, lang: string) => void
  /** 工作区根(文件动作拼路径的底;peek 签自带 scopeRoot 不看它) */
  workspaceRoot?: string | null
  /** 第一组分屏列占内容宽的比例(usePaneTabs 的状态表,顶部条带认同一份) */
  paneSplit: number
  /** 本页签带所在窗的登记名(主窗 'main' / 子窗 'aux-N'):跨窗判定要认自己是谁 */
  host: string
  /** 全部可参与落点的窗(主窗 + 各子窗):拖拽开始时量快照 */
  dragWindows: readonly DragWindowRef[]
  /** 跨窗落账:落到目标窗指定组指定位置(本窗内的移动仍走 moveTab) */
  onMoveTabToHostAt: (
    id: string,
    host: string,
    groupId: string | null,
    atIndex: number | null
  ) => void
}): React.JSX.Element {
  // 第一组条带宽 = paneSplit × 内容列宽。用页签区宽当分母折回:
  // 条带宽 = 占比 × (页签区宽 + 窗控宽)
  const firstBasis = `calc(${(paneSplit * 100).toFixed(3)}% + var(--u) * ${(WIN_CTL_U * paneSplit).toFixed(4)})`

  const { drag, gap, cross, chipRef, beginTabDrag, dragSrcGroupId, chipHidden } = useTabDragSession(
    {
      groups,
      visibleOfGroup,
      moveTab,
      onMoveTabToHostAt,
      onTabDragEnd,
      setDropMark,
      host,
      dragWindows,
      paneSplit
    }
  )

  // 跨窗目标窗的 document:芯片和插入线用 Portal 画进它,坐标已是那扇窗的局部坐标
  const crossWin = cross ? (dragWindows.find((w) => w.host === cross.host)?.win ?? null) : null
  const crossBody = crossWin && !crossWin.closed ? crossWin.document.body : null
  const chipX = cross ? cross.x : (drag?.x ?? 0)
  const chipY = cross ? cross.y : (drag?.y ?? 0)
  const chipEl = drag ? (
    <div
      ref={chipRef}
      className={`tabbar-tab is-chip${drag.phase === 'drag' ? ' is-morph' : ''}${
        drag.phase === 'settle' ? ' is-settle is-tablook' : ''
      }${drag.phase === 'enter' ? ' is-tablook' : ''}${drag.leaving ? ' is-leaving' : ''}${
        drag.phase === 'drag' && drag.willDetach ? ' is-detach' : ''
      }`}
      style={
        drag.phase === 'born'
          ? { left: drag.srcLeft, top: drag.srcTop, width: 'auto', opacity: 0 }
          : drag.phase === 'enter'
            ? {
                left: drag.srcLeft,
                top: drag.srcTop,
                width: drag.width,
                height: drag.height
              }
            : drag.phase === 'settle' && drag.settle
              ? {
                  left: drag.settle.left,
                  top: drag.settle.top,
                  width: drag.settle.width,
                  height: drag.settle.height
                }
              : {
                  left: chipX - drag.grabDx,
                  top: chipY - drag.grabDy,
                  width: drag.compactW,
                  height: drag.compactH,
                  ...(chipHidden ? { opacity: 0 } : {})
                }
      }
      aria-hidden="true"
    >
      <span className="tabbar-icon" aria-hidden="true">
        <TreeIcon name={drag.icon} mono />
      </span>
      <span className="tabbar-name">{drag.name}</span>
    </div>
  ) : null

  return (
    <>
      {groups.map((g, gi) => (
        <Fragment key={g.id}>
          {gi > 0 && <div className="topbar-split" aria-hidden="true" />}
          <div
            className="topbar-strip"
            data-group-id={g.id}
            style={groups.length === 2 && gi === 0 ? { flex: `0 0 ${firstBasis}` } : undefined}
          >
            <TabBar
              tabs={visibleOfGroup(g)}
              activeId={g.activeId}
              flashId={flashTabId}
              canMoveToSiblingGroup={groups.length > 1}
              onActivate={activateTab}
              onClose={closeTab}
              onCloseMany={(ids) => closeTabsInGroup(g.id, ids)}
              onMoveTab={moveTab}
              onDetachTab={onDetachTab}
              onRevealInTree={onRevealInTree}
              onTranslate={onTranslate}
              workspaceRoot={workspaceRoot}
              dragSourceId={drag?.id ?? null}
              gapIndex={
                gap !== null && gap.groupId === g.id && g.id !== dragSrcGroupId ? gap.index : null
              }
              slide={
                drag !== null && drag.phase === 'drag' && g.id === dragSrcGroupId
                  ? {
                      srcId: drag.id,
                      slotLeft: drag.srcLeft,
                      srcW: drag.width,
                      grabDx: drag.grabDx,
                      x: drag.x,
                      idx: gap?.groupId === g.id ? gap.index : null,
                      minL: drag.slideMinL,
                      maxR: drag.slideMaxR
                    }
                  : null
              }
              onTabPointerDown={beginTabDrag}
            />
          </div>
        </Fragment>
      ))}
      {/* 跨窗落点浮层:插入线 / 正文亮边,直接 Portal 进目标窗 body。
          坐标是目标窗局部坐标,pointer-events 全让,不挡命中判定 */}
      {crossBody &&
        cross &&
        cross.kind === 'strip' &&
        cross.lineX !== null &&
        createPortal(
          <i
            className="tab-drop-line"
            style={{ left: cross.lineX, top: cross.lineY ?? 0 }}
            aria-hidden="true"
          />,
          crossBody
        )}
      {crossBody &&
        cross &&
        cross.kind === 'body' &&
        cross.body &&
        createPortal(
          <div
            className="tab-drop-body"
            style={{
              left: cross.body.left,
              top: cross.body.top,
              width: cross.body.width,
              height: cross.body.height
            }}
            aria-hidden="true"
          />,
          crossBody
        )}
      {/* 拖拽替身芯片:fixed 浮层(.tabbar overflow:hidden 会裁掉行内位移的替身),
          抓握偏移让芯片像被指尖拎着;pointer-events 全让,别挡底下落点判定。
          生命周期:born 隐形量紧凑宽 → enter 克隆页签模样出生 →
          drag 收成胶囊跟光标(is-morph 只管尺寸/配色,位置零延迟跟手)→
          settle 飞回落点长回页签(is-settle 连位置一起过渡,落地帧换真身)。
          跨窗时 Portal 进目标窗,坐标换成目标窗局部坐标 */}
      {drag && (crossBody ? createPortal(chipEl, crossBody) : chipEl)}
    </>
  )
}
