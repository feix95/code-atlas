// 关系图谱页签正文:资源管理器的图形视图(drill-down),一次呈现一个目录层级。
// 组合 useGraphNav(层级)· useForceLayout(布局)· useGraphViewport(交互)· useGraphRender(绘制);
// 数据全部来自共享的 ScanResult 与 DepGraphResult,不另起扫描或关系计算。
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DepEdge, DepGraphResult, ScanDirNode, ScanResult } from '@shared/types'
import { buildLevelGraph, type LevelNode } from '@shared/graphView'
import { useGraphNav, type GraphNav } from '../graph/useGraphNav'
import { useForceLayout, type SimNode } from '../graph/useForceLayout'
import { useGraphViewport } from '../graph/useGraphViewport'
import { useGraphRender, type RenderRefs } from '../graph/useGraphRender'
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
  // 切换项目 = 整个画布重建:层级、布局、视口一并归零
  return <GraphCanvas key={result.rootPath} {...props} result={result} />
}

function Crumbs({ rootName, nav }: { rootName: string; nav: GraphNav }): React.JSX.Element {
  const parts = nav.dirRel === '' ? [] : nav.dirRel.split('/')
  const labels = [rootName, ...parts]
  return (
    <nav className="graph-crumbs" aria-label="当前位置">
      {labels.map((label, i) => {
        const last = i === labels.length - 1
        return (
          <span key={i} className="graph-crumb">
            {i > 0 && (
              <span className="graph-crumb-sep" aria-hidden="true">
                /
              </span>
            )}
            <button
              type="button"
              disabled={last}
              aria-current={last ? 'location' : undefined}
              onClick={() => void nav.navigate(parts.slice(0, i).join('/'))}
            >
              {label}
            </button>
          </span>
        )
      })}
    </nav>
  )
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

function describeNode(d: LevelNode): string {
  switch (d.kind) {
    case 'folder':
      return d.lazy
        ? `文件夹 ${d.label}(尚未读取)`
        : `文件夹 ${d.label}(${d.descendantFiles} 个文件)`
    case 'file':
      return `文件 ${d.label}(${d.degree} 条引用)`
    case 'external':
      return `当前文件夹以外 ${d.id}`
    case 'overflow':
      return d.label
  }
}

/** 画布节点的键盘 / 读屏入口:视觉隐藏的按钮清单,Tab 切换焦点即在画布上高亮对应节点 */
function NodeList({
  nodes,
  onActivate,
  onFocusNode
}: {
  nodes: LevelNode[]
  onActivate: (d: LevelNode) => void
  onFocusNode: (id: string | null) => void
}): React.JSX.Element {
  return (
    <ul className="graph-a11y" aria-label="当前文件夹的节点">
      {nodes.map((d) => (
        <li key={d.id}>
          <button
            type="button"
            disabled={d.kind === 'overflow'}
            onClick={() => onActivate(d)}
            onFocus={() => onFocusNode(d.id)}
            onBlur={() => onFocusNode(null)}
          >
            {describeNode(d)}
          </button>
        </li>
      ))}
    </ul>
  )
}

function GraphCanvas({
  result,
  graph,
  graphLoading,
  graphNote,
  onLoadGraph,
  expandLazy,
  onOpenFile
}: GraphViewProps & { result: ScanResult }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const linkRef = useRef<RenderRefs | null>(null)
  const render = useGraphRender(linkRef)
  const nav = useGraphNav({
    tree: result.tree,
    expandLazy,
    onBeforeChange: render.beginLevelTransition
  })
  // 关系分析结果属于别的项目(切换中)时不拿来连线
  const edges = graph && graph.rootPath === result.rootPath ? graph.edges : NO_EDGES
  const level = useMemo(
    () => buildLevelGraph(result.tree, edges, nav.dirRel),
    [result.tree, edges, nav.dirRel]
  )
  const layout = useForceLayout(level, render.requestDraw)
  const activate = useNodeActivate(nav, onOpenFile)
  const onNodeClick = useCallback((n: SimNode) => activate(n.data), [activate])
  const viewport = useGraphViewport({
    canvasRef,
    sceneRef: layout.sceneRef,
    requestDraw: render.requestDraw,
    setDragging: layout.setDragging,
    onNodeClick,
    onHoverChange: render.setHover
  })

  useEffect(() => {
    linkRef.current = {
      canvasRef,
      sceneRef: layout.sceneRef,
      transformRef: viewport.transformRef,
      sizeRef: viewport.sizeRef,
      alpha: layout.alpha,
      fit: viewport.fit
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
    } else if (e.key === 'Escape') viewport.clearHover()
  }

  const scanning = nav.status.kind === 'scanning'
  const empty = !scanning && level !== null && level.nodes.length === 0
  return (
    <div className="graph-view" tabIndex={0} onKeyDown={onKeyDown} aria-label="关系图谱">
      <canvas ref={canvasRef} className="graph-canvas" data-graph-dir={nav.dirRel} />
      <NodeList nodes={level?.nodes ?? []} onActivate={activate} onFocusNode={render.setHover} />
      <div className="graph-bar">
        <Crumbs rootName={result.rootName} nav={nav} />
        <div className="graph-tools">
          {graphLoading && <span className="graph-status">正在分析引用关系…</span>}
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
      {(scanning || empty) && (
        <p className="graph-overlay">{scanning ? '正在读取文件夹…' : '这个文件夹是空的'}</p>
      )}
      <p className="graph-foot">
        连线表示代码里的引用(支持 JS/TS、Python、Go、Java、Rust);没有连线的文件暂未发现引用关系
      </p>
    </div>
  )
}
