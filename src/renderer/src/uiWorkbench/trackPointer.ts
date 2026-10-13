// 画布手势的指针追踪:window 级监听 + 批次收尾 + 焦点释放。选择/画矩形/画直线/端点拖拽等手势共用。
import { docActions } from './documentStore'
import { isEditableTarget } from './isEditableTarget'

/** 画布手势的 pointerdown 都 preventDefault(防选中文字),浏览器因此不会转移焦点:
 *  之前停在面板输入框/下拉上的焦点会原地留着,isEditableTarget 随即把 Delete、V/R、方向键
 *  和 Ctrl+Z 全挡成死键(症状:重启后能用,碰过面板控件再点画布就失灵)。手势一开始主动释放 */
export function releaseEditableFocus(doc: Document): void {
  const active = doc.activeElement
  if (isEditableTarget(active)) (active as HTMLElement).blur()
}

/** 手势换算只依赖这几样:指针位置 + 修饰键状态(PointerEvent 与合成重放共用) */
export type DragEventLike = Pick<
  PointerEvent,
  'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'
>

/** 拖动期间挂 window 级监听:指针飞出元素手势也不断;结束时收掉。
 *  修饰键按下/松开会在最后一次指针位置原地重算——按 Shift 立即吸附、松开落回原值(PS 式);
 *  dragCursor 把手势光标钉在文档根上,指针悬到别处也不跳回默认;
 *  setPointerCapture + blur 兜底:窗口外松手/失焦也能收尾,光标不会被钉死 */
export function trackPointer(
  down: React.PointerEvent,
  onMove: (e: DragEventLike) => void,
  onEnd: () => void,
  dragCursor?: string
): void {
  releaseEditableFocus(down.currentTarget.ownerDocument)
  const target = down.currentTarget
  const win = target.ownerDocument.defaultView
  if (!win) return
  const root = win.document.documentElement
  const prevCursor = root.style.cursor
  if (dragCursor) root.style.cursor = dragCursor
  let last: DragEventLike | null = null
  const move = (e: PointerEvent): void => {
    last = e
    onMove(e)
  }
  const modifier = (e: KeyboardEvent): void => {
    if (!last || (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta'))
      return
    onMove({
      clientX: last.clientX,
      clientY: last.clientY,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey
    })
  }
  const end = (): void => {
    win.removeEventListener('pointermove', move)
    win.removeEventListener('keydown', modifier, true)
    win.removeEventListener('keyup', modifier, true)
    win.removeEventListener('pointerup', end)
    win.removeEventListener('pointercancel', end)
    win.removeEventListener('blur', end)
    if (dragCursor) root.style.cursor = prevCursor
    try {
      onEnd()
    } finally {
      docActions.endBatch()
    }
  }
  // 先捕获再开批:setPointerCapture 一旦抛异常,批次就不会被留下挂起;
  // 抛出时顺手还原手势光标,不留钉死的 cursor
  try {
    target.setPointerCapture(down.pointerId)
  } catch (err) {
    if (dragCursor) root.style.cursor = prevCursor
    throw err
  }
  docActions.beginBatch()
  win.addEventListener('pointermove', move)
  win.addEventListener('keydown', modifier, true)
  win.addEventListener('keyup', modifier, true)
  win.addEventListener('pointerup', end)
  win.addEventListener('pointercancel', end)
  win.addEventListener('blur', end)
}
