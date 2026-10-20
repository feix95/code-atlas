/** 格子编辑装机:敲字入账、IME、粘贴、Tab/Enter 跳格、续行 */
import type { EditorView } from '@codemirror/view'
import {
  getCaretCharOffset,
  placeCaretAtEnd,
  refreshActiveMarks,
  renderCellSource,
  setCaretCharOffset
} from './tableCellSource.ts'
import {
  cellSourceOf,
  dispatchModel,
  dispatchModelFromDom,
  findTableRange,
  readModelFromDom
} from './tableDom.ts'
import { markWidgetFocused } from './liveFocus.ts'
import { positionOfCell, readClipboardGrid, writeGrid } from './tableGridOps.ts'
import { openCellMenu } from './tableMenu.ts'

/** 剪贴板里是多格内容(表格/TSV/应用内格子)时,从当前格起铺进表;返回是否已处理 */
function pasteGridFromCell(
  view: EditorView,
  cell: HTMLElement,
  data: DataTransfer | null
): boolean {
  const grid = readClipboardGrid(data)
  const box = cell.closest<HTMLElement>('.cm-live-table')
  const origin = box && positionOfCell(box, cell)
  const isMultiCell = grid && (grid.length > 1 || grid[0].length > 1)
  if (!grid || !box || !origin || !isMultiCell) return false
  writeGrid(view, box, origin, grid)
  return true
}

/** 每个编辑格的清理函数(替身被拆时按登记清监听器) */
export const cellTeardown = new WeakMap<Element, () => void>()

export function attachCellEditing(view: EditorView, cell: HTMLElement, src: HTMLElement): void {
  const doc = src.ownerDocument

  /** 敲字入账:textContent(藏着的定界符也算)→ raw → 重画装饰 → 光标复位 → 整表回写 */
  const commit = (): void => {
    const raw = (src.textContent ?? '').replace(/\s+/g, ' ').trim()
    cell.dataset.raw = raw
    const offset = getCaretCharOffset(src)
    renderCellSource(src, raw, doc)
    if (offset != null) setCaretCharOffset(src, offset)
    refreshActiveMarks(src)
    dispatchModelFromDom(view, cell)
  }

  // IME/死键组合中重画会掐断拼音会话:合成期间记账不动,松手一笔结清
  let composing = false
  src.addEventListener('compositionstart', () => {
    composing = true
  })
  src.addEventListener('compositionend', () => {
    composing = false
    commit()
  })
  src.addEventListener('input', (e) => {
    if (composing || (e as InputEvent).isComposing) return
    commit()
  })

  // 粘贴一律压平成单行纯文本:富文本/换行/裸 | 落进去会炸行结构
  src.addEventListener('paste', (e) => {
    e.preventDefault()
    if (pasteGridFromCell(view, cell, e.clipboardData)) return
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ').trim()
    const sel = doc.defaultView?.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const r = sel.getRangeAt(0)
    r.deleteContents()
    r.insertNode(doc.createTextNode(text))
    r.collapse(false)
    sel.removeAllRanges()
    sel.addRange(r)
    commit()
  })

  // 光标挪位(focus/mouseup/keyup 三条路)刷新记号掀开态;blur 全部关闭
  src.addEventListener('focus', () => {
    markWidgetFocused(view)
    refreshActiveMarks(src)
  })
  src.addEventListener('mouseup', () => refreshActiveMarks(src))
  src.addEventListener('keyup', () => refreshActiveMarks(src))
  src.addEventListener('blur', () =>
    src.querySelectorAll('.cm-live-cell-wrap.active').forEach((w) => w.classList.remove('active'))
  )

  src.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      moveCellFocus(view, cell, e.shiftKey ? -1 : 1)
    } else if (e.key === 'Enter') {
      // Obsidian 手感:Enter 同列下移一行,末行自动续行
      e.preventDefault()
      e.stopPropagation()
      moveCellDown(view, cell)
    } else if (e.key === 'Escape') {
      src.blur()
    }
  })

  cell.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    openCellMenu(view, cell, e.clientX, e.clientY)
  })

  // 点格子空白(内边距/字缝)也把光标请进源码格,一律放尾巴上
  cell.addEventListener('pointerdown', (e) => {
    const t = e.target
    if (t instanceof Node && src.contains(t)) return
    e.preventDefault()
    src.focus()
    placeCaretAtEnd(src)
  })

  // CM 对 contentDOM 的 mousedown 会 preventDefault,点格外不会自然失焦 ——
  // 聚焦时在 document capture 挂清理钩子,点到格外先 blur(监听器随 blur 自摘)
  const closeOnOutside = (e: MouseEvent): void => {
    const t = e.target
    // 表格内部的点击(换格、Shift 扩选、点边框)交给表格自己,只有点到表格外才关闭
    if (t instanceof Node && cell.closest('.cm-live-table')?.contains(t)) return
    src.blur()
  }
  const onFocus = (): void => doc.addEventListener('mousedown', closeOnOutside, true)
  const offFocus = (): void => doc.removeEventListener('mousedown', closeOnOutside, true)
  src.addEventListener('focus', onFocus)
  src.addEventListener('blur', offFocus)
  cellTeardown.set(src, offFocus)
}

/** Tab/Enter 前后跳格;末格 Tab 自动续行并落新行首格 */
export function moveCellFocus(view: EditorView, cell: HTMLElement, dir: 1 | -1): void {
  const wrap = cell.closest<HTMLElement>('.cm-live-table')
  if (!wrap) return
  const cells = [...wrap.querySelectorAll<HTMLElement>('th, td')]
  const idx = cells.indexOf(cell)
  if (idx < 0) return
  const next = idx + dir
  if (next < 0) {
    cellSourceOf(cell)?.blur()
    return
  }
  if (next >= cells.length) {
    appendRow(view, wrap)
    return
  }
  const src = cellSourceOf(cells[next])
  if (!src) return
  src.focus()
  placeCaretAtEnd(src)
}

/** Enter:同列下移一行;已在末行就先续行再落新行同列 */
export function moveCellDown(view: EditorView, cell: HTMLElement): void {
  const wrap = cell.closest<HTMLElement>('.cm-live-table')
  const tr = cell.closest('tr')
  if (!wrap || !tr) return
  const col = [...tr.children].indexOf(cell)
  const rows = [...wrap.querySelectorAll<HTMLElement>('tr')]
  const rowIdx = rows.indexOf(tr as HTMLElement)
  const nextTr = rows[rowIdx + 1]
  if (!nextTr) {
    appendRow(view, wrap, col)
    return
  }
  const src = cellSourceOf(nextTr.children[col] as HTMLElement)
  if (!src) return
  src.focus()
  placeCaretAtEnd(src)
}

/** 续行:加行改变行数 → eq 判不等 → 替身重建;等两帧拿新 DOM 落新行指定列 */
export function appendRow(view: EditorView, wrap: HTMLElement, colIdx = 0): void {
  const range = findTableRange(view, wrap)
  if (!range) return
  const model = readModelFromDom(wrap)
  model.rows.push(model.head.map(() => ''))
  dispatchModel(view, wrap, model)
  const { from } = range
  const win = view.dom.ownerDocument.defaultView
  win?.requestAnimationFrame(() => {
    win.requestAnimationFrame(() => {
      const target = [...view.dom.querySelectorAll<HTMLElement>('.cm-live-table')].find((el) => {
        try {
          return view.posAtDOM(el) === from
        } catch {
          return false
        }
      })
      const lastTr = target?.querySelector<HTMLElement>('tbody tr:last-child')
      const td = lastTr?.children[colIdx] as HTMLElement | undefined
      const src = td ? cellSourceOf(td) : null
      if (!src) return
      src.focus()
      placeCaretAtEnd(src)
    })
  })
}
