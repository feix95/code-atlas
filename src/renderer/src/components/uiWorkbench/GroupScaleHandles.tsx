// 多选变换框:联合外接框的描边 + 8 个缩放手柄(4 角 + 4 边中点),PS / Figma 同款。
// 画在选中覆盖层的 <svg> 里(屏幕坐标);手柄拖动 = 整体缩放(Shift 等比,Alt 以中心为锚)。
import { SCALE_HANDLES } from '@shared/uiWorkbench/groupScale'
import { unionBox, type SceneNode } from '@shared/uiWorkbench/scene'
import { scaleHandleCursor } from '../../uiWorkbench/groupScaleGesture'
import type { CanvasToolsApi } from '../../uiWorkbench/useCanvasTools'
import type { Viewport } from '../../uiWorkbench/viewport'

const HANDLE_HALF = 4

export function GroupScaleHandles({
  nodes,
  view,
  tools
}: {
  nodes: readonly SceneNode[]
  view: Viewport
  tools: CanvasToolsApi
}): React.JSX.Element {
  const box = unionBox(nodes)
  const left = view.panX + box.x * view.zoom
  const top = view.panY + box.y * view.zoom
  const width = box.width * view.zoom
  const height = box.height * view.zoom
  return (
    <>
      <rect className="uwb-sel uwb-sel-union" x={left} y={top} width={width} height={height} />
      {SCALE_HANDLES.map((h) => (
        <rect
          key={h.id}
          x={left + ((h.dx + 1) / 2) * width - HANDLE_HALF}
          y={top + ((h.dy + 1) / 2) * height - HANDLE_HALF}
          width={HANDLE_HALF * 2}
          height={HANDLE_HALF * 2}
          className={h.dx !== 0 && h.dy !== 0 ? 'uwb-corner-handle' : 'uwb-edge-handle'}
          style={{ cursor: scaleHandleCursor(h) }}
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            tools.startGroupScale(e, h)
          }}
        >
          <title>整体缩放,Shift 等比,Alt 以中心为锚</title>
        </rect>
      ))}
    </>
  )
}
