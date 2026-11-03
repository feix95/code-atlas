import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DepEdge, DepGraphNode, ScanResult } from '@shared/types'
import { folderTree } from '@shared/hierarchy'
import type { LevelNode } from '@shared/graphView'
import { useGraphNav } from '../graph/useGraphNav'
import { useGraphExpansion } from '../graph/useGraphExpansion'
import { useGraphEnterLeave } from '../graph/useGraphEnterLeave'
import { isFolderTarget, useNodeActivate } from '../graph/useNodeActivate'
import { useForceLayout, type SimNode } from '../graph/useForceLayout'
import { useGraphViewport } from '../graph/useGraphViewport'
import { useGraphRender, type RenderRefs } from '../graph/useGraphRender'
import { buildModuleOverlay, moduleDisplayName } from '../graph/moduleOverlay'
import { moduleNamesOf } from '../graph/moduleNames'
import { useWikiPanel } from '../useWikiPanel'
import { useGraphSearch } from '../graph/useGraphSearch'
import { useGraphLocate } from '../graph/useGraphLocate'
import { graphKeyHandler } from '../graph/graphKeys'
import { nodeMenuItems, useGraphSelection } from '../graph/useGraphSelection'
import { useGraphHoverMode } from '../graph/useGraphHoverMode'
import { useGraphHoverDetail } from '../graph/useGraphHoverDetail'
import { useGraphEscape } from '../graph/useGraphEscape'
import { moduleSwatchCss } from '../graph/moduleColors'
import { useModuleColorOverrides } from '../graph/moduleColorStore'
import { openContextMenu } from './contextMenuStore'
import { NodeList } from './GraphNodeList'
import { GraphToolbar } from './GraphToolbar'
import { GraphSearch } from './GraphSearch'
import { GraphHoverTag } from './GraphHoverTag'
import { GraphNodeTip } from './GraphNodeTip'
import { nodeTipText, type NodeTipText } from '../graph/nodeTip'
import { footText } from '../graph/graphFootText'
import { GraphSidePanel } from './GraphSidePanel'
import { useModuleColorPicker } from '../graph/useModuleColorPicker'
import { GraphNotices } from './GraphNotices'
import { GraphWikiEntry } from './GraphWikiEntry'
import { WikiWallLayer } from './WikiWallLayer'
import { useGraphWall } from '../useGraphWall'
import type { GraphViewProps } from './GraphView'

const NO_EDGES: DepEdge[] = []

export function GraphCanvas(props: GraphViewProps & { result: ScanResult }): React.JSX.Element {
  const { result, graph, graphLoading, graphNote, onLoadGraph, expandLazy, onOpenFile } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
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
  // 当前语种的 Wiki 快照:图谱 AI 名称与详情区块共用,只在打开时按内容哈希重算过期,不调模型
  const wiki = useWikiPanel(result, current)
  // 卡片墙:已生成过 Wiki 时默认变形为语义墙,用户手动切换后以手动为准
  const graphWall = useGraphWall(result.rootPath)
  const moduleNames = useMemo(
    () => moduleNamesOf(moduleMap?.modules ?? [], (id) => wiki?.pages.get(id)?.name ?? null),
    [moduleMap, wiki]
  )
  const search = useGraphSearch(wiki, searchInputRef)
  // 引用关系(连线与模块)还没到时先不布局:等数据齐了一次排好,首帧即最终布局,不会到货后再重排一遍
  const isAwaitingGraph = current === null && graphNote === null
  const layout = useForceLayout(isAwaitingGraph ? null : level, render.requestDraw, clusters)
  const activate = useNodeActivate(nav, onOpenFile)
  const selection = useGraphSelection()
  const locateHit = useGraphLocate({ level, nav, select: selection.select })
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
  const picker = useModuleColorPicker({
    root: result.rootPath,
    canvasRef,
    overlay,
    overrides,
    names: moduleNames
  })
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
  const enterOrLeave = useGraphEnterLeave({
    nav,
    expansion,
    onEnter: (node) => {
      selection.select(null)
      activate(node)
    }
  })
  const viewport = useGraphViewport({
    canvasRef,
    sceneRef: layout.sceneRef,
    requestDraw: render.requestDraw,
    setDragging: layout.setDragging,
    onBlankClick: selection.clear,
    onNodeDoubleClick: (n) => {
      // 进入文件夹后旧选中已不在画面里,侧栏一并收起;打开文件则保留选中
      if (isFolderTarget(n.data)) selection.select(null)
      activate(n.data)
    },
    onNodeContextMenu,
    onHoverChange: hoverMode.onHoverChange,
    onModeWheel: hoverMode.onModeWheel,
    onLevelWheel: enterOrLeave
  })
  const { clearHover } = viewport
  const clearSelection = selection.clear
  const dismissHoverAndSelection = useCallback(() => {
    clearHover()
    clearSelection()
  }, [clearHover, clearSelection])
  useGraphEscape(dismissHoverAndSelection)
  useEffect(() => {
    linkRef.current = {
      canvasRef,
      sceneRef: layout.sceneRef,
      transformRef: viewport.transformRef,
      sizeRef: viewport.sizeRef,
      fit: viewport.fit,
      modules: modulesOn ? { overlay, overrides, names: moduleNames } : null,
      hoverMode: hoverMode.mode,
      selectedId: selection.selected?.id ?? null,
      search: search.focus
    }
    render.requestDraw()
  })

  // 打开图谱时关系分析还没跑过:自动跑一次(失败后等用户点重试,不自动重跑)
  useEffect(() => {
    if (!graph && !graphLoading && !graphNote) onLoadGraph()
  }, [graph, graphLoading, graphNote, onLoadGraph])

  const onKeyDown = graphKeyHandler(nav, search.focusInput)

  const moduleNameOf = (id: string): string | null => {
    const moduleId = moduleOfNode(id)
    const info = moduleId ? overlay.byId.get(moduleId) : undefined
    return info ? (moduleNames.get(info.id) ?? moduleDisplayName(info)) : null
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
        wiki={<GraphWikiEntry wallVisible={graphWall.visible} onToggleWall={graphWall.toggle} />}
        search={<GraphSearch search={search} inputRef={searchInputRef} onLocate={locateHit} />}
      />
      <GraphNotices
        graphNote={graphNote}
        scanFailed={nav.status.kind === 'failed' || expansion.scanFailed}
        onRetry={onLoadGraph}
      />
      {overlayText && <p className="graph-overlay">{overlayText}</p>}
      {tag && (
        <GraphHoverTag
          tag={tag}
          elsewhere={tagModule ? (overlay.elsewhere.get(tagModule) ?? 0) : 0}
        />
      )}
      {/* 看法标签亮着或详情浮窗已展示该节点时提示框让位;拖拽中先收起,松手后再亮;文件夹没有可补的信息 */}
      {hover && hoverTip && <GraphNodeTip key={hover.node.id} anchor={hover} text={hoverTip} />}
      {selection.selected && (
        <GraphSidePanel
          node={selection.selected}
          modules={moduleMap}
          depNodes={depNodes}
          tree={tree}
          dirRel={nav.dirRel}
          colorOf={(id) => moduleSwatchCss(overlay.colorOf.get(id), overrides.get(id))}
          moduleNames={moduleNames}
          wiki={wiki}
          rootPath={result.rootPath}
          onSearchTag={search.searchTag}
          viewRef={viewRef}
          tabId={props.tabId}
          activeTabId={props.activeTabId}
          onClose={selection.clear}
        />
      )}
      {picker.element}
      <p className="graph-foot">{footText(current, modulesOn)}</p>
      {graphWall.visible && (
        <WikiWallLayer rootPath={result.rootPath} wall={graphWall.wall} onClose={graphWall.close} />
      )}
    </div>
  )
}
