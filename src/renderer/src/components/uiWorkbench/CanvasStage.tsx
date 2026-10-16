// 画布舞台:左上角块 + 上/左标尺 + 视口(无限画布)。视口里按 平移 + 缩放 摆放整页内容:
// 画板是页面里的普通对象,名签贴在画板左上方、不随缩放变大小(Figma 同款)。
// 整页内容画在一张铺满视口的透明 iframe 里:与应用界面的根字号与样式隔离,应用界面缩放不影响设计数值;
// allow-same-origin 使父页面能往 iframe body 里渲染节点,同时 sandbox 仍禁止 iframe 内跑脚本。
// iframe 不接收指针(pointer-events: none),滚轮与拖动统一由视口坐标换算处理;
// 选中态(描边/圆角手柄/旋转旋钮)画在视口上的屏幕坐标覆盖层,不随缩放变形。
import { useMemo, useState } from 'react'
import { pageBackgroundCss, type PageBackground } from '@shared/uiWorkbench/page'
import { unionBox, visibleNodes, type SceneNode } from '@shared/uiWorkbench/scene'
import type { CanvasToolsApi } from '../../uiWorkbench/useCanvasTools'
import type { CanvasViewportApi } from '../../uiWorkbench/useCanvasViewport'
import { FrameLabels } from './FrameLabels'
import { GapMarks } from './GapMarks'
import { LayerHoverOutline } from './LayerHoverOutline'
import { PageNodes } from './PageNodes'
import { Ruler } from './Ruler'
import { SelectionOverlay } from './SelectionOverlay'

/** 画布 iframe 的空白文档;内容经 Portal 注入,样式由 CSS 适配器生成 */
const PAGE_DOC =
  '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>'

export function CanvasStage({
  background,
  nodes,
  selectedNodes,
  viewport,
  tools
}: {
  /** 当前页的画布底色(铺在默认底板之上、内容之下) */
  background: PageBackground
  /** 当前页的全部节点(含隐藏的:名签与渲染各自按需过滤) */
  nodes: readonly SceneNode[]
  selectedNodes: readonly SceneNode[]
  viewport: CanvasViewportApi
  tools: CanvasToolsApi
}): React.JSX.Element {
  const { viewportRef, view, panMode, onPointerDown } = viewport
  const pageColor = pageBackgroundCss(background)
  const shown = useMemo(() => visibleNodes(nodes), [nodes])
  const [frameBody, setFrameBody] = useState<HTMLBodyElement | null>(null)
  // 标尺高亮选中对象的占位;没选中则不画
  const range = selectedNodes.length > 0 ? unionBox(selectedNodes) : null
  // srcDoc 加载时序不可靠:ref 挂载先读一次 body,onLoad 再校正一次(文档被替换时换到新 body)
  const syncFrameBody = (el: HTMLIFrameElement | null): void => {
    const body = el?.contentDocument?.body
    // 不能 instanceof HTMLBodyElement:iframe 文档的构造器属于另一个 realm,跨 realm 恒 false
    const next = body?.tagName === 'BODY' ? (body as HTMLBodyElement) : null
    setFrameBody((prev) => (prev === next ? prev : next))
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    onPointerDown(e) // 空格/中键平移:它 preventDefault 后工具不再处理
    if (!e.defaultPrevented) tools.onPointerDown(e)
  }

  return (
    <div className="uwb-canvas">
      <div className="uwb-ruler-corner" aria-hidden="true" />
      <Ruler
        axis="horizontal"
        zoom={view.zoom}
        pan={view.panX}
        rangeStart={range?.x ?? 0}
        rangeLength={range?.width ?? 0}
      />
      <Ruler
        axis="vertical"
        zoom={view.zoom}
        pan={view.panY}
        rangeStart={range?.y ?? 0}
        rangeLength={range?.height ?? 0}
      />
      <div
        ref={viewportRef}
        className={`uwb-viewport is-pan-${panMode} is-tool-${tools.tool}`}
        role="region"
        aria-label="画布"
        onPointerDown={handlePointerDown}
      >
        {pageColor && (
          <div className="uwb-page-bg" style={{ backgroundColor: pageColor }} aria-hidden="true" />
        )}
        <iframe
          ref={syncFrameBody}
          className="uwb-page-frame"
          title="画布内容"
          sandbox="allow-same-origin"
          srcDoc={PAGE_DOC}
          onLoad={(e) => syncFrameBody(e.currentTarget)}
        />
        {frameBody && <PageNodes body={frameBody} nodes={nodes} view={view} />}
        <FrameLabels
          nodes={nodes}
          selectedIds={selectedNodes.map((n) => n.id)}
          view={view}
          onPress={tools.startFrameDrag}
        />
        {(tools.guides.v || tools.guides.h) && (
          <svg className="uwb-overlay" aria-hidden="true">
            {tools.guides.v && (
              <line
                className="uwb-guide"
                x1={view.panX + tools.guides.v.x * view.zoom}
                y1={view.panY + tools.guides.v.y1 * view.zoom}
                x2={view.panX + tools.guides.v.x * view.zoom}
                y2={view.panY + tools.guides.v.y2 * view.zoom}
              />
            )}
            {tools.guides.h && (
              <line
                className="uwb-guide"
                x1={view.panX + tools.guides.h.x1 * view.zoom}
                y1={view.panY + tools.guides.h.y * view.zoom}
                x2={view.panX + tools.guides.h.x2 * view.zoom}
                y2={view.panY + tools.guides.h.y * view.zoom}
              />
            )}
          </svg>
        )}
        {tools.gaps.length > 0 && <GapMarks marks={tools.gaps} view={view} />}
        <LayerHoverOutline nodes={shown} view={view} />
        {selectedNodes.length > 0 && (
          <SelectionOverlay nodes={selectedNodes} view={view} tools={tools} />
        )}
        {/* 框选手势中的虚线选框:设计单位 → 屏幕坐标,只作手势示意不进设计数值 */}
        {tools.marquee && (
          <svg className="uwb-overlay" aria-hidden="true">
            <rect
              className="uwb-marquee"
              x={view.panX + tools.marquee.x * view.zoom}
              y={view.panY + tools.marquee.y * view.zoom}
              width={tools.marquee.width * view.zoom}
              height={tools.marquee.height * view.zoom}
            />
          </svg>
        )}
      </div>
    </div>
  )
}
