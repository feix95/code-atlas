/** 替身 DOM 与文档的对账:找回 Table 语法区间、DOM → 模型、整表回写 */
import { syntaxTree } from '@codemirror/language'
import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { MdAlign } from '../../../shared/markdown.ts'
import { serializeTable, type TableModel } from './tableModel.ts'

// 范围与回写

/** 替身 DOM → 当前 Table 语法区间(每次现查,编辑漂移不炸账) */
export function findTableRange(
  view: EditorView,
  dom: HTMLElement
): { from: number; to: number } | null {
  let pos: number
  try {
    pos = view.posAtDOM(dom)
  } catch {
    return null
  }
  if (pos < 0) return null
  let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1)
  while (n && n.name !== 'Table') n = n.parent
  return n ? { from: n.from, to: n.to } : null
}

/** DOM 表格 → 模型(格子的源码账在 dataset.raw) */
export function readModelFromDom(wrap: HTMLElement): TableModel {
  const head = [...wrap.querySelectorAll<HTMLElement>('thead th')].map((c) => c.dataset.raw ?? '')
  const rows = [...wrap.querySelectorAll<HTMLElement>('tbody tr')].map((tr) =>
    [...tr.querySelectorAll<HTMLElement>('td')].map((c) => c.dataset.raw ?? '')
  )
  const aligns = [...wrap.querySelectorAll<HTMLElement>('thead th')].map(
    (c) => (c.dataset.align as MdAlign) ?? 'left'
  )
  return { head, aligns, rows }
}

/** 整表模型回写文档;同源跳过,一次事务(撤销合并为一组) */
export function dispatchModel(view: EditorView, wrap: HTMLElement, model: TableModel): void {
  const range = findTableRange(view, wrap)
  if (!range) return
  const next = serializeTable(model)
  if (view.state.sliceDoc(range.from, range.to) === next) return
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: next },
    annotations: Transaction.userEvent.of('input.type')
  })
}

export const dispatchModelFromDom = (view: EditorView, cell: HTMLElement): void => {
  const wrap = cell.closest<HTMLElement>('.cm-live-table')
  if (wrap) dispatchModel(view, wrap, readModelFromDom(wrap))
}

export const cellSourceOf = (cell: HTMLElement): HTMLElement | null =>
  cell.querySelector<HTMLElement>('.cm-live-cell-src')
