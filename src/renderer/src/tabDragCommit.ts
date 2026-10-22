// 页签拖拽落账:把「落哪儿」翻译成一次页签移动,跨窗时顺手把目标窗带到前台。
import type { PaneGroup, PaneTab } from './paneTabs'
import type { DragZone } from './tabDragTypes'

/** 跨窗落账后把目标窗带到前台(Chrome 同款);主窗也走主进程 focus,renderer 的 window.focus() 不保证生效 */
export function focusWindow(host: string): void {
  window.atlas.auxWindowOp(host, 'focus')
}

/**
 * 落点 → 页签移动。本窗内插队/拆栏交 moveTab,跨窗交给主进程侧登记的 onMoveTabToHostAt。
 * 缝的序号按剔除被拖签的可见序给;落进全量数组前把隐藏签占位折回去,
 * 空锚 = 落到末尾(可见索引直接当全量索引用会插错位)。
 */
export function commitDropZone(
  zone: DragZone,
  input: {
    srcGroupId: string | null
    tabId: string
    groups: PaneGroup[]
    visibleOfGroup: (g: PaneGroup | null) => PaneTab[]
    moveTab: (
      id: string,
      toGroup: 'sibling' | null,
      atIndex: number | null,
      splitSide?: 'left' | 'right'
    ) => void
    onMoveTabToHostAt: (
      id: string,
      host: string,
      groupId: string | null,
      atIndex: number | null
    ) => void
  }
): void {
  const { srcGroupId, tabId, groups, visibleOfGroup, moveTab, onMoveTabToHostAt } = input

  if (zone.type === 'strip') {
    const dst = groups.find((g) => g.id === zone.groupId)
    if (!dst) return
    const vis = visibleOfGroup(dst).filter((x) => x.id !== tabId)
    const anchorId = vis[zone.index]?.id
    const pool = dst.tabs.filter((x) => x.id !== tabId)
    const at = anchorId === undefined ? null : pool.findIndex((x) => x.id === anchorId)
    moveTab(tabId, zone.groupId === srcGroupId ? null : 'sibling', at === -1 ? null : at)
    return
  }
  if (zone.type === 'pane') {
    moveTab(tabId, 'sibling', null, zone.zone)
    return
  }
  if (zone.type === 'host-strip') {
    onMoveTabToHostAt(tabId, zone.host, zone.groupId, zone.index)
    focusWindow(zone.host)
    return
  }
  if (zone.type === 'host-body') {
    onMoveTabToHostAt(tabId, zone.host, zone.groupId, null)
    focusWindow(zone.host)
  }
}
