// 画布舞台:左上角块 + 上/左标尺 + 视口(底板)。视口里画板按 平移 + 缩放 摆放,
// 画板名签贴在画板左上方、不随缩放变大小(Figma 同款)。
// 画板内容放在 iframe 里:与应用界面的根字号与样式隔离,应用界面缩放不影响设计数值。
// iframe 暂不接收鼠标(pointer-events: none),滚轮与拖动统一由视口处理。
import type { ArtboardSize } from '@shared/uiWorkbench/artboard'
import type { CanvasViewportApi } from '../../uiWorkbench/useCanvasViewport'
import { Ruler } from './Ruler'

/** 画板 iframe 的空白文档:显式清零默认边距,底色由画板容器提供 */
const ARTBOARD_DOC =
  '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>'

export function CanvasStage({
  board,
  viewport
}: {
  board: ArtboardSize
  viewport: CanvasViewportApi
}): React.JSX.Element {
  const { viewportRef, view, panMode, onPointerDown } = viewport
  return (
    <div className="uwb-canvas">
      <div className="uwb-ruler-corner" aria-hidden="true" />
      <Ruler axis="horizontal" zoom={view.zoom} pan={view.panX} boardLength={board.width} />
      <Ruler axis="vertical" zoom={view.zoom} pan={view.panY} boardLength={board.height} />
      <div
        ref={viewportRef}
        className={`uwb-viewport is-pan-${panMode}`}
        role="region"
        aria-label="画布"
        onPointerDown={onPointerDown}
      >
        <div
          className="uwb-world"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          {/* 画板尺寸是设计数值(逻辑像素),此处按 px 原样落地,不走 rem */}
          <div className="uwb-artboard" style={{ width: board.width, height: board.height }}>
            <iframe className="uwb-artboard-frame" title="画板" sandbox="" srcDoc={ARTBOARD_DOC} />
          </div>
        </div>
        <div className="uwb-artboard-label" style={{ left: view.panX, top: view.panY }}>
          {`画板 ${board.width} × ${board.height}`}
        </div>
      </div>
    </div>
  )
}
