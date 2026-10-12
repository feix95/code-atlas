// 选中覆盖层:旋转矩形的描边、四角圆角手柄、顶边外侧的旋转旋钮。
// 全部用 app 的功能蓝 --sash-hi,只作工具示意不进设计数值。SVG 平铺在视口上(屏幕坐标),
// 本体不拦截指针(pointer-events: none),只有手柄与旋钮热区可点。
import { cornerLocal, radiusHandleLocal, rotatePoint, toWorld } from '@shared/uiWorkbench/geometry'
import { CORNERS, type CornerIndex, type RectNode } from '@shared/uiWorkbench/node'
import { cornerResizeCursor } from '../../uiWorkbench/cursors'
import type { CanvasToolsApi } from '../../uiWorkbench/useCanvasTools'
import type { Viewport } from '../../uiWorkbench/viewport'

/** 角缩放手柄半宽(CSS px)与圆角手柄半径 */
const CORNER_HALF = 4
const HANDLE_R = 4
/** 旋钮圆点半径与悬停热区半径(CSS px) */
const KNOB_R = 4
const KNOB_ZONE_R = 10
/** 旋钮距顶边中点的距离(CSS px) */
const KNOB_GAP = 22
/** 圆角手柄离角的最小内缩距离(CSS px,随缩放换算成设计单位) */
const RADIUS_MIN_INSET_PX = 10
/** 小于这个屏幕尺寸的矩形不显示圆角手柄(点不准) */
const MIN_SIZE_FOR_HANDLES = 24

interface SP {
  x: number
  y: number
}

export function SelectionOverlay({
  node,
  view,
  tools
}: {
  node: RectNode
  view: Viewport
  tools: CanvasToolsApi
}): React.JSX.Element {
  const toScreen = (p: { x: number; y: number }): SP => ({
    x: view.panX + p.x * view.zoom,
    y: view.panY + p.y * view.zoom
  })
  const outline = CORNERS.map((c) => toScreen(toWorld(node, cornerLocal(node, c))))
  const showRadius = Math.min(node.width, node.height) * view.zoom >= MIN_SIZE_FOR_HANDLES
  const topCenter = toScreen(toWorld(node, { x: node.width / 2, y: 0 }))
  const outward = rotatePoint({ x: 0, y: -1 }, node.rotation)
  const knob = { x: topCenter.x + outward.x * KNOB_GAP, y: topCenter.y + outward.y * KNOB_GAP }

  return (
    <svg
      className={`uwb-overlay${tools.activeGesture === 'rotate' ? ' is-knob-live' : ''}`}
      aria-hidden="true"
    >
      <polygon className="uwb-sel" points={outline.map((p) => `${p.x},${p.y}`).join(' ')} />
      {/* 处理器挂在整个旋钮区:隐形热区(比可见圆点大)也要吃按下,否则冒泡到画布会被当成点空处取消选中 */}
      <g
        className="uwb-knob-zone"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          tools.startRotateDrag(e)
        }}
      >
        <line className="uwb-knob-stem" x1={topCenter.x} y1={topCenter.y} x2={knob.x} y2={knob.y} />
        <circle cx={knob.x} cy={knob.y} r={KNOB_ZONE_R} className="uwb-knob-hit" />
        <circle cx={knob.x} cy={knob.y} r={KNOB_R} className="uwb-knob">
          <title>拖动旋转,Shift 吸附 15°</title>
        </circle>
      </g>
      {outline.map((p, c) => (
        <rect
          key={c}
          x={p.x - CORNER_HALF}
          y={p.y - CORNER_HALF}
          width={CORNER_HALF * 2}
          height={CORNER_HALF * 2}
          className="uwb-corner-handle"
          style={{ cursor: cornerResizeCursor(node.rotation, c as CornerIndex) }}
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            tools.startResizeDrag(e, c as CornerIndex)
          }}
        >
          <title>拖动调整大小,Shift 等比</title>
        </rect>
      ))}
      {showRadius &&
        CORNERS.map((c) => {
          const local = radiusHandleLocal(node, c, node.radii[c], RADIUS_MIN_INSET_PX / view.zoom)
          const p = toScreen(toWorld(node, local))
          return (
            <circle
              key={c}
              cx={p.x}
              cy={p.y}
              r={HANDLE_R}
              className="uwb-radius-handle"
              style={{ cursor: cornerResizeCursor(node.rotation, c) }}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                tools.startRadiusDrag(e, c)
              }}
            >
              <title>拖动调圆角,Ctrl 只调该角,Shift 吸附 4</title>
            </circle>
          )
        })}
    </svg>
  )
}
