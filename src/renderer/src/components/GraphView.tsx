// 关系图谱页签正文:资源管理器的图形视图(drill-down),一次呈现一个目录层级,
// 在真实文件夹结构上叠加程序切出的模块(划分:轮廓、色环、聚类力)。
// 组合 useGraphNav(层级)· useForceLayout(布局)· useGraphViewport(交互)· useGraphRender(绘制)
// · useGraphSelection(选中与高亮);数据全部来自共享的 ScanResult 与 DepGraphResult,不另起扫描或关系计算。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DepEdge, DepGraphNode, DepGraphResult, ScanDirNode, ScanResult } from '@shared/types'
import { buildLevelGraph, type LevelNode } from '@shared/graphView'
import { useGraphNav, type GraphNav } from '../graph/useGraphNav'
import { useForceLayout, type SimNode } from '../graph/useForceLayout'
import { useGraphViewport } from '../graph/useGraphViewport'
import { useGraphRender, type RenderRefs } from '../graph/useGraphRender'
import { buildModuleOverlay, moduleDisplayName } from '../graph/moduleOverlay'
import { nodeMenuItems, useGraphSelection } from '../graph/useGraphSelection'
import { openContextMenu } from './contextMenuStore'
import { Crumbs, NodeList } from './GraphNodeList'
import { GraphSidePanel } from './GraphSidePanel'
import { Notice } from './Notice'
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

const FOOT_EDGES =
  '连线表示代码里的引用(支持 JS/TS、Python、Go、Java、Rust);没有连线的文件暂未发现引用关系'

/** 底栏说明:模块数据缺席或为空时说清楚;模块着色开着时补一句轮廓的含义 */
function footText(graph: DepGraphResult | null, modulesOn: boolean): string {
  if (graph && graph.modules === null) return '模块划分没算出来,先按原始结构显示'
  if (graph?.modules && graph.modules.modules.length === 0) return '未发现可划分的代码模块'
  return modulesOn ? `${FOOT_EDGES};彩色轮廓圈出程序划分的模块` : FOOT_EDGES
}

const isFolderTarget = (d: LevelNode): boolean =>
  d.kind === 'folder' || (d.kind === 'external' && d.target === 'folder')

function ModuleToggle({
  isOn,
  onToggle
}: {
  isOn: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="graph-toggle"
      aria-pressed={isOn}
      onClick={onToggle}
      data-tip={isOn ? '关闭后只看原始文件夹结构' : '在图上圈出程序划分的模块'}
    >
      <span className="graph-toggle-dot" aria-hidden="true" />
      模块着色
    </button>
  )
}

function GraphCanvas(props: GraphViewProps & { result: ScanResult }): React.JSX.Element {
  const { result, graph, graphLoading, graphNote, onLoadGraph, expandLazy, onOpenFile } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
  const level = useMemo(
    () => buildLevelGraph(result.tree, edges, nav.dirRel),
    [result.tree, edges, nav.dirRel]
  )
  const overlay = useMemo(
    () => buildModuleOverlay(level?.nodes ?? [], nav.dirRel, moduleMap),
    [level, nav.dirRel, moduleMap]
  )
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
  const moduleOfNode = useCallback(
    (id: string) => overlay.nodes.get(id)?.hullModule ?? null,
    [overlay]
  )
  const onNodeContextMenu = useCallback(
    (n: SimNode, x: number, y: number) => {
      const moduleId = moduleOfNode(n.id)
      openContextMenu({
        x,
        y,
        doc: canvasRef.current?.ownerDocument ?? document,
        items: nodeMenuItems(n.data, {
          moduleId,
          isHighlighted: moduleId !== null && selection.highlight === moduleId,
          onDetails: () => selection.select(n.data),
          onToggleHighlight: () => moduleId && selection.toggleHighlight(moduleId),
          onActivate: () => activate(n.data)
        })
      })
    },
    [activate, moduleOfNode, selection]
  )
  const viewport = useGraphViewport({
    canvasRef,
    sceneRef: layout.sceneRef,
    requestDraw: render.requestDraw,
    setDragging: layout.setDragging,
    onNodeClick: (n) => selection.select(n.data),
    onBlankClick: selection.clear,
    onNodeDoubleClick: (n) => {
      // 进入文件夹后旧选中已不在画面里,侧栏一并收起;打开文件则保留选中
      if (isFolderTarget(n.data)) selection.select(null)
      activate(n.data)
    },
    onNodeContextMenu,
    onHoverChange: render.setHover
  })
  useEffect(() => {
    centerRef.current = viewport.centerOn
  }, [viewport.centerOn])
  const modulesOn = showModules && overlay.nodes.size > 0

  useEffect(() => {
    linkRef.current = {
      canvasRef,
      sceneRef: layout.sceneRef,
      transformRef: viewport.transformRef,
      sizeRef: viewport.sizeRef,
      alpha: layout.alpha,
      fit: viewport.fit,
      modules: modulesOn ? { overlay, highlight: selection.highlight } : null,
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
    <div className="graph-view" tabIndex={0} onKeyDown={onKeyDown} aria-label="关系图谱">
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        data-graph-dir={nav.dirRel}
        data-graph-hulls={modulesOn ? overlay.hulls.size : 0}
      />
      <NodeList
        nodes={level?.nodes ?? []}
        moduleNameOf={moduleNameOf}
        onActivate={activate}
        onFocusNode={render.setHover}
      />
      <div className="graph-bar">
        <Crumbs rootName={result.rootName} nav={nav} />
        <div className="graph-tools">
          {graphLoading && <span className="graph-status">正在分析引用关系…</span>}
          {moduleMap && moduleMap.modules.length > 0 && (
            <ModuleToggle isOn={showModules} onToggle={() => setShowModules((v) => !v)} />
          )}
          <button
            type="button"
            className="graph-tool"
            onClick={viewport.fit}
            data-tip="适应画布"
            aria-label="适应画布"
          >
            <TreeIcon name="expand" size={16} mono />
          </button>
        </div>
      </div>
      <div className="graph-notices">
        {graphNote && (
          <Notice kind="error">
            引用关系分析失败:{graphNote}
            <button type="button" className="graph-retry" onClick={onLoadGraph}>
              重试
            </button>
          </Notice>
        )}
        {nav.status.kind === 'failed' && (
          <Notice kind="error">这个文件夹暂时打不开,请稍后再试</Notice>
        )}
      </div>
      {overlayText && <p className="graph-overlay">{overlayText}</p>}
      {selection.selected && (
        <GraphSidePanel
          node={selection.selected}
          modules={moduleMap}
          depNodes={depNodes}
          dirRel={nav.dirRel}
          highlight={selection.highlight}
          colorOf={(id) => overlay.colorOf.get(id)}
          onClose={selection.clear}
          onOpenFile={onOpenFile}
          onFocusFile={selection.focusFile}
          onToggleHighlight={selection.toggleHighlight}
        />
      )}
      <p className="graph-foot">{footText(current, modulesOn)}</p>
    </div>
  )
}
