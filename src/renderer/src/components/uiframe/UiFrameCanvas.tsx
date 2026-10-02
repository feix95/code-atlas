// UI 框架画布:iframe 渲染规格包同款文档,上面叠一层选中框与拖动手柄。
// 示例页可「适应宽度」:舞台用 CSS zoom 整体缩放(iframe 与选中框同比例),拖动位移按比例换回逻辑像素。
import { useMemo, useRef } from 'react'
import { PARTS } from '@shared/uiFrame/handles'
import type { ThemeName, TokenValue, UiFrameDoc } from '@shared/uiFrame/types'
import { applyTokens, canvasHtml, PAGE_VIEWPORT, type CanvasView } from '../../uiFrame/canvasDoc'
import { currentDoc } from '../../uiFrame/docStore'
import { useCanvasFrame, type CanvasSelection } from '../../uiFrame/useCanvasFrame'
import { useHandleDrag } from '../../uiFrame/useHandleDrag'
import { useMeasured } from '../../uiFrame/useMeasured'

const EDGE_LABEL = { right: '右边', bottom: '下边', corner: '左上角' } as const

export function UiFrameCanvas({
  doc,
  view,
  theme,
  selection,
  fit,
  onSelect,
  onCommit,
  onKey
}: {
  doc: UiFrameDoc
  view: CanvasView
  theme: ThemeName
  /** 示例页适应画布宽度(false = 实际大小) */
  fit: boolean
  selection: CanvasSelection | null
  onSelect: (sel: CanvasSelection | null) => void
  onCommit: (token: string, value: TokenValue) => void
  onKey: (e: KeyboardEvent) => void
}): React.JSX.Element {
  const icons = doc.icons
  // 只有视图或图标变了才重建文档;变量变化走 applyTokens 原地替换,不闪屏
  const srcDoc = useMemo(() => canvasHtml({ ...currentDoc(), icons }, view), [icons, view])
  const minHeight = view === 'page' ? PAGE_VIEWPORT.height : 0
  const { frameRef, selBoxRef, hoverBoxRef, frameDoc, onLoad, fitHeight } = useCanvasFrame({
    doc,
    view,
    theme,
    minHeight,
    selection,
    onSelect,
    onKey
  })
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const avail = useMeasured(
    scrollRef,
    (el) => Math.max(1, el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) * 2),
    PAGE_VIEWPORT.width
  )
  const scale = view === 'page' && fit ? Math.min(1, avail / PAGE_VIEWPORT.width) : 1
  // transform 不改占位:外层盒按缩放后的尺寸占位,舞台高度随 iframe 自适应
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageH = useMeasured(stageRef, (el) => el.offsetHeight, 0)
  const drag = useHandleDrag({
    doc,
    scale,
    onPreview: (draft) => {
      if (!frameDoc) return
      applyTokens(frameDoc, draft)
      fitHeight()
    },
    onCommit
  })
  const part = selection ? PARTS[selection.part] : undefined

  return (
    <div className="uf-canvas-scroll" ref={scrollRef}>
      <div
        className="uf-canvas-fit"
        style={
          view === 'page'
            ? { width: `${PAGE_VIEWPORT.width * scale}px`, height: `${stageH * scale}px` }
            : undefined
        }
      >
        <div
          ref={stageRef}
          className={`uf-canvas-stage${view === 'page' ? ' is-page' : ''}${drag.dragging ? ' is-dragging' : ''}`}
          style={
            view === 'page'
              ? {
                  width: `${PAGE_VIEWPORT.width}px`,
                  transform: scale === 1 ? undefined : `scale(${scale})`
                }
              : undefined
          }
        >
          <iframe
            ref={frameRef}
            className="uf-canvas-frame"
            title={view === 'page' ? '示例页画布' : '组件墙画布'}
            srcDoc={srcDoc}
            onLoad={onLoad}
          />
          <div className="uf-overlay" aria-hidden="true">
            <div ref={hoverBoxRef} className="uf-hover-box" />
            <div ref={selBoxRef} className="uf-sel-box">
              {part?.handles.map((h) => (
                <span
                  key={`${h.edge}-${h.token}`}
                  className={`uf-handle uf-handle--${h.edge}`}
                  data-tip={`拖动${EDGE_LABEL[h.edge]}:${h.label}(按住 Alt 自由拖)`}
                  onPointerDown={(e) => drag.startDrag(e, h)}
                />
              ))}
              {drag.badge && (
                <span className="uf-drag-badge">
                  {drag.badge.label} · {drag.badge.text}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
