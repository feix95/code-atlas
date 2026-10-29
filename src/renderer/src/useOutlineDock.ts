// 浮窗这边问「我该不该让位给左栏」:停靠开着、左栏能用、同一个窗口、当前停靠的正是我这签,才藏。
// 撤走的浮窗不卸 ReadingShell —— 标题照收、滚动照跟,左栏那份大纲吃的是同一份快照。
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  getOutlineDockHost,
  getOutlineDockState,
  hidesFloatingOutline,
  hitOutlineDock,
  setOutlineDockHot,
  setOutlineDocked,
  subscribeOutlineDock,
  type OutlineDropTarget
} from './outlineDock'

export function useOutlineDock(
  viewRef: React.RefObject<HTMLDivElement | null>,
  /** 这扇预览的页签 id;不传 = 没有停靠资格 */
  myTabId: string | undefined,
  /** 当前停靠位认的那张签(App 按主窗激活组算) */
  dockedTabId: string | null
): { hidden: boolean; canDock: boolean; dropTarget: OutlineDropTarget | undefined } {
  const dock = useSyncExternalStore(subscribeOutlineDock, getOutlineDockState)
  const [sameDoc, setSameDoc] = useState(false)
  // 拆出去的子窗渲染的是同一棵 React 树、另一份 document:那边没有左栏,浮窗永远不下岗
  useLayoutEffect(() => {
    const host = getOutlineDockHost()
    const view = viewRef.current
    setSameDoc(host !== null && view !== null && host.ownerDocument === view.ownerDocument)
  }, [viewRef, myTabId, dock.hostUsable, dock.docked])
  const isOwner = myTabId !== undefined && myTabId === dockedTabId
  const usable = dock.hostUsable && sameDoc
  const hidden = hidesFloatingOutline({
    docked: dock.docked,
    hostUsable: usable,
    sameDoc,
    isOwner
  })
  const canDock = usable && isOwner && !dock.docked
  const dropTarget = useMemo<OutlineDropTarget | undefined>(
    () =>
      canDock
        ? { hit: hitOutlineDock, onDrop: () => setOutlineDocked(true), onHot: setOutlineDockHot }
        : undefined,
    [canDock]
  )
  // 手势半路落点没了(换签、收起左栏、面板拆掉):左栏的落位框也得跟着灭
  useEffect(() => () => setOutlineDockHot(false), [dropTarget])
  return { hidden, canDock, dropTarget }
}
