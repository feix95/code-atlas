// UI 框架画布:iframe 渲染规格包同款文档,上面叠一层选中框与拖动手柄。
// 「适应宽度」用 transform: scale() 整体缩放(iframe 与选中框同比例),拖动位移按比例换回逻辑像素。
// 手机端(§5.4):外层套设备外框(状态栏 / 灵动岛 / 底部手势条 / 安全区线),iframe 定高内滚。
import { useEffect, useMemo, useRef } from 'react'
import { deviceFor } from '@shared/uiFrame/devices'
import { PARTS } from '@shared/uiFrame/handles'
import { BLANK_ID } from '@shared/uiFrame/templates'
import type { ThemeName, TokenValue, UiFrameDoc } from '@shared/uiFrame/types'
import { applyTokens, canvasHtml, VIEW_LABEL } from '../../uiFrame/canvasDoc'
import { currentDoc, docActions } from '../../uiFrame/docStore'
import { selectionOf, useCanvasFrame, type CanvasSelection } from '../../uiFrame/useCanvasFrame'
import { useHandleDrag } from '../../uiFrame/useHandleDrag'
import { useMeasured } from '../../uiFrame/useMeasured'
import { jumpView, useWorkbench, workbenchActions } from '../../uiFrame/workbenchStore'
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
  const { jump, blankExample, placedSel, dragPart } = useWorkbench()
  // 只有视图/平台/图标变了才重建文档;变量变化走 applyTokens 原地替换,不闪屏。
  // doc.platform 是依赖信号:平台切换换整页结构(desktop home ↔ phone app),必须重建 iframe。
  // 底板摆放也触发重建:零件增减/属性变化需要新文档;变量仍走 applyTokens 热替换
  const srcDoc = useMemo(() => {
    void doc.platform
    void doc.placed
    return canvasHtml({ ...currentDoc(), icons }, view)
  }, [icons, view, doc.platform, doc.placed])
  const { frameRef, selBoxRef, hoverBoxRef, frameDoc, onLoad, fitHeight } = useCanvasFrame({
    doc,
    view,
    theme,
    viewport: { height: isPhone || view === 'bench' ? dev.height : 0, fixed: isPhone },
    selection,
    placedSel,
    onSelect,
    onSelectPlaced: (id) => workbenchActions.selectPlaced(id),
    onMovePlaced: (id, x, y) => docActions.movePlaced(id, x, y),
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
  const fixedStage = view === 'bench' || isPhone
  const wantFit = (view === 'bench' && fit) || isPhone
  const scale = wantFit ? Math.min(1, avail / Math.max(1, stageSize.w)) : 1
  // 空白起步的底板:设备框里不渲染示例页,只留空态提示与「填入示例页」出口(界面上方浮层,不占方案数据)
  const blankBench =
    view === 'bench' && doc.template === BLANK_ID && !blankExample && doc.placed.length === 0

  // 零件盒/检查面板的定位请求:目标视图的文档就绪后滚动到位,图标/变量顺带选中(进属性面板)
  useEffect(() => {
    if (!frameDoc || !jump || jumpView(jump.target) !== view) return
    const t = jump.target
    const el =
      t.kind === 'component'
        ? frameDoc.querySelector(`[data-uf-wall="${t.id}"]`)
        : t.kind === 'boardGroup'
          ? frameDoc.querySelector(`[data-uf-board-group="${t.group}"]`)
          : t.kind === 'token'
            ? frameDoc.querySelector(`[data-uf-part="tok:${t.name}"]`)
            : frameDoc.querySelector(`[data-uf-icon="${t.slot}"]`)
    workbenchActions.clearJump()
    if (!el) return
    const frame = frameRef.current
    const scroll = scrollRef.current
    if (isPhone) {
      // 手机端 iframe 定高内滚,元素交给它自己滚
      el.scrollIntoView()
    } else if (frame && scroll) {
      // 元素在 iframe 内的位置 × 舞台缩放 + iframe 在滚动容器里的位置
      const top =
        scroll.scrollTop +
        frame.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        el.getBoundingClientRect().top * scale -
        24
      scroll.scrollTop = Math.max(0, top)
    }
    if (t.kind === 'token' || t.kind === 'icon') onSelect(selectionOf(el, frameDoc))
  }, [frameDoc, jump, view, isPhone, scale, onSelect, frameRef])
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
      title={`${VIEW_LABEL[view]}画布`}
      srcDoc={srcDoc}
      onLoad={onLoad}
      style={dragPart ? { pointerEvents: 'none' } : undefined}
    />
  )

  // 底板拖放(M3-a):零件盒拖过来的配方落在屏幕区域;拖动时 iframe 关 pointer-events 好让 drop 传到父层
  const screenEl = useRef<HTMLDivElement | null>(null)
  const onDropPart = (e: React.DragEvent): void => {
    if (view !== 'bench') return
    const recipe = e.dataTransfer.getData('application/x-uiframe-part')
    if (!recipe) return
    e.preventDefault()
    const rect = screenEl.current?.getBoundingClientRect()
    if (!rect) return
    // 屏幕坐标 → 底板内容坐标:除掉舞台缩放,手机端补 iframe 内部滚动位移
    const frameScroll = frameDoc?.documentElement.scrollTop ?? 0
    const x = (e.clientX - rect.left) / scale
    const y = (e.clientY - rect.top) / scale + (isPhone ? frameScroll : 0)
    const id = docActions.addPlaced(recipe, x, y)
    workbenchActions.selectPlaced(id)
    workbenchActions.setDragPart(null)
  }

  // 屏幕区域:选中框对齐的基准;手机端定高(iframe 内滚),桌面端随内容长高
  const screen = (
    <div
      ref={screenEl}
      className="uf-screen"
      style={
        isPhone
          ? { width: `${dev.width}px`, height: `${dev.height}px` }
          : view === 'bench'
            ? { width: `${dev.width}px` }
            : undefined
      }
      onDragOver={dragPart ? (e) => e.preventDefault() : undefined}
      onDrop={onDropPart}
    >
      {frame}
      {blankBench && (
        <div className="uf-bench-empty">
          <p className="uf-bench-empty-title">底板是空的</p>
          <p className="uf-bench-empty-hint">
            把零件盒里的组件拖上来,或双击落一块;也可以先填入示例页再改。
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => workbenchActions.fillExample()}
          >
            填入示例页看看
          </button>
        </div>
      )}
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
          className={`uf-canvas-stage${view === 'bench' ? ' is-page' : ''}${isPhone ? ' is-device' : ''}${drag.dragging ? ' is-dragging' : ''}`}
          style={{
            transform: scale === 1 ? undefined : `scale(${scale})`
          }}
        >
          {isPhone ? (
            <div className={`uf-device${chrome ? '' : ' is-plain'}`}>{screen}</div>
          ) : view === 'bench' && chrome ? (
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
