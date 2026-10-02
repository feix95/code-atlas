// UI 框架画布:iframe 渲染规格包同款文档,上面叠一层选中框与拖动手柄。
// 「适应宽度」用 transform: scale() 整体缩放(iframe 与选中框同比例),拖动位移按比例换回逻辑像素。
// 手机端(§5.4):外层套设备外框(状态栏 / 灵动岛 / 底部手势条 / 安全区线),iframe 定高内滚。
import { useMemo, useRef } from 'react'
import { deviceFor } from '@shared/uiFrame/devices'
import { PARTS } from '@shared/uiFrame/handles'
import type { ThemeName, TokenValue, UiFrameDoc } from '@shared/uiFrame/types'
import { applyTokens, canvasHtml } from '../../uiFrame/canvasDoc'
import { currentDoc } from '../../uiFrame/docStore'
import { useCanvasFrame, type CanvasSelection } from '../../uiFrame/useCanvasFrame'
import { useHandleDrag } from '../../uiFrame/useHandleDrag'
import { useMeasured } from '../../uiFrame/useMeasured'
import type { CanvasView } from '../../uiFrame/canvasDoc'

const EDGE_LABEL = { right: '右边', bottom: '下边', corner: '左上角' } as const

/** 状态栏右侧信号组(设备外框装饰,纯展示) */
function StatusGlyphs(): React.JSX.Element {
  return (
    <svg className="uf-statusbar-glyphs" viewBox="0 0 56 12" aria-hidden="true" focusable="false">
      <g fill="currentColor" stroke="none">
        <rect x="0" y="7" width="3" height="5" rx="1" />
        <rect x="4.5" y="5" width="3" height="7" rx="1" />
        <rect x="9" y="3" width="3" height="9" rx="1" />
        <rect x="13.5" y="1" width="3" height="11" rx="1" />
        <circle cx="27" cy="10.3" r="1" />
        <rect x="37.5" y="3.5" width="10" height="5" rx="1" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <path d="M21 6.5a6.5 6.5 0 0 1 12 0" />
        <path d="M23.5 8.8a3.8 3.8 0 0 1 7 0" />
        <rect x="36" y="1.5" width="15" height="9" rx="2.5" />
        <path d="M52.5 4.5v3" />
      </g>
    </svg>
  )
}

/** 手机外框内、屏幕之上的装饰层:状态栏 + 灵动岛 + 底部手势条 + 安全区线 */
function DeviceChrome({
  statusBar,
  homeBar,
  island,
  safeArea,
  dark
}: {
  statusBar: number
  homeBar: number
  island: boolean
  safeArea: boolean
  /** 跟随页面主题:暗色页面用浅色图标 */
  dark: boolean
}): React.JSX.Element {
  return (
    <div
      className="uf-chrome"
      style={{ color: dark ? 'var(--tip-ink)' : 'var(--text)' }}
      aria-hidden="true"
    >
      <div className="uf-statusbar" style={{ height: `${statusBar}px` }}>
        <span className="uf-statusbar-time">9:41</span>
        <StatusGlyphs />
      </div>
      {island && <span className="uf-island" />}
      <div className="uf-homebar" style={{ height: `${homeBar}px` }}>
        <span className="uf-homebar-pill" />
      </div>
      {safeArea && (
        <>
          <span className="uf-safe-line uf-safe-line--top" style={{ top: `${statusBar}px` }} />
          <span className="uf-safe-line uf-safe-line--bottom" style={{ bottom: `${homeBar}px` }} />
        </>
      )}
    </div>
  )
}

export function UiFrameCanvas({
  doc,
  view,
  theme,
  selection,
  fit,
  chrome,
  safeArea,
  onSelect,
  onCommit,
  onKey
}: {
  doc: UiFrameDoc
  view: CanvasView
  theme: ThemeName
  /** 示例页适应画布宽度(false = 实际大小);手机端恒按宽度适应 */
  fit: boolean
  /** 设备外框(§5.4 装饰元素);手机=机身,桌面=窗口框 */
  chrome: boolean
  /** 手机端画安全区参考线 */
  safeArea: boolean
  selection: CanvasSelection | null
  onSelect: (sel: CanvasSelection | null) => void
  onCommit: (token: string, value: TokenValue) => void
  onKey: (e: KeyboardEvent) => void
}): React.JSX.Element {
  const dev = deviceFor(doc)
  const isPhone = dev.platform === 'phone'
  const icons = doc.icons
  // 只有视图/平台/图标变了才重建文档;变量变化走 applyTokens 原地替换,不闪屏。
  // doc.platform 是依赖信号:平台切换换整页结构(desktop home ↔ phone app),必须重建 iframe。
  const srcDoc = useMemo(() => {
    void doc.platform
    return canvasHtml({ ...currentDoc(), icons }, view)
  }, [icons, view, doc.platform])
  const { frameRef, selBoxRef, hoverBoxRef, frameDoc, onLoad, fitHeight } = useCanvasFrame({
    doc,
    view,
    theme,
    viewport: { height: isPhone || view === 'page' ? dev.height : 0, fixed: isPhone },
    selection,
    onSelect,
    onKey
  })
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const avail = useMeasured(
    scrollRef,
    (el) => Math.max(1, el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) * 2),
    dev.width
  )
  // 舞台外框尺寸由内容决定(手机含机身边框):量出来再定缩放比
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageSize = useMeasured(stageRef, (el) => ({ w: el.offsetWidth, h: el.offsetHeight }), {
    w: dev.width,
    h: dev.height
  })
  const fixedStage = view === 'page' || isPhone
  const wantFit = (view === 'page' && fit) || isPhone
  const scale = wantFit ? Math.min(1, avail / Math.max(1, stageSize.w)) : 1
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

  const overlay = (
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
  )

  const frame = (
    <iframe
      ref={frameRef}
      className="uf-canvas-frame"
      title={view === 'page' ? '示例页画布' : view === 'board' ? '变量板画布' : '组件墙画布'}
      srcDoc={srcDoc}
      onLoad={onLoad}
    />
  )

  // 屏幕区域:选中框对齐的基准;手机端定高(iframe 内滚),桌面端随内容长高
  const screen = (
    <div
      className="uf-screen"
      style={
        isPhone
          ? { width: `${dev.width}px`, height: `${dev.height}px` }
          : view === 'page'
            ? { width: `${dev.width}px` }
            : undefined
      }
    >
      {frame}
      {isPhone && chrome && (
        <DeviceChrome
          statusBar={dev.statusBar}
          homeBar={dev.homeBar}
          island={dev.island}
          safeArea={safeArea}
          dark={theme === 'dark'}
        />
      )}
      {overlay}
    </div>
  )

  return (
    <div className="uf-canvas-scroll" ref={scrollRef}>
      <div
        className="uf-canvas-fit"
        style={
          fixedStage
            ? { width: `${stageSize.w * scale}px`, height: `${stageSize.h * scale}px` }
            : undefined
        }
      >
        <div
          ref={stageRef}
          className={`uf-canvas-stage${view === 'page' ? ' is-page' : ''}${isPhone ? ' is-device' : ''}${drag.dragging ? ' is-dragging' : ''}`}
          style={{
            transform: scale === 1 ? undefined : `scale(${scale})`
          }}
        >
          {isPhone ? (
            <div className={`uf-device${chrome ? '' : ' is-plain'}`}>{screen}</div>
          ) : view === 'page' && chrome ? (
            <div className="uf-window">
              <div className="uf-window-bar">
                <span className="uf-window-dot" />
                <span className="uf-window-dot" />
                <span className="uf-window-dot" />
              </div>
              {screen}
            </div>
          ) : (
            screen
          )}
        </div>
      </div>
    </div>
  )
}
