// 关系图谱的节点详情:默认是画布上的半透明浮窗(按住标题能拖、右下角能拉尺寸,位置与尺寸全局记住,
// 宽高紧包内容,拉大松手吸回);也可以停靠进左侧文件树下方,与大纲共用同一块坞位与分割线。
// 只读展示,数据全部来自已有的 DepGraphResult(引用数、模块划分),不发任何请求。
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LevelNode } from '@shared/graphView'
import type { DepGraphNode, ModuleMap } from '@shared/types'
import { folderComposition, moduleDetails, unassignedReason } from '../graph/moduleDetails'
import { useGraphPanelPlacement } from '../graph/useGraphPanelPlacement'
import { useGraphPanelDock } from '../graph/useGraphPanelDock'
import { setGraphPanelDocked } from '../graphPanelDock'
import type { SidebarDropTarget } from '../sidebarDock'
import { GraphModuleSection, ModuleChip } from './GraphModuleSection'
import { SidebarDockSection } from './SidebarDockSection'
import { TreeIcon } from './Icons'

export interface GraphSidePanelProps {
  node: LevelNode
  modules: ModuleMap | null
  depNodes: ReadonlyMap<string, DepGraphNode>
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
  onOpenFile: (relPath: string) => void
  onFocusFile: (relPath: string) => void
}

const KIND_LABEL: Record<LevelNode['kind'], string> = {
  file: '文件',
  folder: '文件夹',
  external: '当前文件夹以外',
  overflow: '收起的项'
}

const isFileNode = (n: LevelNode): boolean =>
  n.kind === 'file' || (n.kind === 'external' && n.target === 'file')

/** 名字右边那一列:文件夹给文件数,收起的项给剩余数量;文件不重复正文里的引用数 */
function headingMeta(node: LevelNode): string | null {
  if (node.kind === 'folder') return node.lazy ? '尚未读取' : `共 ${node.descendantFiles} 个文件`
  if (node.kind === 'overflow') return `其余 ${node.hiddenCount ?? 0} 项`
  return null
}

function FolderBody({ props }: { props: GraphSidePanelProps }): React.JSX.Element | null {
  const { node, modules, colorOf } = props
  if (!modules) return null
  const shares = folderComposition(modules, node.id)
  if (shares.length === 0) {
    return <p className="graph-panel-note">这个文件夹里没有可划分的代码模块</p>
  }
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">模块构成</h3>
      <ul className="graph-file-list">
        {shares.map((s) => (
          <li key={s.moduleId}>
            <div className="graph-file graph-file-static">
              <ModuleChip name={s.name} color={colorOf(s.moduleId)} />
              <span className="graph-file-note">{s.files} 个文件</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FileBody({ props }: { props: GraphSidePanelProps }): React.JSX.Element {
  const { node, modules, depNodes, dirRel, colorOf } = props
  const dep = depNodes.get(node.id)
  const moduleId =
    modules && Object.hasOwn(modules.fileToModule, node.id) ? modules.fileToModule[node.id] : null
  const details = modules && moduleId ? moduleDetails(modules, moduleId, dirRel) : null
  return (
    <>
      {dep && (
        <p className="graph-panel-note">
          引用了 {dep.outCount} 个文件,被 {dep.inCount} 个文件引用
        </p>
      )}
      <div className="graph-panel-actions">
        <button type="button" className="graph-panel-btn" onClick={() => props.onOpenFile(node.id)}>
          打开文件
        </button>
      </div>
      {!modules && <p className="graph-panel-note">模块划分暂不可用,先按原始结构显示</p>}
      {modules && !details && (
        <p className="graph-panel-note">未归类:{unassignedReason(node.id)}</p>
      )}
      {details && (
        <>
          <section className="graph-panel-section">
            <h3 className="graph-panel-h">所属模块</h3>
            <ModuleChip name={details.name} color={colorOf(details.module.id)} />
          </section>
          <GraphModuleSection details={details} colorOf={colorOf} onFocusFile={props.onFocusFile} />
        </>
      )}
    </>
  )
}

function Heading({ node }: { node: LevelNode }): React.JSX.Element {
  const meta = headingMeta(node)
  return (
    <>
      <p className="graph-panel-kind">{KIND_LABEL[node.kind]}</p>
      <div className="graph-panel-title-row">
        <h2 className="graph-panel-title">{node.label}</h2>
        {meta && <span className="graph-panel-meta">{meta}</span>}
      </div>
    </>
  )
}

function PanelBody({ props }: { props: GraphSidePanelProps }): React.JSX.Element {
  const { node } = props
  const isFile = isFileNode(node)
  return (
    <>
      {node.kind !== 'overflow' && node.id !== node.label && (
        <p className="graph-panel-path">{node.id}</p>
      )}
      {isFile && <FileBody props={props} />}
      {!isFile && node.kind !== 'overflow' && <FolderBody props={props} />}
    </>
  )
}

/** 停靠进左栏:外壳(分割线、标题条、拖出小牌)与大纲共用,正文自己滚 */
function DockedGraphPanel({ props }: { props: GraphSidePanelProps }): React.JSX.Element {
  return (
    <SidebarDockSection
      title="节点详情"
      label="节点详情"
      undockLabel="把节点详情放回浮窗,也可以按住标题条拖出左栏"
      onUndock={() => setGraphPanelDocked(false)}
      onClose={props.onClose}
    >
      <div className="graph-panel-dock-body">
        <Heading node={props.node} />
        <PanelBody props={props} />
      </div>
    </SidebarDockSection>
  )
}

export function GraphSidePanel(props: GraphSidePanelProps): React.JSX.Element {
  const dock = useGraphPanelDock(props.viewRef, props.tabId, props.activeTabId)
  if (dock.hidden && dock.slot) return createPortal(<DockedGraphPanel props={props} />, dock.slot)
  return (
    <FloatingGraphPanel
      props={props}
      canDock={dock.canDock}
      onDock={() => setGraphPanelDocked(true)}
      dropTarget={dock.dropTarget}
    />
  )
}

function FloatingGraphPanel({
  props,
  canDock,
  onDock,
  dropTarget
}: {
  props: GraphSidePanelProps
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
      <header className="graph-panel-head">
        <div
          className="graph-panel-drag"
          role="button"
          tabIndex={0}
          aria-label="移动节点详情,可用方向键微调;拖到左侧文件树上方松手可停靠"
          {...grip}
        >
          <Heading node={node} />
        </div>
        {canDock && (
          <button
            type="button"
            className="graph-panel-dockbtn"
            aria-label="把节点详情停靠到左侧文件树下方"
            onClick={onDock}
          >
            <TreeIcon name="panelLeft" size={14} mono />
          </button>
        )}
        <button
          type="button"
          className="graph-panel-close"
          aria-label="关闭详情"
          onClick={props.onClose}
        >
          <TreeIcon name="x" size={14} mono />
        </button>
      </header>
      <div className="graph-panel-body">
        <PanelBody props={props} />
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
