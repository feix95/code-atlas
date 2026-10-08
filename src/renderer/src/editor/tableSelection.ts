/**
 * 表格多格选区(Excel / Obsidian 式):从一格按住拖到另一格,选中一块矩形;
 * 浅蓝铺底 + 蓝框罩住,Delete 清空,Ctrl+C/X/V 复制剪切粘贴,Shift+点击扩选,Esc 退出。
 *
 * 选区状态只活在这一张表的 DOM 上:表被重建(结构操作/撤销)选区自然消失。
 * 格子里的光标编辑与选区互斥:拖出起点格那一刻把焦点从格内摘下、交给表格外框(tabindex=-1)收键盘事件。
 */
import { redo, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { placeCaretAtEnd } from './tableCellSource.ts'
import { markWidgetFocused } from './liveFocus.ts'
import { cellSourceOf } from './tableDom.ts'
import {
  isSingleCell,
  normalizeRange,
  emptyGridOf,
  type CellPos,
  type CellRange
} from './tableGrid.ts'
import {
  cellAt,
  clearRange,
  lastPosOf,
  positionOfCell,
  readClipboardGrid,
  readRange,
  writeClipboardGrid,
  writeGrid
} from './tableGridOps.ts'

/** 选区装机的收摊函数(替身被拆时摘掉 document 级监听) */
export const selectionTeardown = new WeakMap<Element, () => void>()

/** 取事件目标所在的格子坐标;不在本表格内返回 null(鸭式判断:子窗是独立 realm) */
function cellPosOfTarget(box: HTMLElement, target: EventTarget | null): CellPos | null {
  const node = target as Node | null
  const el = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null)
  const cell = el?.closest('td, th') as HTMLElement | null
  return cell && box.contains(cell) ? positionOfCell(box, cell) : null
}

class TableSelection {
  private anchor: CellPos | null = null
  private head: CellPos | null = null
  private dragStart: CellPos | null = null
  private overlay: HTMLElement | null = null
  private readonly doc: Document
  private readonly view: EditorView
  private readonly box: HTMLElement

  constructor(view: EditorView, box: HTMLElement) {
    this.view = view
    this.box = box
    this.doc = box.ownerDocument
    box.tabIndex = -1
    box.addEventListener('mousedown', this.onBoxDown, true)
    box.addEventListener('selectstart', this.onSelectStart)
    box.addEventListener('keydown', this.onKeyDown)
    box.addEventListener('copy', this.onCopy)
    box.addEventListener('cut', this.onCut)
    box.addEventListener('paste', this.onPaste)
  }

  destroy(): void {
    this.doc.removeEventListener('mousemove', this.onMove, true)
    this.doc.removeEventListener('mouseup', this.onUp, true)
    this.doc.removeEventListener('mousedown', this.onOutsideDown, true)
  }

  private get range(): CellRange | null {
    return this.anchor && this.head ? normalizeRange(this.anchor, this.head) : null
  }

  // ── 画框 ──

  private paint(): void {
    const r = this.range
    const topLeft = r && cellAt(this.box, { row: r.top, col: r.left })
    const bottomRight = r && cellAt(this.box, { row: r.bottom, col: r.right })
    if (!r || !topLeft || !bottomRight) {
      this.overlay?.remove()
      this.overlay = null
      return
    }
    if (!this.overlay) {
      this.overlay = this.doc.createElement('div')
      this.overlay.className = 'cm-live-cell-sel'
      this.box.appendChild(this.overlay)
    }
    const boxRect = this.box.getBoundingClientRect()
    const a = topLeft.getBoundingClientRect()
    const b = bottomRight.getBoundingClientRect()
    this.overlay.style.left = `${a.left - boxRect.left}px`
    this.overlay.style.top = `${a.top - boxRect.top}px`
    this.overlay.style.width = `${b.right - a.left}px`
    this.overlay.style.height = `${b.bottom - a.top}px`
  }

  private clear(): void {
    this.anchor = this.head = null
    this.paint()
    this.doc.removeEventListener('mousedown', this.onOutsideDown, true)
  }

  /** 从格内编辑切到格选区:摘掉格内焦点和原生选中,键盘交给外框 */
  private enter(): void {
    const active = this.doc.activeElement as HTMLElement | null
    if (active && active !== this.box && this.box.contains(active)) active.blur()
    this.doc.defaultView?.getSelection()?.removeAllRanges()
    this.box.focus({ preventScroll: true })
    markWidgetFocused(this.view)
    this.doc.addEventListener('mousedown', this.onOutsideDown, true)
  }

  private extendTo(pos: CellPos): void {
    this.head = pos
    this.paint()
  }

  // ── 鼠标 ──

  private readonly onBoxDown = (e: MouseEvent): void => {
    const pos = cellPosOfTarget(this.box, e.target)
    if (e.button !== 0 || !pos) return
    const focused = cellPosOfTarget(this.box, this.doc.activeElement)
    if (e.shiftKey && (this.anchor ?? focused)) {
      e.preventDefault()
      this.anchor = this.anchor ?? focused
      this.enter()
      this.extendTo(pos)
      return
    }
    if (this.anchor) this.clear()
    this.dragStart = pos
    this.doc.addEventListener('mousemove', this.onMove, true)
    this.doc.addEventListener('mouseup', this.onUp, true)
  }

  private readonly onMove = (e: MouseEvent): void => {
    if (!this.dragStart) return
    const pos = cellPosOfTarget(this.box, this.doc.elementFromPoint(e.clientX, e.clientY))
    if (!pos) return
    if (!this.anchor) {
      if (pos.row === this.dragStart.row && pos.col === this.dragStart.col) return
      this.anchor = this.dragStart
      this.enter()
    }
    e.preventDefault()
    this.doc.defaultView?.getSelection()?.removeAllRanges()
    this.extendTo(pos)
  }

  private readonly onUp = (): void => {
    this.dragStart = null
    this.doc.removeEventListener('mousemove', this.onMove, true)
    this.doc.removeEventListener('mouseup', this.onUp, true)
  }

  private readonly onOutsideDown = (e: MouseEvent): void => {
    if (!this.box.contains(e.target as Node)) this.clear()
  }

  private readonly onSelectStart = (e: Event): void => {
    if (this.anchor) e.preventDefault()
  }

  // ── 键盘与剪贴板(只收外框自己的事件;格内按键归格子) ──

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const r = this.range
    if (e.target !== this.box || !r) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (key === 'delete' || key === 'backspace') clearRange(this.view, this.box, r)
    else if (key === 'escape') this.clear()
    else if (key === 'enter' || key === 'f2') this.editAnchorCell()
    else if (mod && key === 'a') this.selectAll()
    else if (mod && key === 'z') (e.shiftKey ? redo : undo)(this.view)
    else if (mod && key === 'y') redo(this.view)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  private selectAll(): void {
    this.anchor = { row: 0, col: 0 }
    this.extendTo(lastPosOf(this.box))
  }

  private editAnchorCell(): void {
    const cell = this.anchor && cellAt(this.box, this.anchor)
    const src = cell && cellSourceOf(cell)
    this.clear()
    if (!src) return
    src.focus()
    placeCaretAtEnd(src)
  }

  private copyRange(e: ClipboardEvent): CellRange | null {
    const r = this.range
    if (this.doc.activeElement !== this.box || !r || !e.clipboardData) return null
    writeClipboardGrid(e.clipboardData, readRange(this.box, r))
    e.preventDefault()
    return r
  }

  private readonly onCopy = (e: ClipboardEvent): void => {
    this.copyRange(e)
  }

  private readonly onCut = (e: ClipboardEvent): void => {
    const r = this.copyRange(e)
    if (r) clearRange(this.view, this.box, r)
  }

  private readonly onPaste = (e: ClipboardEvent): void => {
    const r = this.range
    const grid = readClipboardGrid(e.clipboardData)
    if (this.doc.activeElement !== this.box || !r || !grid) return
    e.preventDefault()
    // 只有一个值而选区是一片:Excel 手感,填满整片;多格内容从选区左上角起铺
    const isFill = grid.length === 1 && grid[0].length === 1 && !isSingleCell(r)
    const fill = isFill ? emptyGridOf(r).map((row) => row.map(() => grid[0][0])) : grid
    writeGrid(this.view, this.box, { row: r.top, col: r.left }, fill)
  }
}

/** 给一张表挂上多格选区交互 */
export function attachTableSelection(view: EditorView, box: HTMLElement): void {
  const selection = new TableSelection(view, box)
  selectionTeardown.set(box, () => selection.destroy())
}
