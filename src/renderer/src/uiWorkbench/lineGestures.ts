// 直线的两个画布手势:拖出一条新线、拖端点改线。与 useCanvasTools 里的矩形手势同一套约定:
// 一笔手势 = 一个批次 = 一步撤销;只点没拖不留下幽灵对象;Shift 吸 15°,Alt(仅绘制)从中心展开。
import {
  createLine,
  lineEndpointPatch,
  lineFromDrag,
  type LineNode
} from '@shared/uiWorkbench/line'
import type { Point } from '@shared/uiWorkbench/geometry'
import { docActions, getDocState } from './documentStore'
import { getNewLineAppearance } from './newLineDefaultsStore'
import { trackPointer } from './trackPointer'

export interface LineGestureDeps {
  toDesign: (e: { clientX: number; clientY: number }) => Point
  /** 手势结束后(画完 / 调完):调用方把工具回落到选择 */
  onDone: () => void
}

/** 画一条线:add(落点零长)+ 拖动 update + 松手结算(没拖动则回收),外层批次包住;
 *  中途任何一步抛异常都必须把外层批次结掉再抛出,否则批次挂起、撤销永久失灵 */
export function startLineDraw(e: React.PointerEvent, deps: LineGestureDeps): void {
  if (!e.currentTarget.ownerDocument.defaultView) return
  const start = deps.toDesign(e)
  docActions.beginBatch()
  try {
    const prevSelectedIds = getDocState().selectedIds
    const node = createLine(
      getDocState().nodes,
      lineFromDrag(start, start, { isAngleSnap: false, isFromCenter: false }),
      getNewLineAppearance()
    )
    docActions.dispatch({ type: 'add', node })
    docActions.select(node.id)
    trackPointer(
      e,
      (ev) =>
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: lineFromDrag(start, deps.toDesign(ev), {
            isAngleSnap: ev.shiftKey,
            isFromCenter: ev.altKey
          })
        }),
      () => {
        try {
          const fresh = getDocState().nodes.find((n) => n.id === node.id)
          // 只点没拖:两端仍重合 = 没有有效线,回收并还回按下前的选集(与矩形同规矩)
          if (fresh?.type === 'line' && fresh.x1 === fresh.x2 && fresh.y1 === fresh.y2) {
            docActions.dispatch({ type: 'remove', id: node.id })
            docActions.selectIds(prevSelectedIds)
          }
        } finally {
          docActions.endBatch()
        }
        deps.onDone()
      },
      'crosshair'
    )
  } catch (err) {
    docActions.endBatch()
    throw err
  }
}

/** 拖端点:另一端钉死,被拖端跟指针走(Shift 吸 15°) */
export function startLineEndpointDrag(
  e: React.PointerEvent,
  line: LineNode,
  which: 'start' | 'end',
  deps: LineGestureDeps
): void {
  trackPointer(
    e,
    (ev) =>
      docActions.dispatch({
        type: 'update',
        id: line.id,
        patch: lineEndpointPatch(line, which, deps.toDesign(ev), ev.shiftKey)
      }),
    deps.onDone,
    'crosshair'
  )
}
