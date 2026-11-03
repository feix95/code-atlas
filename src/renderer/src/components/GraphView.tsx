import type { DepGraphResult, ScanDirNode, ScanResult } from '@shared/types'
import { GraphCanvas } from './GraphCanvas'
import { TreeIcon } from './Icons'
// 关系图谱页签正文:资源管理器的图形视图(drill-down),一次呈现一个目录层级,
// 在真实文件夹结构上叠加程序切出的模块(划分:轮廓、色环、聚类力)。
// 组合 useGraphNav(层级)· useForceLayout(布局)· useGraphViewport(交互)· useGraphRender(绘制)
// · useGraphSelection(选中)· useGraphHoverDetail(悬停出详情)· useGraphHoverMode(滚轮切换悬停看法)
// · useModuleColorPicker(模块改色);
// 数据全部来自共享的 ScanResult 与 DepGraphResult,不另起扫描或关系计算。

export interface GraphViewProps {
  result: ScanResult | null
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  onLoadGraph: () => void
  expandLazy: (relPath: string) => Promise<ScanDirNode | null>
  onOpenFile: (relPath: string) => void
  /** 打开 Wiki 进度页签(生成开跑后自动转过去) */
  onOpenWiki: () => void
  /** 这扇图谱的页签 id:节点详情停靠时认它 */
  tabId: string
  /** 当前停靠位认的那张签(App 按主窗激活组算) */
  activeTabId: string | null
}

export function GraphView(props: GraphViewProps): React.JSX.Element {
  const { result } = props
  if (!result) {
    return (
      <div className="pane-empty">
        <span className="pane-empty-mark" aria-hidden="true">
          <TreeIcon name="view" size={40} mono />
        </span>
        <p className="pane-empty-title">关系图谱</p>
        <p className="pane-empty-hint">打开一个项目后,这里会显示文件之间的引用关系</p>
      </div>
    )
  }
  // 切换项目 = 整个画布重建:层级、布局、视口、选中一并归零
  return <GraphCanvas key={result.rootPath} {...props} result={result} />
}
