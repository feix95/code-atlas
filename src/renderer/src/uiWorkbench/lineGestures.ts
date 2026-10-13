// 直线的两个画布手势:拖出一条新线、拖端点改线。与 useCanvasTools 里的矩形手势同一套约定:
// 一笔手势 = 一个批次 = 一步撤销;只点没拖不留下幽灵对象;Shift 吸 15°,Alt(仅绘制)从中心展开。
// 端点对齐吸附(Figma 式):被拖的点向其他对象的边/中线、画板边、以及本线另一端靠拢(顺手吸出水平/垂直),
// 阈值内即吸并画引导线;Shift(吸角)或 Ctrl/Cmd(临时禁吸)按住时不吸。
import {
  createLine,
  lineEndpointPatch,
  lineFromDrag,
  type LineNode
} from '@shared/uiWorkbench/line'
import type { Point } from '@shared/uiWorkbench/geometry'
import type { SnapBox, SnapGuides } from '@shared/uiWorkbench/snap'
import { docActions, getDocState } from './documentStore'
import { getNewLineAppearance } from './newLineDefaultsStore'
import { trackPointer, type DragEventLike } from './trackPointer'

const NO_GUIDES: SnapGuides = { v: null, h: null }

export interface LineGestureDeps {
  toDesign: (e: { clientX: number; clientY: number }) => Point
  /** 手势结束后(画完 / 调完):调用方把工具回落到选择 */
  onDone: () => void
  /** 把一个点吸向对齐目标(排除 excludeIds 的节点 + 画板 + extra),返回吸后的点与引导线 */
  snapPoint: (
    point: Point,
    excludeIds: readonly string[],
    extra: readonly SnapBox[]
  ) => { point: Point; guides: SnapGuides }
  setGuides: (guides: SnapGuides) => void
}

interface PointerPoint {
  point: Point
  /** 是否被吸附过(吸上的坐标可能是 .5,导出要保留小数) */
  isSnapped: boolean
}

function pointBox(p: Point): SnapBox {
  return { x: p.x, y: p.y, width: 0, height: 0 }
}

/** 指针 → 设计坐标,按需吸附并同步引导线;Shift/Ctrl/Cmd 按住时原样返回 */
function resolvePointer(
  ev: DragEventLike,
  deps: LineGestureDeps,
  excludeIds: readonly string[],
  extra: readonly SnapBox[]
): PointerPoint {
  const raw = deps.toDesign(ev)
  if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
    deps.setGuides(NO_GUIDES)
    return { point: raw, isSnapped: false }
  }
  const snapped = deps.snapPoint(raw, excludeIds, extra)
  deps.setGuides(snapped.guides)
  return { point: snapped.point, isSnapped: snapped.guides.v !== null || snapped.guides.h !== null }
}

/** 画一条线:add(落点零长)+ 拖动 update + 松手结算(没拖动则回收),外层批次包住;
 *  中途任何一步抛异常都必须把外层批次结掉再抛出,否则批次挂起、撤销永久失灵 */
export function startLineDraw(e: React.PointerEvent, deps: LineGestureDeps): void {
  if (!e.currentTarget.ownerDocument.defaultView) return
  docActions.beginBatch()
  try {
    const prevSelectedIds = getDocState().selectedIds
    const first = resolvePointer(e, deps, [], [])
    const start = first.point
    const node = createLine(
      getDocState().nodes,
      lineFromDrag(start, start, {
        isAngleSnap: false,
        isFromCenter: false,
        isPrecise: first.isSnapped
      }),
      getNewLineAppearance()
    )
    docActions.dispatch({ type: 'add', node })
    docActions.select(node.id)
    trackPointer(
      e,
      (ev) => {
        const end = resolvePointer(ev, deps, [node.id], [pointBox(start)])
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: lineFromDrag(start, end.point, {
            isAngleSnap: ev.shiftKey,
            isFromCenter: ev.altKey,
            isPrecise: first.isSnapped || end.isSnapped
          })
        })
      },
      () => {
        deps.setGuides(NO_GUIDES)
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

/** 拖端点:另一端钉死,被拖端跟指针走(Shift 吸 15°,否则向其他对象与本线另一端对齐吸附) */
export function startLineEndpointDrag(
  e: React.PointerEvent,
  line: LineNode,
  which: 'start' | 'end',
  deps: LineGestureDeps
): void {
  const fixed = which === 'end' ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 }
  trackPointer(
    e,
    (ev) => {
      const target = resolvePointer(ev, deps, [line.id], [pointBox(fixed)])
      docActions.dispatch({
        type: 'update',
        id: line.id,
        patch: lineEndpointPatch(line, which, target.point, {
          isAngleSnap: ev.shiftKey,
          isPrecise: target.isSnapped
        })
      })
    },
    () => {
      deps.setGuides(NO_GUIDES)
      deps.onDone()
    },
    'crosshair'
  )
}
