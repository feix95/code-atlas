// 画布舞台:左上角块 + 上/左标尺 + 视口(底板)。视口里画板按 平移 + 缩放 摆放,
// 画板名签贴在画板左上方、不随缩放变大小(Figma 同款)。
// 画板内容放在 iframe 里:与应用界面的根字号与样式隔离,应用界面缩放不影响设计数值;
// allow-same-origin 使父页面能往 iframe body 里渲染节点,同时 sandbox 仍禁止 iframe 内跑脚本。
// iframe 不接收指针(pointer-events: none),滚轮与拖动统一由视口坐标换算处理;
// 选中态(描边/圆角手柄/旋转旋钮)画在视口上的屏幕坐标覆盖层,不随缩放变形。
import { useState } from 'react'
import type { ArtboardSize } from '@shared/uiWorkbench/artboard'
import type { WorkbenchDocument } from '@shared/uiWorkbench/export/types'
import type { SceneNode } from '@shared/uiWorkbench/scene'
import type { CanvasToolsApi } from '../../uiWorkbench/useCanvasTools'
import type { CanvasViewportApi } from '../../uiWorkbench/useCanvasViewport'
import { ArtboardNodes } from './ArtboardNodes'
import { Ruler } from './Ruler'
import { SelectionOverlay } from './SelectionOverlay'

/** 画板 iframe 的空白文档;内容经 Portal 注入,样式由 CSS 适配器生成 */
const ARTBOARD_DOC =
  '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>'

export function CanvasStage({
  board,
  doc,
  selectedNodes,
  viewport,
  tools
}: {
  board: ArtboardSize
  doc: WorkbenchDocument
  selectedNodes: readonly SceneNode[]
  viewport: CanvasViewportApi
  tools: CanvasToolsApi
}): React.JSX.Element {
  const { viewportRef, view, panMode, onPointerDown } = viewport
  const [frameBody, setFrameBody] = useState<HTMLBodyElement | null>(null)
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
      <Ruler axis="horizontal" zoom={view.zoom} pan={view.panX} boardLength={board.width} />
      <Ruler axis="vertical" zoom={view.zoom} pan={view.panY} boardLength={board.height} />
      <div
        ref={viewportRef}
        className={`uwb-viewport is-pan-${panMode} is-tool-${tools.tool}`}
        role="region"
        aria-label="画布"
        onPointerDown={handlePointerDown}
      >
        <div
          className="uwb-world"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          {/* 画板尺寸是设计数值(逻辑像素),此处按 px 原样落地,不走 rem */}
          <div className="uwb-artboard" style={{ width: board.width, height: board.height }}>
            <iframe
              ref={syncFrameBody}
              className="uwb-artboard-frame"
              title="画板"
              sandbox="allow-same-origin"
              srcDoc={ARTBOARD_DOC}
              onLoad={(e) => syncFrameBody(e.currentTarget)}
            />
          </div>
        </div>
        <div className="uwb-artboard-label" style={{ left: view.panX, top: view.panY }}>
          {`画板 ${board.width} × ${board.height}`}
        </div>
        {frameBody && <ArtboardNodes body={frameBody} doc={doc} />}
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
