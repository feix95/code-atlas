// 拖出矩形 / 画板的画布手势(两者同为「拖框」:Shift 正方形、Alt 从中心、只点不拖不出形)。
// 一笔手势 = 一个外层批次 = 一步撤销:add(落点 1×1)+ 拖动 update + 松手结算(没拖动则回收)。
// 松手按中心点认爹:画在画板里的对象归该画板(Figma 同款),画板可嵌套。
// 中途任何一步抛异常都必须把外层批次结掉再抛出,否则批次挂起、撤销永久失灵。
import { rectFromDrag, type Point } from '@shared/uiWorkbench/geometry'
import { createFrame } from '@shared/uiWorkbench/frame'
import { createRect } from '@shared/uiWorkbench/node'
import type { SceneNode } from '@shared/uiWorkbench/scene'
import { reparentPatches } from '@shared/uiWorkbench/tree'
import { docActions, getDocState } from './documentStore'
import { getNewRectAppearance } from './newRectDefaultsStore'
import { trackPointer } from './trackPointer'

export type BoxKind = 'rect' | 'frame'

export interface BoxDrawDeps {
  toDesign: (e: { clientX: number; clientY: number }) => Point
  /** 手势结束(含只点没拖):调用方把工具回落到选择 */
  onDone: () => void
}

export function startBoxDraw(e: React.PointerEvent, kind: BoxKind, deps: BoxDrawDeps): void {
  // trackPointer 拿不到 win 会直接 return:外层批次先别开,免得挂起不结算
  if (!e.currentTarget.ownerDocument.defaultView) return
  const start = deps.toDesign(e)
  docActions.beginBatch()
  try {
    const prevSelectedIds = getDocState().selectedIds
    // 新矩形吃「新矩形默认外观」;起手 1×1 会把圆角钳成 0,所以拖动每帧都重新带上默认圆角。画板没有外观字段
    const look = getNewRectAppearance()
    const seed = { ...start, width: 1, height: 1 }
    const nodes = getDocState().nodes
    const node: SceneNode =
      kind === 'frame' ? createFrame(nodes, seed) : createRect(nodes, seed, look)
    docActions.dispatch({ type: 'add', node })
    docActions.select(node.id)
    trackPointer(
      e,
      (ev) =>
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: {
            ...rectFromDrag(start, deps.toDesign(ev), {
              isSquare: ev.shiftKey,
              isFromCenter: ev.altKey
            }),
            ...(kind === 'rect' ? { radii: look.radii, styleId: look.styleId } : {})
          }
        }),
      () => {
        try {
          finishDraw(node.id, prevSelectedIds)
        } finally {
          // 最外层批次在此结算:整个「画一个」= 一步撤销
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

/** 松手收尾:仍是落点 1×1 = 没有有效拖动,回收并还回按下前的选集(单击 = 什么都没发生);否则认爹 */
function finishDraw(id: string, prevSelectedIds: readonly string[]): void {
  const fresh = getDocState().nodes.find((n) => n.id === id)
  if (fresh && fresh.type !== 'line' && fresh.width === 1 && fresh.height === 1) {
    docActions.dispatch({ type: 'remove', id })
    docActions.selectIds(prevSelectedIds)
    return
  }
  for (const { parentId } of reparentPatches(getDocState().nodes, [id])) {
    docActions.dispatch({ type: 'update', id, patch: { parentId } })
  }
}
