/** 表格控件层:行列抓手拖拽重排、边缘加号、松手回弹动画 */
import type { EditorView } from '@codemirror/view'
import { appendRow } from './tableCellEditing.ts'
import { attachGripHover, makeGripZones } from './tableGripHover.ts'
import { dispatchModel, findTableRange, readModelFromDom } from './tableDom.ts'

// 抓手与边缘加号(Excel 式体感)

interface DragState {
  axis: 'row' | 'col'
  from: number
  to: number
  indicator: HTMLElement
  frame: HTMLElement
}

/** 取 :root 上的动效 token(回弹曲线/时长走全局 token,不在这里写死) */
function motionToken(doc: Document, name: string, fallback: string): string {
  const win = doc.defaultView
  const v = win?.getComputedStyle(doc.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** 松手后被拎起的那行/列从旧位置弹回新位置:过冲归位 + 蓝底淡出(Obsidian 同款确认感) */
function playSettleAnimation(
  view: EditorView,
  tableFrom: number,
  axis: 'row' | 'col',
  index: number,
  oldRect: DOMRect
): void {
  const doc = view.dom.ownerDocument
  const box = [...view.dom.querySelectorAll<HTMLElement>('.cm-live-table')].find((el) => {
    try {
      return view.posAtDOM(el) === tableFrom
    } catch {
      return false
    }
  })
  if (!box) return
  const cells =
    axis === 'col'
      ? [...box.querySelectorAll<HTMLElement>('tr')].map((tr) => tr.children[index] as HTMLElement)
      : [...(box.querySelectorAll('tbody tr')[index]?.children ?? [])].map((c) => c as HTMLElement)
  if (!cells.length || !cells[0]) return
  const newRect = cells[0].getBoundingClientRect()
  const dx = axis === 'col' ? oldRect.left - newRect.left : 0
  const dy = axis === 'row' ? oldRect.top - newRect.top : 0
  const options = {
    duration: parseFloat(motionToken(doc, '--dur-3', '0.3s')) * 1000,
    easing: motionToken(doc, '--ease-spring', 'ease-out')
  }
  // 位移期间表格外框会被撑出横向滚动条:动画跑完前先裁掉溢出
  const wrap = box.querySelector<HTMLElement>('.md-table-wrap')
  if (wrap) wrap.style.overflow = 'hidden'
  const finished = cells.map(
    (cell) =>
      cell.animate(
        [
          // 蓝色用内阴影铺在格底色之上,不动格子自己的底色(表头灰底不会闪白)
          {
            transform: `translate(${dx}px, ${dy}px)`,
            boxShadow: 'inset 0 0 0 100vmax var(--drop-mark)'
          },
          { transform: 'translate(0, 0)', boxShadow: 'inset 0 0 0 100vmax transparent' }
        ],
        options
      ).finished
  )
  void Promise.all(finished).finally(() => {
    if (wrap) wrap.style.overflow = ''
  })
}

/**
 * 表格控件层:行左缘 ⠿ / 列顶缘 ⠿ 抓手(悬停对应行列现身,按住拖出插位线),
 * 底缘 +行 / 右缘 +列(悬停表格隐约现身);全都只占交互不占版面。
 */
export function attachTableControls(view: EditorView, box: HTMLElement, wrapEl: HTMLElement): void {
  const doc = view.dom.ownerDocument
  const ui = doc.createElement('div')
  ui.className = 'cm-live-table-ui'
  ui.setAttribute('aria-hidden', 'true')

  const rowGrip = doc.createElement('div')
  rowGrip.className = 'cm-live-grip cm-live-grip-row'
  rowGrip.textContent = '⠿'
  const colGrip = doc.createElement('div')
  colGrip.className = 'cm-live-grip cm-live-grip-col'
  colGrip.textContent = '⠿'
  const addRow = doc.createElement('button')
  addRow.className = 'cm-live-edge-add cm-live-edge-row'
  addRow.textContent = '＋'
  addRow.title = '末尾加一行'
  const addCol = doc.createElement('button')
  addCol.className = 'cm-live-edge-add cm-live-edge-col'
  addCol.textContent = '＋'
  addCol.title = '右侧加一列'
  ui.append(...makeGripZones(doc), rowGrip, colGrip, addRow, addCol)
  box.appendChild(ui)

  // 抓手只在鼠标贴近表格顶边/左边的热区里现身(判定见 tableGripHover.ts)
  const gripTargets = attachGripHover(
    box,
    wrapEl.querySelector<HTMLElement>('table') ?? wrapEl,
    rowGrip,
    colGrip,
    () => drag !== null
  )

  // 拖拽重排
  let drag: DragState | null = null
  const onMove = (e: PointerEvent): void => {
    if (!drag) return
    const boxRect = box.getBoundingClientRect()
    if (drag.axis === 'row') {
      const trs = [...wrapEl.querySelectorAll<HTMLElement>('tbody tr')]
      let to = trs.length
      for (let i = 0; i < trs.length; i++) {
        const r = trs[i].getBoundingClientRect()
        if (e.clientY < r.top + r.height / 2) {
          to = i
          break
        }
      }
      drag.to = to
      const anchor = to === trs.length ? trs[trs.length - 1] : trs[to]
      const ar = anchor?.getBoundingClientRect()
      if (ar)
        drag.indicator.style.top = `${(to === trs.length ? ar.bottom : ar.top) - boxRect.top}px`
    } else {
      const ths = [...wrapEl.querySelectorAll<HTMLElement>('thead th')]
      let to = ths.length
      for (let i = 0; i < ths.length; i++) {
        const r = ths[i].getBoundingClientRect()
        if (e.clientX < r.left + r.width / 2) {
          to = i
          break
        }
      }
      drag.to = to
      const anchor = to === ths.length ? ths[ths.length - 1] : ths[to]
      const ar = anchor?.getBoundingClientRect()
      if (ar) {
        const tableRect = wrapEl.getBoundingClientRect()
        drag.indicator.style.left = `${(to === ths.length ? ar.right : ar.left) - boxRect.left}px`
        drag.indicator.style.top = `${tableRect.top - boxRect.top}px`
        drag.indicator.style.height = `${tableRect.height}px`
      }
    }
  }
  const endDrag = (commit: boolean): void => {
    if (!drag) return
    const d = drag
    drag = null
    d.indicator.remove()
    d.frame.remove()
    rowGrip.classList.remove('is-dragging')
    colGrip.classList.remove('is-dragging')
    doc.removeEventListener('pointermove', onMove, true)
    doc.removeEventListener('pointerup', onUp, true)
    doc.removeEventListener('keydown', onKey, true)
    rowGrip.classList.remove('is-on')
    colGrip.classList.remove('is-on')
    if (!commit || d.to === d.from || d.to === d.from + 1) return
    const model = readModelFromDom(wrapEl)
    const landed = d.to > d.from ? d.to - 1 : d.to
    const oldRect = (
      d.axis === 'row'
        ? wrapEl.querySelectorAll('tbody tr')[d.from]?.children[0]
        : wrapEl.querySelector('thead tr')?.children[d.from]
    )?.getBoundingClientRect()
    const tableFrom = findTableRange(view, wrapEl)?.from
    if (d.axis === 'row') {
      const [r] = model.rows.splice(d.from, 1)
      model.rows.splice(landed, 0, r)
    } else {
      const move = (arr: unknown[]): void => {
        const [x] = arr.splice(d.from, 1)
        arr.splice(landed, 0, x)
      }
      move(model.head)
      move(model.aligns)
      model.rows.forEach(move)
    }
    dispatchModel(view, wrapEl, model)
    if (oldRect && tableFrom != null) playSettleAnimation(view, tableFrom, d.axis, landed, oldRect)
  }
  const onUp = (): void => endDrag(true)
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') endDrag(false)
  }
  /** 被拎起的整行/整列:蓝框罩住 + 外缘一块蓝标签(列在顶、行在左),标签里是抓手点阵 */
  const buildDragFrame = (axis: 'row' | 'col', index: number): HTMLElement => {
    const boxRect = box.getBoundingClientRect()
    const tableRect = wrapEl.getBoundingClientRect()
    const target =
      axis === 'col'
        ? wrapEl.querySelector('thead tr')?.children[index]
        : wrapEl.querySelectorAll('tbody tr')[index]
    const r = target?.getBoundingClientRect() ?? tableRect
    const frame = doc.createElement('div')
    frame.className = `cm-live-drag-frame cm-live-drag-${axis}`
    const tab = doc.createElement('span')
    tab.className = 'cm-live-drag-tab'
    frame.appendChild(tab)
    const isCol = axis === 'col'
    frame.style.left = `${(isCol ? r.left : tableRect.left) - boxRect.left}px`
    frame.style.top = `${(isCol ? tableRect.top : r.top) - boxRect.top}px`
    frame.style.width = `${isCol ? r.width : tableRect.width}px`
    frame.style.height = `${isCol ? tableRect.height : r.height}px`
    return frame
  }
  const startDrag = (axis: 'row' | 'col', index: number) => (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const indicator = doc.createElement('div')
    indicator.className = `cm-live-drop-line cm-live-drop-${axis}`
    const frame = buildDragFrame(axis, index)
    box.append(frame, indicator)
    rowGrip.classList.add('is-dragging')
    colGrip.classList.add('is-dragging')
    drag = { axis, from: index, to: index, indicator, frame }
    onMove(e as unknown as PointerEvent)
    doc.addEventListener('pointermove', onMove, true)
    doc.addEventListener('pointerup', onUp, true)
    doc.addEventListener('keydown', onKey, true)
  }
  rowGrip.addEventListener('mousedown', (e) => {
    const tr = gripTargets.rowRow()
    const idx = tr ? [...(tr.parentElement?.children ?? [])].indexOf(tr) : -1
    if (idx >= 0) startDrag('row', idx)(e)
  })
  colGrip.addEventListener('mousedown', (e) => {
    const th = gripTargets.colCell()
    const idx = th ? [...(th.parentElement?.children ?? [])].indexOf(th) : -1
    if (idx >= 0) startDrag('col', idx)(e)
  })

  // 边缘加号
  const blurActiveSrc = (): void => {
    const ae = doc.activeElement
    if ((ae as HTMLElement | null)?.classList?.contains('cm-live-cell-src'))
      (ae as HTMLElement).blur()
  }
  addRow.addEventListener('mousedown', (e) => e.preventDefault())
  addRow.addEventListener('click', () => {
    blurActiveSrc()
    appendRow(view, wrapEl)
  })
  addCol.addEventListener('mousedown', (e) => e.preventDefault())
  addCol.addEventListener('click', () => {
    blurActiveSrc()
    const model = readModelFromDom(wrapEl)
    model.head.push('')
    model.aligns.push('left')
    model.rows.forEach((r) => r.push(''))
    dispatchModel(view, wrapEl, model)
  })
}
