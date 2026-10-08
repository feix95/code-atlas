/** 表格格子网格的 DOM 操作:按坐标取格、读写一片格子、剪贴板读写 */
import type { EditorView } from '@codemirror/view'
import { renderCellSource } from './tableCellSource.ts'
import { cellSourceOf, dispatchModelFromDom } from './tableDom.ts'
import {
  CELLS_MIME,
  emptyGridOf,
  gridToTsv,
  parseCellsPayload,
  parseClipboardText,
  type CellPos,
  type CellRange
} from './tableGrid.ts'

export const tableRowsOf = (box: HTMLElement): HTMLElement[] => [
  ...box.querySelectorAll<HTMLElement>('tr')
]

export const cellAt = (box: HTMLElement, pos: CellPos): HTMLElement | null =>
  (tableRowsOf(box)[pos.row]?.children[pos.col] as HTMLElement | undefined) ?? null

export function positionOfCell(box: HTMLElement, cell: HTMLElement): CellPos | null {
  const tr = cell.closest('tr')
  if (!tr) return null
  const row = tableRowsOf(box).indexOf(tr as HTMLElement)
  const col = [...tr.children].indexOf(cell)
  return row < 0 || col < 0 ? null : { row, col }
}

/** 整表右下角坐标(全选用) */
export function lastPosOf(box: HTMLElement): CellPos {
  const rows = tableRowsOf(box)
  return { row: rows.length - 1, col: (rows[0]?.children.length ?? 1) - 1 }
}

/** 读一片格子的源码账 */
export function readRange(box: HTMLElement, range: CellRange): string[][] {
  const grid: string[][] = []
  for (let row = range.top; row <= range.bottom; row++) {
    const line: string[] = []
    for (let col = range.left; col <= range.right; col++)
      line.push(cellAt(box, { row, col })?.dataset.raw ?? '')
    grid.push(line)
  }
  return grid
}

/** 原地改格子源码并重画装饰(不重建 DOM,选区蓝框与焦点都保得住) */
function setCellRaw(cell: HTMLElement, raw: string): void {
  cell.dataset.raw = raw
  const src = cellSourceOf(cell)
  if (src) renderCellSource(src, raw, cell.ownerDocument)
}

/** 从 origin 起铺一块二维格子进表(超出表边界的部分截掉),一次事务整表回写 */
export function writeGrid(
  view: EditorView,
  box: HTMLElement,
  origin: CellPos,
  grid: string[][]
): void {
  let anyCell: HTMLElement | null = null
  grid.forEach((line, i) =>
    line.forEach((text, j) => {
      const cell = cellAt(box, { row: origin.row + i, col: origin.col + j })
      if (!cell) return
      setCellRaw(cell, text)
      anyCell = cell
    })
  )
  if (anyCell) dispatchModelFromDom(view, anyCell)
}

export const clearRange = (view: EditorView, box: HTMLElement, range: CellRange): void =>
  writeGrid(view, box, { row: range.top, col: range.left }, emptyGridOf(range))

/** 一片格子写进剪贴板:纯文本给 TSV(粘进表格软件/文档都顺),自定义 MIME 给应用内无损还原 */
export function writeClipboardGrid(data: DataTransfer, grid: string[][]): void {
  data.setData('text/plain', gridToTsv(grid))
  data.setData(CELLS_MIME, JSON.stringify(grid))
}

/** 剪贴板 → 二维格子:先认应用内载荷,再认纯文本 */
export function readClipboardGrid(data: DataTransfer | null): string[][] | null {
  if (!data) return null
  const payload = data.getData(CELLS_MIME)
  const fromPayload = payload ? parseCellsPayload(payload) : null
  return fromPayload ?? parseClipboardText(data.getData('text/plain'))
}
