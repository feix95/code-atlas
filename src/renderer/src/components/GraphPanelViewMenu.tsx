// 节点详情右上角的「显示项」:点开勾掉不想看的区块,菜单不关可以连着勾。
// 勾选账全局记一份(见 graphPanelSections),浮窗与停靠共用;没内容的区块本来就不渲染。
import { MENU_SEP, openContextMenu, type ContextMenuEntry } from './contextMenuStore'
import {
  graphPanelSections,
  setGraphPanelSectionVisible,
  showAllGraphPanelSections,
  useHiddenGraphPanelSections,
  type GraphPanelSectionDef,
  type GraphPanelSectionId
} from '../graph/graphPanelSections'
import { TreeIcon } from './Icons'

/** 菜单首行的落点比钮底低一点,别贴着边框 */
const MENU_GAP_PX = 4

function menuItems(
  sections: readonly GraphPanelSectionDef[],
  hidden: ReadonlySet<GraphPanelSectionId>
): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = []
  let group = ''
  for (const section of sections) {
    if (section.group !== group) {
      if (group !== '') items.push(MENU_SEP)
      items.push({ heading: section.group })
      group = section.group
    }
    items.push({
      label: section.label,
      switchOn: !hidden.has(section.id),
      run: (nextOn) => setGraphPanelSectionVisible(section.id, nextOn === true)
    })
  }
  if (sections.some((section) => hidden.has(section.id))) {
    items.push(MENU_SEP, { label: '全部显示', run: showAllGraphPanelSections })
  }
  return items
}

export function GraphPanelViewMenu({
  kind,
  tipSide
}: {
  /** 当前节点按哪种内容列区块 */
  kind: 'file' | 'folder'
  /** 悬停提示压在哪一侧:浮窗朝左、停靠朝上 */
  tipSide: 'left' | 'top'
}): React.JSX.Element {
  const hidden = useHiddenGraphPanelSections()
  const sections = graphPanelSections(kind)
  const open = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    openContextMenu({
      x: rect.left,
      y: rect.bottom + MENU_GAP_PX,
      doc: e.currentTarget.ownerDocument,
      items: menuItems(sections, hidden),
      compact: true,
      noTips: true
    })
  }
  return (
    <button
      type="button"
      className="graph-panel-ctrl"
      aria-label="显示项"
      aria-haspopup="menu"
      data-tip="显示项"
      data-tip-side={tipSide}
      onClick={open}
    >
      <TreeIcon name="sliders" size={14} mono />
    </button>
  )
}
