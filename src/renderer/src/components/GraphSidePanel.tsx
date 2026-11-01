// 关系图谱的节点详情:默认是画布上的半透明浮窗(按住标题能拖、右下角能拉尺寸,位置与尺寸全局记住,
// 宽高紧包内容,拉大松手吸回);也可以停靠进左侧文件树下方,与大纲共用同一块坞位与分割线。
// 只读展示,数据全部来自已有的 DepGraphResult(引用数、模块划分),不发任何请求。
import { Fragment, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LevelNode } from '@shared/graphView'
import type { GroupTree } from '@shared/hierarchy'
import type { DepGraphNode, ModuleMap } from '@shared/types'
import { availableGraphPanelSections } from '../graph/graphPanelAvailability'
import { moduleDetails, type ModuleDetails } from '../graph/moduleDetails'
import {
  graphPanelKindOf,
  orderGraphPanelSections,
  useGraphPanelSectionOrders,
  useHiddenGraphPanelSections,
  type GraphPanelSectionDef,
  type GraphPanelSectionId,
  type GraphPanelSectionOrders
} from '../graph/graphPanelSections'
import { FolderBody } from './GraphFolderBody'
import { useGraphPanelPlacement } from '../graph/useGraphPanelPlacement'
import { useGraphPanelDock } from '../graph/useGraphPanelDock'
import { setGraphPanelDocked } from '../graphPanelDock'
import type { SidebarDropTarget } from '../sidebarDock'
import {
  ModuleChip,
  ModuleFilesSection,
  ModuleLinksSection,
  ModuleStylesSection,
  ModuleTestsSection
} from './GraphModuleSection'
import { GraphPanelHeader } from './GraphPanelHeader'
import { SidebarDockSection } from './SidebarDockSection'
import { TreeIcon } from './Icons'

export interface GraphSidePanelProps {
  node: LevelNode
  modules: ModuleMap | null
  depNodes: ReadonlyMap<string, DepGraphNode>
  /** 与画布同一份扫描树:文件夹详情据此列出直接子项 */
  tree: GroupTree
  dirRel: string
  /** 模块颜色(CSS 颜色值) */
  colorOf: (moduleId: string) => string
  /** 画布容器:浮窗的位置、尺寸按它夹边 */
  viewRef: React.RefObject<HTMLDivElement | null>
  /** 这扇图谱的页签 id:停靠位认它 */
  tabId: string
  /** 当前停靠位认的那张签(App 按主窗激活组算) */
  activeTabId: string | null
  onClose: () => void
}

const UNDOCK_LABEL = '把节点详情放回浮窗,也可以按住标题条拖出左栏'

interface BodyProps {
  props: GraphSidePanelProps
  hidden: ReadonlySet<GraphPanelSectionId>
}

const HIDDEN_ALL_NOTE = '全部内容已隐藏'

/** 当前节点能显示的区块(菜单与正文同一份账) */
interface PanelView {
  sections: readonly GraphPanelSectionDef[]
  available: ReadonlySet<GraphPanelSectionId>
  orders: GraphPanelSectionOrders
}

function panelViewOf(props: GraphSidePanelProps, orders: GraphPanelSectionOrders): PanelView {
  const kind = graphPanelKindOf(props.node)
  if (kind === null) return { sections: [], available: new Set(), orders }
  // 菜单始终列全这一类的区块,没内容的置灰;正文只认能拿到的那几块
  return {
    sections: orderGraphPanelSections(kind, orders),
    available: availableGraphPanelSections(props),
    orders
  }
}

/** 一个区块的正文块;数据不够就交 null(可用性已在菜单那层算过,这里只认数据) */
function fileSection(
  id: GraphPanelSectionId,
  dep: DepGraphNode | undefined,
  details: ModuleDetails | null,
  colorOf: (moduleId: string) => string
): React.ReactNode {
  switch (id) {
    case 'refs':
      return dep ? (
        <p className="graph-panel-note">
          引用了 {dep.outCount} 个文件,被 {dep.inCount} 个文件引用
        </p>
      ) : null
    case 'module':
      return details ? (
        <section className="graph-panel-section">
          <h3 className="graph-panel-h">所属模块</h3>
          <ModuleChip name={details.name} color={colorOf(details.module.id)} />
        </section>
      ) : null
    case 'files':
      return details ? <ModuleFilesSection details={details} /> : null
    case 'tests':
      return details ? <ModuleTestsSection details={details} /> : null
    case 'styles':
      return details ? <ModuleStylesSection details={details} /> : null
    case 'dependsOn':
      return details ? (
        <ModuleLinksSection title="依赖的模块" links={details.dependsOn} colorOf={colorOf} />
      ) : null
    case 'usedBy':
      return details ? (
        <ModuleLinksSection title="被这些模块使用" links={details.usedBy} colorOf={colorOf} />
      ) : null
    default:
      return null
  }
}

function FileBody({
  props,
  hidden,
  order
}: BodyProps & { order: readonly GraphPanelSectionId[] }): React.JSX.Element {
  const { node, modules, depNodes, dirRel, colorOf } = props
  const dep = depNodes.get(node.id)
  const moduleId =
    modules && Object.hasOwn(modules.fileToModule, node.id) ? modules.fileToModule[node.id] : null
  const details = modules && moduleId ? moduleDetails(modules, moduleId, dirRel) : null
  return (
    <>
      {order.map((id) => {
        if (hidden.has(id)) return null
        const block = fileSection(id, dep, details, colorOf)
        return block === null ? null : <Fragment key={id}>{block}</Fragment>
      })}
      {!modules && <p className="graph-panel-note">模块划分暂不可用,先按原始结构显示</p>}
      {modules && !details && <p className="graph-panel-note">未归入任何模块</p>}
    </>
  )
}

function PanelBody({
  props,
  available,
  orders
}: {
  props: GraphSidePanelProps
  available: ReadonlySet<GraphPanelSectionId>
  orders: GraphPanelSectionOrders
}): React.JSX.Element | null {
  const hidden = useHiddenGraphPanelSections()
  const kind = graphPanelKindOf(props.node)
  if (kind === null) return null
  if (available.size > 0 && [...available].every((id) => hidden.has(id))) {
    return <p className="graph-panel-note">{HIDDEN_ALL_NOTE}</p>
  }
  return kind === 'file' ? (
    <FileBody props={props} hidden={hidden} order={orders.file} />
  ) : (
    <FolderBody {...props} hidden={hidden} order={orders.folder} />
  )
}

/** 停靠进左栏:外壳(分割线、标题条、拖出小牌)与大纲共用,标头换成详情自己的两行排版,正文自己滚 */
function DockedGraphPanel({
  props,
  view
}: {
  props: GraphSidePanelProps
  view: PanelView
}): React.JSX.Element {
  return (
    <SidebarDockSection
      title="节点详情"
      label="节点详情"
      undockLabel={UNDOCK_LABEL}
      onUndock={() => setGraphPanelDocked(false)}
      onClose={props.onClose}
      head={
        <GraphPanelHeader
          node={props.node}
          sections={view.sections}
          available={view.available}
          controls={
            <>
              <button
                type="button"
                className="graph-panel-ctrl sidebar-dock-undock"
                aria-label={UNDOCK_LABEL}
                onClick={() => setGraphPanelDocked(false)}
              >
                <TreeIcon name="appWindow" size={14} mono />
              </button>
              <button
                type="button"
                className="graph-panel-ctrl sidebar-dock-close"
                aria-label="关闭详情"
                onClick={props.onClose}
              >
                <TreeIcon name="x" size={14} mono />
              </button>
            </>
          }
        />
      }
    >
      <div className="graph-panel-dock-body">
        <PanelBody props={props} available={view.available} orders={view.orders} />
      </div>
    </SidebarDockSection>
  )
}

export function GraphSidePanel(props: GraphSidePanelProps): React.JSX.Element {
  const dock = useGraphPanelDock(props.viewRef, props.tabId, props.activeTabId)
  const orders = useGraphPanelSectionOrders()
  const view = panelViewOf(props, orders)
  if (dock.hidden && dock.slot) {
    return createPortal(<DockedGraphPanel props={props} view={view} />, dock.slot)
  }
  return (
    <FloatingGraphPanel
      props={props}
      view={view}
      canDock={dock.canDock}
      onDock={() => setGraphPanelDocked(true)}
      dropTarget={dock.dropTarget}
    />
  )
}

function FloatingGraphPanel({
  props,
  view,
  canDock,
  onDock,
  dropTarget
}: {
  props: GraphSidePanelProps
  view: PanelView
  /** 左栏能收留、这签正是停靠位:标题行多一颗停靠钮 */
  canDock: boolean
  onDock: () => void
  /** 拖到左栏上方松手 = 停靠 */
  dropTarget: SidebarDropTarget | undefined
}): React.JSX.Element {
  const { node, viewRef } = props
  const panelRef = useRef<HTMLElement>(null)
  const { style, isDragging, isSnapping, isOverDock, grip, resizer } = useGraphPanelPlacement(
    viewRef,
    panelRef,
    dropTarget
  )
  const panelClass = `graph-panel${isDragging ? ' is-dragging' : ''}${isSnapping ? ' is-snapping' : ''}${isOverDock ? ' is-dock-ready' : ''}`
  return (
    <aside ref={panelRef} className={panelClass} style={style} aria-label="节点详情" tabIndex={-1}>
      <GraphPanelHeader
        node={node}
        sections={view.sections}
        available={view.available}
        grip={grip}
        gripLabel="移动节点详情,可用方向键微调;拖到左侧文件树上方松手可停靠"
        controls={
          <>
            {canDock && (
              <button
                type="button"
                className="graph-panel-ctrl"
                aria-label="把节点详情停靠到左侧文件树下方"
                onClick={onDock}
              >
                <TreeIcon name="panelLeft" size={14} mono />
              </button>
            )}
            <button
              type="button"
              className="graph-panel-ctrl"
              aria-label="关闭详情"
              onClick={props.onClose}
            >
              <TreeIcon name="x" size={14} mono />
            </button>
          </>
        }
      />
      <div className="graph-panel-body">
        <PanelBody props={props} available={view.available} orders={view.orders} />
      </div>
      <button
        type="button"
        className="graph-panel-resize"
        aria-label="调整详情窗口大小,可用方向键微调;双击或按 Enter 恢复自动大小"
        {...resizer}
      />
    </aside>
  )
}
