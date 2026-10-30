// 关系图谱顶栏:面包屑 + 右侧工具(引用分析状态、模块着色开关、适应画布)。
import type { GraphNav } from '../graph/useGraphNav'
import { Crumbs } from './GraphNodeList'
import { ModuleToggle } from './GraphModuleToggle'
import { TreeIcon } from './Icons'

interface GraphToolbarProps {
  rootName: string
  nav: GraphNav
  graphLoading: boolean
  showModules: boolean
  hasModules: boolean
  onToggleModules: () => void
  onFit: () => void
}

export function GraphToolbar(props: GraphToolbarProps): React.JSX.Element {
  return (
    <div className="graph-bar">
      <Crumbs rootName={props.rootName} nav={props.nav} />
      <div className="graph-tools">
        {props.graphLoading && <span className="graph-status">正在分析引用关系…</span>}
        {props.hasModules && (
          <ModuleToggle isOn={props.showModules} onToggle={props.onToggleModules} />
        )}
        <button
          type="button"
          className="graph-tool"
          onClick={props.onFit}
          data-tip="适应画布"
          aria-label="适应画布"
        >
          <TreeIcon name="expand" size={16} mono />
        </button>
      </div>
    </div>
  )
}
