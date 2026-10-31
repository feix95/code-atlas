// 关系图谱页签正文:资源管理器的图形视图(drill-down),一次呈现一个目录层级,
// 在真实文件夹结构上叠加程序切出的模块(划分:轮廓、色环、聚类力)。
// 组合 useGraphNav(层级)· useForceLayout(布局)· useGraphViewport(交互)· useGraphRender(绘制)
// · useGraphSelection(选中)· useGraphHoverDetail(悬停出详情)· useGraphHoverMode(滚轮切换悬停看法)
// · useModuleColorPicker(模块改色);
// 数据全部来自共享的 ScanResult 与 DepGraphResult,不另起扫描或关系计算。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DepEdge, DepGraphNode, DepGraphResult, ScanDirNode, ScanResult } from '@shared/types'
import { folderTree } from '@shared/hierarchy'
import type { LevelNode } from '@shared/graphView'
import { useGraphNav, type GraphNav } from '../graph/useGraphNav'
import { useGraphExpansion } from '../graph/useGraphExpansion'
import { levelWheelAction, type LevelWheelTarget } from '../graph/wheelIntent'
import { useForceLayout, type SimNode } from '../graph/useForceLayout'
import { useGraphViewport } from '../graph/useGraphViewport'
import { useGraphRender, type RenderRefs } from '../graph/useGraphRender'
import { buildModuleOverlay, moduleDisplayName } from '../graph/moduleOverlay'
import { nodeMenuItems, useGraphSelection } from '../graph/useGraphSelection'
import { useGraphHoverMode } from '../graph/useGraphHoverMode'
import { useGraphHoverDetail } from '../graph/useGraphHoverDetail'
import { moduleSwatchCss } from '../graph/moduleColors'
import { useModuleColorOverrides } from '../graph/moduleColorStore'
import { openContextMenu } from './contextMenuStore'
import { NodeList } from './GraphNodeList'
import { GraphToolbar } from './GraphToolbar'
import { GraphHoverTag } from './GraphHoverTag'
import { GraphNodeTip } from './GraphNodeTip'
import { nodeTipText, type NodeTipText } from '../graph/nodeTip'
import { footText } from '../graph/graphFootText'
import { GraphSidePanel } from './GraphSidePanel'
import { useModuleColorPicker } from '../graph/useModuleColorPicker'
import { GraphNotices } from './GraphNotices'
import { TreeIcon } from './Icons'

const NO_EDGES: DepEdge[] = []

interface GraphViewProps {
  result: ScanResult | null
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  onLoadGraph: () => void
  expandLazy: (relPath: string) => Promise<ScanDirNode | null>
  onOpenFile: (relPath: string) => void
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

function useNodeActivate(
  nav: GraphNav,
  onOpenFile: (relPath: string) => void
): (d: LevelNode) => void {
  return useCallback(
    (d: LevelNode) => {
      if (d.kind === 'file' || (d.kind === 'external' && d.target === 'file')) onOpenFile(d.id)
      else if (d.kind === 'folder' || d.kind === 'external') void nav.navigate(d.id)
    },
    [nav, onOpenFile]
  )
}

const isFolderTarget = (d: LevelNode): boolean =>
  d.kind === 'folder' || (d.kind === 'external' && d.target === 'folder')

function GraphCanvas(props: GraphViewProps & { result: ScanResult }): React.JSX.Element {
  const { result, graph, graphLoading, graphNote, onLoadGraph, expandLazy, onOpenFile } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<RenderRefs | null>(null)
  const render = useGraphRender(linkRef)
  const nav = useGraphNav({
    tree: result.tree,
    expandLazy,
    onBeforeChange: render.beginLevelTransition
  })
  // 关系分析结果属于别的项目(切换中)时不拿来连线,也不拿它的模块
  const current = graph && graph.rootPath === result.rootPath ? graph : null
  const edges = current ? current.edges : NO_EDGES
  const moduleMap = current?.modules ?? null
  const [showModules, setShowModules] = useState(true)
  const tree = useMemo(() => folderTree(result.tree), [result.tree])
  const expansion = useGraphExpansion({
    visit: nav.visit,
    dirRel: nav.dirRel,
    tree,
    edges,
    expandLazy
  })
  const level = expansion.level
  const overlay = useMemo(
    () => buildModuleOverlay(level?.nodes ?? [], nav.dirRel, moduleMap),
    [level, nav.dirRel, moduleMap]
  )
  const overrides = useModuleColorOverrides(result.rootPath)
  const clusters = useMemo(() => {
    if (!showModules || overlay.nodes.size === 0) return null
    const map = new Map<string, string>()
    for (const [id, info] of overlay.nodes) if (info.hullModule) map.set(id, info.hullModule)
    return map
  }, [overlay, showModules])
  const depNodes = useMemo(
    () => new Map<string, DepGraphNode>((current?.nodes ?? []).map((n) => [n.relPath, n])),
    [current]
  )
  // 引用关系(连线与模块)还没到时先不布局:等数据齐了一次排好,首帧即最终布局,不会到货后再重排一遍
  const isAwaitingGraph = current === null && graphNote === null
  const layout = useForceLayout(isAwaitingGraph ? null : level, render.requestDraw, clusters)
  const activate = useNodeActivate(nav, onOpenFile)
  const centerRef = useRef<(id: string) => boolean>(() => false)
  const centerOn = useCallback((id: string) => centerRef.current(id), [])
  const selection = useGraphSelection({ level, navigate: nav.navigate, centerOn })
  const modulesOn = showModules && overlay.nodes.size > 0
  const moduleOfNode = useCallback(
    (id: string) => overlay.nodes.get(id)?.hullModule ?? null,
    [overlay]
  )
  // 模块着色关着时没有「同模块」看法可看
  const hoverModuleOf = useCallback(
    (id: string) => (modulesOn ? moduleOfNode(id) : null),
    [modulesOn, moduleOfNode]
  )
  const hoverMode = useGraphHoverMode(hoverModuleOf, render.setHover)
  useGraphHoverDetail(hoverMode.hover, selection.select)
  const picker = useModuleColorPicker({ root: result.rootPath, canvasRef, overlay, overrides })
  const onNodeContextMenu = useCallback(
    (n: SimNode, x: number, y: number) => {
      const moduleId = moduleOfNode(n.id)
      openContextMenu({
        x,
        y,
        doc: canvasRef.current?.ownerDocument ?? document,
        noTips: true,
        items: nodeMenuItems(n.data, {
          moduleId,
          onDetails: () => selection.select(n.data),
          onChangeColor: () => moduleId && picker.open(moduleId, x, y),
          onActivate: () => activate(n.data)
        })
      })
    },
    [activate, moduleOfNode, picker, selection]
  )
  const enterOrLeave = (node: SimNode | null, steps: number): void => {
    const target: LevelWheelTarget = !node ? 'blank' : isFolderTarget(node.data) ? 'folder' : 'file'
    const action = levelWheelAction(target, steps)
    if (action === 'expand') expansion.expandAll()
    else if (action === 'collapse') expansion.collapseAll()
    else if (action === 'leave') nav.goUp()
    else if (action === 'enter' && node) {
      selection.select(null)
      activate(node.data)
    }
  }
  const viewport = useGraphViewport({
    canvasRef,
    sceneRef: layout.sceneRef,
    requestDraw: render.requestDraw,
    setDragging: layout.setDragging,
    onBlankClick: selection.clear,
    onNodeDoubleClick: (n) => {
      if (n.data.kind === 'folder') {
        expansion.toggle(n.id)
        return
      }
      // 进入外部文件夹后旧选中已不在画面里,侧栏一并收起;打开文件则保留选中
      if (isFolderTarget(n.data)) selection.select(null)
      activate(n.data)
    },
    onNodeContextMenu,
    onHoverChange: hoverMode.onHoverChange,
    onModeWheel: hoverMode.onModeWheel,
    onLevelWheel: enterOrLeave
  })
  useEffect(() => {
    centerRef.current = viewport.centerOn
  }, [viewport.centerOn])

  useEffect(() => {
    linkRef.current = {
      canvasRef,
      sceneRef: layout.sceneRef,
      transformRef: viewport.transformRef,
      sizeRef: viewport.sizeRef,
      fit: viewport.fit,
      modules: modulesOn ? { overlay, overrides } : null,
      hoverMode: hoverMode.mode,
      selectedId: selection.selected?.id ?? null
    }
    render.requestDraw()
  })

  // 打开图谱时关系分析还没跑过:自动跑一次(失败后等用户点重试,不自动重跑)
  useEffect(() => {
    if (!graph && !graphLoading && !graphNote) onLoadGraph()
  }, [graph, graphLoading, graphNote, onLoadGraph])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
      e.preventDefault()
      nav.goUp()
    } else if (e.key === 'Escape') {
      viewport.clearHover()
      selection.clear()
    }
  }

  const moduleNameOf = (id: string): string | null => {
    const moduleId = moduleOfNode(id)
    const info = moduleId ? overlay.byId.get(moduleId) : undefined
    return info ? moduleDisplayName(info) : null
  }
  const nodeTipOf = (node: LevelNode): NodeTipText | null =>
    nodeTipText(node, {
      hasModules: moduleMap !== null && moduleMap.modules.length > 0,
      moduleName: moduleNameOf(node.id)
    })
  const tag = hoverMode.tag
  const hover = hoverMode.hover
  // 详情浮窗正展示这个节点时,提示框不再重复同一份信息
  const detailShown = hover !== null && selection.selected?.id === hover.node.id
  const hoverTip =
    hover && !hover.dragging && !tag && !detailShown ? nodeTipOf(hover.node.data) : null
  const tagModule = tag ? hoverModuleOf(tag.nodeId) : null
  const scanning = nav.status.kind === 'scanning'
  const empty = !scanning && level !== null && level.nodes.length === 0
  const overlayText = scanning
    ? '正在读取文件夹…'
    : empty
      ? '这个文件夹是空的'
      : isAwaitingGraph
        ? '正在分析引用关系…'
        : null
  return (
    <div
      className="graph-view"
      ref={viewRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="关系图谱"
    >
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        data-graph-dir={nav.dirRel}
        data-graph-hulls={modulesOn ? overlay.hulls.size : 0}
        data-graph-hover-mode={hoverMode.mode}
        data-graph-expanded={expansion.expanded.size}
      />
      <NodeList
        nodes={level?.nodes ?? []}
        moduleNameOf={moduleNameOf}
        onActivate={activate}
        onFocusNode={render.setHover}
      />
      <GraphToolbar
        rootName={result.rootName}
        nav={nav}
        graphLoading={graphLoading}
        showModules={showModules}
        hasModules={moduleMap !== null && moduleMap.modules.length > 0}
        canExpandAll={expansion.canExpandAll}
        canCollapseAll={expansion.canCollapseAll}
        onToggleModules={() => setShowModules((v) => !v)}
        onExpandAll={expansion.expandAll}
        onCollapseAll={expansion.collapseAll}
        onFit={viewport.fit}
      />
      <GraphNotices
        graphNote={graphNote}
        scanFailed={nav.status.kind === 'failed'}
        expansionNotice={expansion.notice}
        onRetry={onLoadGraph}
      />
      {overlayText && <p className="graph-overlay">{overlayText}</p>}
      {tag && (
        <GraphHoverTag
          tag={tag}
          elsewhere={tagModule ? (overlay.elsewhere.get(tagModule) ?? 0) : 0}
        />
      )}
      {/* 看法标签亮着或详情浮窗已展示该节点时提示框让位;拖拽中先收起,松手后再亮;文件夹与 overflow 没有可补的信息 */}
      {hover && hoverTip && <GraphNodeTip key={hover.node.id} anchor={hover} text={hoverTip} />}
      {selection.selected && (
        <GraphSidePanel
          node={selection.selected}
          modules={moduleMap}
          depNodes={depNodes}
          dirRel={nav.dirRel}
          colorOf={(id) => moduleSwatchCss(overlay.colorOf.get(id), overrides.get(id))}
          viewRef={viewRef}
          tabId={props.tabId}
          activeTabId={props.activeTabId}
          onClose={selection.clear}
          onOpenFile={onOpenFile}
          onFocusFile={selection.focusFile}
        />
      )}
      {picker.element}
      <p className="graph-foot">{footText(current, modulesOn)}</p>
    </div>
  )
}
