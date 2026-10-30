// 图谱详情问「该不该让位给左栏」:与大纲同一套四条判定(停靠开着、左栏能用、同窗、停靠位就是我这签),
// 外带停靠内容要画进去的槽位。子窗没有左栏:那边槽位为空、判定不让位,浮窗永远站岗。
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  getGraphPanelDocked,
  setGraphPanelDocked,
  subscribeGraphPanelDock
} from '../graphPanelDock'
import {
  getSidebarDockHost,
  getSidebarDockSlot,
  getSidebarDockState,
  hidesFloatingDock,
  hitSidebarDock,
  setSidebarDockHot,
  subscribeSidebarDock,
  subscribeSidebarDockSlot,
  type SidebarDropTarget
} from '../sidebarDock'

export function useGraphPanelDock(
  viewRef: React.RefObject<HTMLDivElement | null>,
  /** 这扇图谱的页签 id */
  myTabId: string,
  /** 当前停靠位认的那张签(App 按主窗激活组算) */
  dockedTabId: string | null
): {
  /** 浮窗退场、详情改画进左栏 */
  hidden: boolean
  /** 左栏能收留且这签正是停靠位:浮窗上多一颗停靠钮 */
  canDock: boolean
  dropTarget: SidebarDropTarget | undefined
  /** 停靠内容画进哪块(左栏槽位);子窗里没有 */
  slot: HTMLElement | null
} {
  const docked = useSyncExternalStore(subscribeGraphPanelDock, getGraphPanelDocked)
  const { hostUsable } = useSyncExternalStore(subscribeSidebarDock, getSidebarDockState)
  const slot = useSyncExternalStore(subscribeSidebarDockSlot, getSidebarDockSlot)
  const [sameDoc, setSameDoc] = useState(false)
  // 拆出去的子窗渲染的是同一棵 React 树、另一份 document:那边没有左栏,浮窗永远不下岗
  useLayoutEffect(() => {
    const host = getSidebarDockHost()
    const view = viewRef.current
    setSameDoc(host !== null && view !== null && host.ownerDocument === view.ownerDocument)
  }, [viewRef, myTabId, hostUsable, docked])
  const isOwner = myTabId === dockedTabId
  const usable = hostUsable && sameDoc
  const hidden = hidesFloatingDock({ docked, hostUsable: usable, sameDoc, isOwner })
  const canDock = usable && isOwner && !docked
  const dropTarget = useMemo<SidebarDropTarget | undefined>(
    () =>
      canDock
        ? { hit: hitSidebarDock, onDrop: () => setGraphPanelDocked(true), onHot: setSidebarDockHot }
        : undefined,
    [canDock]
  )
  // 手势半路落点没了(换签、收起左栏、面板拆掉):左栏的落位框也得跟着灭
  useEffect(() => () => setSidebarDockHot(false), [dropTarget])
  return { hidden: hidden && slot !== null, canDock, dropTarget, slot }
}
