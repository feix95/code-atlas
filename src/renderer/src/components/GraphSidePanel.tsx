// 关系图谱右侧抽屉:单击节点后显示它的信息与所属模块。只读展示,数据全部来自已有的
// DepGraphResult(引用数、模块划分),不发任何请求。
import type { LevelNode } from '@shared/graphView'
import type { DepGraphNode, ModuleMap } from '@shared/types'
import { folderComposition, moduleDetails, unassignedReason } from '../graph/moduleDetails'
import { GraphModuleSection, ModuleChip } from './GraphModuleSection'
import { TreeIcon } from './Icons'

export interface GraphSidePanelProps {
  node: LevelNode
  modules: ModuleMap | null
  depNodes: ReadonlyMap<string, DepGraphNode>
  dirRel: string
  highlight: string | null
  colorOf: (moduleId: string) => number | undefined
  onClose: () => void
  onOpenFile: (relPath: string) => void
  onFocusFile: (relPath: string) => void
  onToggleHighlight: (moduleId: string) => void
}

const KIND_LABEL: Record<LevelNode['kind'], string> = {
  file: '文件',
  folder: '文件夹',
  external: '当前文件夹以外',
  overflow: '收起的项'
}

const isFileNode = (n: LevelNode): boolean =>
  n.kind === 'file' || (n.kind === 'external' && n.target === 'file')

function FolderBody({ props }: { props: GraphSidePanelProps }): React.JSX.Element | null {
  const { node, modules, colorOf, onToggleHighlight } = props
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
            <button
              type="button"
              className="graph-file"
              data-tip="高亮这个模块"
              onClick={() => onToggleHighlight(s.moduleId)}
            >
              <ModuleChip name={s.name} colorIndex={colorOf(s.moduleId)} />
              <span className="graph-file-note">{s.files} 个文件</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FileBody({ props }: { props: GraphSidePanelProps }): React.JSX.Element {
  const { node, modules, depNodes, dirRel, highlight, colorOf } = props
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
        {details && (
          <button
            type="button"
            className="graph-panel-btn"
            aria-pressed={highlight === details.module.id}
            onClick={() => props.onToggleHighlight(details.module.id)}
          >
            {highlight === details.module.id ? '取消高亮' : '高亮同模块'}
          </button>
        )}
      </div>
      {!modules && <p className="graph-panel-note">模块划分暂不可用,先按原始结构显示</p>}
      {modules && !details && (
        <p className="graph-panel-note">未归类:{unassignedReason(node.id)}</p>
      )}
      {details && (
        <>
          <section className="graph-panel-section">
            <h3 className="graph-panel-h">所属模块</h3>
            <ModuleChip name={details.name} colorIndex={colorOf(details.module.id)} />
          </section>
          <GraphModuleSection
            details={details}
            colorOf={colorOf}
            onFocusFile={props.onFocusFile}
            onPickModule={props.onToggleHighlight}
          />
        </>
      )}
    </>
  )
}

export function GraphSidePanel(props: GraphSidePanelProps): React.JSX.Element {
  const { node } = props
  const isFile = isFileNode(node)
  return (
    <aside className="graph-panel" aria-label="节点详情" tabIndex={-1}>
      <header className="graph-panel-head">
        <div className="graph-panel-heading">
          <p className="graph-panel-kind">{KIND_LABEL[node.kind]}</p>
          <h2 className="graph-panel-title">{node.label}</h2>
        </div>
        <button type="button" className="graph-tool" aria-label="关闭详情" onClick={props.onClose}>
          <TreeIcon name="x" size={14} mono />
        </button>
      </header>
      {node.kind !== 'overflow' && <p className="graph-panel-path">{node.id}</p>}
      {isFile && <FileBody props={props} />}
      {!isFile && node.kind !== 'overflow' && (
        <>
          {node.kind === 'folder' && (
            <p className="graph-panel-note">
              {node.lazy ? '尚未读取' : `共 ${node.descendantFiles} 个文件`}
            </p>
          )}
          <FolderBody props={props} />
        </>
      )}
      {node.kind === 'overflow' && (
        <p className="graph-panel-note">这一层文件太多,其余 {node.hiddenCount ?? 0} 项收在这里</p>
      )}
    </aside>
  )
}
