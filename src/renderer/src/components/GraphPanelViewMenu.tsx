// 节点详情右上角的「显示项」:点开勾掉不想看的区块,菜单不关可以连着勾;
// 按住行上下拖可换位,松手后新顺序同时落到菜单和正文。
// 勾选账与顺序账全局记一份(见 graphPanelSections),浮窗与停靠共用;没内容的区块本来就不渲染。
import { useRef } from 'react'
import { MENU_SEP, openContextMenu, type ContextMenuEntry } from './contextMenuStore'
import {
  getHiddenGraphPanelSections,
  setGraphPanelSectionOrder,
  setGraphPanelSectionVisible,
  showAllGraphPanelSections,
  type GraphPanelKind,
  type GraphPanelSectionDef,
  type GraphPanelSectionId
} from '../graph/graphPanelSections'
import { TreeIcon } from './Icons'

/** 菜单首行的落点比钮底低一点,别贴着边框 */
const MENU_GAP_PX = 4

function menuItems(
  sections: readonly GraphPanelSectionDef[],
  hidden: ReadonlySet<GraphPanelSectionId>,
  available: ReadonlySet<GraphPanelSectionId>
): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = []
  // 不画分组小标题:同一组隔一条分割线就够,不再让人多认一层概念
  let group = sections[0]?.group ?? ''
  for (const section of sections) {
    if (section.group !== group) {
      items.push(MENU_SEP)
      group = section.group
    }
    const canShow = available.has(section.id)
    items.push({
      label: section.label,
      dragId: section.id,
      // 这一类总有这几项:这个节点没内容就摆着但置灰,不藏起来(菜单长度每个节点都一样)
      disabled: !canShow,
      // 置灰行停在关位,和灰拨杆的视觉一致;真实显隐账不动,等有内容时按原样回来
      switchOn: canShow && !hidden.has(section.id),
      run: (nextOn) => setGraphPanelSectionVisible(section.id, nextOn === true)
    })
  }
  if (sections.some((section) => available.has(section.id) && hidden.has(section.id))) {
    items.push(MENU_SEP, { label: '全部显示', run: showAllGraphPanelSections })
  }
  return items
}

export function GraphPanelViewMenu({
  kind,
  sections,
  available
}: {
  kind: GraphPanelKind
  /** 这一类节点全部可选的区块(已按记下的顺序排好) */
  sections: readonly GraphPanelSectionDef[]
  /** 当前节点真有内容、能勾选的区块 */
  available: ReadonlySet<GraphPanelSectionId>
}): React.JSX.Element {
  /** 本钮的落点:拖完重建菜单时原位重开,不换地方 */
  const anchor = useRef<{ x: number; y: number; doc: Document } | null>(null)

  function showMenu(list: readonly GraphPanelSectionDef[]): void {
    const at = anchor.current
    if (!at) return
    openContextMenu({
      x: at.x,
      y: at.y,
      doc: at.doc,
      items: menuItems(list, getHiddenGraphPanelSections(), available),
      compact: true,
      noTips: true,
      onReorder: (ids) => reorder(list, ids)
    })
  }

  /** 只有能勾选的项参与拖动:把这一次的新行序并回整单,原菜单就地按新顺序重开 */
  function reorder(list: readonly GraphPanelSectionDef[], nextOrder: string[]): void {
    const visible = list.filter((section) => available.has(section.id)).map((section) => section.id)
    const allowed = new Set(visible)
    const nextVisible = nextOrder.filter((id): id is GraphPanelSectionId =>
      allowed.has(id as GraphPanelSectionId)
    )
    if (nextVisible.length !== visible.length) return
    const nextOrders = setGraphPanelSectionOrder(kind, visible, nextVisible)
    const rank = new Map(nextOrders[kind].map((id, index) => [id, index]))
    const sorted = [...list].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    showMenu(sorted)
  }

  const open = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    anchor.current = {
      x: rect.left,
      y: rect.bottom + MENU_GAP_PX,
      doc: e.currentTarget.ownerDocument
    }
    showMenu(sections)
  }

  return (
    <button
      type="button"
      className="graph-panel-ctrl"
      aria-label="显示项"
      aria-haspopup="menu"
      onClick={open}
    >
      <TreeIcon name="sliders" size={14} mono />
    </button>
  )
}
