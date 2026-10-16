// 选中覆盖层:旋转矩形的描边、四角圆角手柄、顶边外侧的旋转旋钮。
// 多选时每个节点各画一条描边(Figma 式),另加联合外接框与 8 个整体缩放手柄(GroupScaleHandles);
// 圆角/旋转是单对象手势,恰为单选时才显示全套手柄与旋钮。
// 全部用 app 的功能蓝 --sash-hi,只作工具示意不进设计数值。SVG 平铺在视口上(屏幕坐标),
// 本体不拦截指针(pointer-events: none),只有手柄与旋钮热区可点。
import { radiusHandleLocal, rotatePoint, toWorld } from '@shared/uiWorkbench/geometry'
import { CORNERS, EDGES, type CornerIndex, type EdgeName } from '@shared/uiWorkbench/node'
import type { SceneNode } from '@shared/uiWorkbench/scene'
import { selectionRoots } from '@shared/uiWorkbench/tree'
import { cornerResizeCursor, edgeResizeCursor } from '../../uiWorkbench/cursors'
import { nodeOutline } from '../../uiWorkbench/nodeOutline'
import type { CanvasToolsApi } from '../../uiWorkbench/useCanvasTools'
import { GroupScaleHandles } from './GroupScaleHandles'
import type { Viewport } from '../../uiWorkbench/viewport'

/** 角缩放手柄半宽(CSS px)与圆角手柄半径 */
const CORNER_HALF = 4
const HANDLE_R = 4
/** 旋钮圆点半径与悬停热区半径(CSS px) */
const KNOB_R = 4
const KNOB_ZONE_R = 10
/** 旋钮距顶边中点的距离(CSS px) */
const KNOB_GAP = 22
/** 直线端点手柄半径(CSS px) */
const ENDPOINT_R = 5
/** 圆角手柄离角的最小内缩距离(CSS px,随缩放换算成设计单位) */
const RADIUS_MIN_INSET_PX = 10
/** 小于这个屏幕尺寸的矩形不显示圆角手柄(点不准) */
const MIN_SIZE_FOR_HANDLES = 24

interface SP {
  x: number
  y: number
}

export function SelectionOverlay({
  nodes,
  view,
  tools
}: {
  nodes: readonly SceneNode[]
  view: Viewport
  tools: CanvasToolsApi
}): React.JSX.Element {
  const toScreen = (p: { x: number; y: number }): SP => ({
    x: view.panX + p.x * view.zoom,
    y: view.panY + p.y * view.zoom
  })
  const outlines = nodes.map((n) => ({ id: n.id, points: nodeOutline(n, view) }))
  // 手柄/旋钮只服务单选;多选只剩各对象描边。矩形有缩放/圆角/旋转手柄,直线只有两个端点手柄
  // 锁定的节点(只能从图层面板选进来)只画描边,不给任何改动手柄
  const single = nodes.length === 1 && !nodes[0].locked ? nodes[0] : null
  // 变换框只认选集的根:画板与它的后代同在选集里时,后代随画板一起映射,不单独算
  const roots = selectionRoots(
    nodes,
    nodes.map((n) => n.id)
  )
  const canScaleGroup = roots.length > 1 && roots.every((n) => !n.locked)
  const node = single?.type === 'rect' ? single : null
  // 矩形与画板共用缩放手柄(角点 + 边中点);圆角与旋转只有矩形有
  const box = single && single.type !== 'line' ? single : null
  const line = single?.type === 'line' ? single : null
  const outline = box ? outlines[0].points : []
  const showRadius =
    node !== null && Math.min(node.width, node.height) * view.zoom >= MIN_SIZE_FOR_HANDLES
  const topCenter = node ? toScreen(toWorld(node, { x: node.width / 2, y: 0 })) : null
  const outward = node ? rotatePoint({ x: 0, y: -1 }, node.rotation) : { x: 0, y: -1 }
  const knob = topCenter
    ? { x: topCenter.x + outward.x * KNOB_GAP, y: topCenter.y + outward.y * KNOB_GAP }
    : null

  return (
    <svg
      className={`uwb-overlay${tools.activeGesture === 'rotate' ? ' is-knob-live' : ''}`}
      aria-hidden="true"
    >
      {outlines.map((o) => (
        <polygon
          key={o.id}
          className="uwb-sel uwb-sel-node"
          points={o.points.map((p) => `${p.x},${p.y}`).join(' ')}
        />
      ))}
      {canScaleGroup && <GroupScaleHandles nodes={roots} view={view} tools={tools} />}
      {line &&
        outlines[0].points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={ENDPOINT_R}
            className="uwb-endpoint-handle"
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              tools.startEndpointDrag(e, i === 0 ? 'start' : 'end')
            }}
          >
            <title>{i === 0 ? '拖动起点' : '拖动终点'},Shift 吸附 15°</title>
          </circle>
        ))}
      {node && knob && topCenter && (
        <>
          {/* 处理器挂在整个旋钮区:隐形热区(比可见圆点大)也要吃按下,否则冒泡到画布会被当成点空处取消选中 */}
          <g
            className="uwb-knob-zone"
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              tools.startRotateDrag(e)
            }}
          >
            <line
              className="uwb-knob-stem"
              x1={topCenter.x}
              y1={topCenter.y}
              x2={knob.x}
              y2={knob.y}
            />
            <circle cx={knob.x} cy={knob.y} r={KNOB_ZONE_R} className="uwb-knob-hit" />
            <circle cx={knob.x} cy={knob.y} r={KNOB_R} className="uwb-knob">
              <title>拖动旋转,Shift 吸附 15°</title>
            </circle>
          </g>
        </>
      )}
      {box && (
        <>
          {outline.map((p, c) => (
            <rect
              key={c}
              x={p.x - CORNER_HALF}
              y={p.y - CORNER_HALF}
              width={CORNER_HALF * 2}
              height={CORNER_HALF * 2}
              className="uwb-corner-handle"
              style={{ cursor: cornerResizeCursor(box.rotation, c as CornerIndex) }}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                tools.startResizeDrag(e, c as CornerIndex)
              }}
            >
              <title>拖动调整大小,Shift 等比</title>
            </rect>
          ))}
          {/* 边中点柄:只动被拖那条边(PS/Figma 变换框同款),对边钉死 */}
          {EDGES.map((edge) => {
            const mid = toScreen(
              toWorld(box, {
                x: box.width * (edge === 'right' ? 1 : edge === 'left' ? 0 : 0.5),
                y: box.height * (edge === 'bottom' ? 1 : edge === 'top' ? 0 : 0.5)
              })
            )
            const label = { top: '上边', right: '右边', bottom: '下边', left: '左边' }[
              edge as EdgeName
            ]
            return (
              <rect
                key={edge}
                x={mid.x - CORNER_HALF}
                y={mid.y - CORNER_HALF}
                width={CORNER_HALF * 2}
                height={CORNER_HALF * 2}
                className="uwb-edge-handle"
                style={{ cursor: edgeResizeCursor(box.rotation, edge) }}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  tools.startEdgeDrag(e, edge)
                }}
              >
                <title>{`拖动调整${label},Shift 吸附 4`}</title>
              </rect>
            )
          })}
        </>
      )}
      {node && (
        <>
          {showRadius &&
            CORNERS.map((c) => {
              const local = radiusHandleLocal(
                node,
                c,
                node.radii[c],
                RADIUS_MIN_INSET_PX / view.zoom
              )
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
        </>
      )}
    </svg>
  )
}
