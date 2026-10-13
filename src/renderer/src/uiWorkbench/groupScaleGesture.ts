// 多选整体缩放手势:按下瞬间的选集 + 联合外接框是基准,拖动每帧都从基准重算(不累积误差),
// 一笔手势 = 一个批次 = 一步撤销。Shift 等比,Alt 以中心为锚(换算见 shared/groupScale.ts)。
import type { Point } from '@shared/uiWorkbench/geometry'
import { scaleBoxByHandle, scaleNodePatch, type ScaleHandle } from '@shared/uiWorkbench/groupScale'
import { unionBox } from '@shared/uiWorkbench/scene'
import { docActions, selectedNodes, getDocState } from './documentStore'
import { trackPointer } from './trackPointer'

/** 手柄方向 → resize 光标:同号角 = 左上右下对角,异号 = 右上左下对角 */
export function scaleHandleCursor(handle: ScaleHandle): string {
  if (handle.dx === 0) return 'ns-resize'
  if (handle.dy === 0) return 'ew-resize'
  return handle.dx === handle.dy ? 'nwse-resize' : 'nesw-resize'
}

export function startGroupScaleDrag(
  e: React.PointerEvent,
  handle: ScaleHandle,
  toDesign: (e: { clientX: number; clientY: number }) => Point
): void {
  if (e.button !== 0) return
  const origins = selectedNodes(getDocState())
  if (origins.length < 2) return
  const from = unionBox(origins)
  trackPointer(
    e,
    (ev) => {
      const to = scaleBoxByHandle(from, handle, toDesign(ev), {
        isProportional: ev.shiftKey,
        isFromCenter: ev.altKey
      })
      for (const origin of origins) {
        docActions.dispatch({
          type: 'update',
          id: origin.id,
          patch: scaleNodePatch(origin, from, to)
        })
      }
    },
    () => {},
    scaleHandleCursor(handle)
  )
}
