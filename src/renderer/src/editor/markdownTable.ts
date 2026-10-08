/**
 * Live Preview 表格替身(Obsidian 式 WYSIWYG 格内编辑)入口:
 * 整张管道表源码换成真表格;每格常驻一个 contenteditable 的「装饰源码」格。
 * 各职责拆在同目录 table*.ts:模型 / 格内渲染 / DOM 对账 / 格子编辑 / 右键菜单 / 控件层。
 *
 * 关键 CM 行规(踩过坑的判决书):
 *  - 替身体内 DOM 对 MutationObserver 免疫(tile.isWidget 直接跳过),格子随便折腾。
 *  - DOM 选区落进替身且 ignoreEvent()=true → 外层 CM 直接忽略选区变化,
 *    contenteditable 格子里的光标/蓝底选中自成孤岛,不会掀装饰桌。
 *  - CM 对 contentDOM 的 mousedown 会 preventDefault,点格外不会自然失焦 ——
 *    收摊要靠 document capture 阶段抢先 blur。
 */
import { WidgetType, type EditorView } from '@codemirror/view'
import type { MdAlign } from '../../../shared/markdown.ts'
import { attachCellEditing, cellTeardown } from './tableCellEditing.ts'
import { renderCellSource } from './tableCellSource.ts'
import { attachTableControls } from './tableControls.ts'
import { readModelFromDom } from './tableDom.ts'
import { attachTableSelection, selectionTeardown } from './tableSelection.ts'
import { serializeTable, type TableModel } from './tableModel.ts'

export { splitRowCells, tableModelFromSource, serializeTable } from './tableModel.ts'
export type { TableModel } from './tableModel.ts'

/** 点表格边缘卸妆露源码的回调(由 markdownLive 装配时注入,避免循环依赖) */
export type TableReveal = (view: EditorView, from: number) => (e: MouseEvent) => void

// ── 替身本体 ──

export class TableWidget extends WidgetType {
  readonly model: TableModel
  readonly from: number
  readonly reveal: TableReveal
  constructor(model: TableModel, from: number, reveal: TableReveal) {
    super()
    this.model = model
    this.from = from
    this.reveal = reveal
  }
  /** 整模型相等才免重画;不等交给 updateDOM 判断 DOM 是否已是最新(敲字)还是过期(重排/增删) */
  eq(other: WidgetType): boolean {
    return (
      other instanceof TableWidget && serializeTable(other.model) === serializeTable(this.model)
    )
  }
  /**
   * DOM 里的源码账与新模型一致 = 这次文档变动就是格内敲字引起的,保住 DOM(caret/焦点全靠它活);
   * 不一致 = 抓手重排、右键增删等结构操作,DOM 已过期,返回 false 让编辑器重建。
   */
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (serializeTable(readModelFromDom(dom)) !== serializeTable(this.model)) return false
    this.bindReveal(dom, view)
    return true
  }
  /** 点表格边缘/空白卸妆露管道源码(烂表逃生口);格子/抓手/菜单各有 handler。每次换新 widget 重绑,from 才不过期 */
  private bindReveal(box: HTMLElement, view: EditorView): void {
    box.onmousedown = (e) => {
      const t = e.target as HTMLElement
      if (t.closest('td, th, .cm-live-table-ui, .cm-live-table-menu')) return
      this.reveal(view, this.from)(e)
    }
  }
  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument
    const box = doc.createElement('div')
    box.className = 'cm-live-table md'
    this.bindReveal(box, view)
    const wrapEl = doc.createElement('div')
    wrapEl.className = 'md-table-wrap'
    const table = doc.createElement('table')
    table.className = 'md-table'
    const aligns = this.model.aligns

    const thead = doc.createElement('thead')
    const trh = doc.createElement('tr')
    this.model.head.forEach((raw, j) => {
      trh.appendChild(makeCell(view, 'th', raw, aligns[j] ?? 'left'))
    })
    thead.appendChild(trh)
    table.appendChild(thead)

    const tbody = doc.createElement('tbody')
    const cols = this.model.head.length
    this.model.rows.forEach((row) => {
      const tr = doc.createElement('tr')
      for (let c = 0; c < cols; c++)
        tr.appendChild(makeCell(view, 'td', row[c] ?? '', aligns[c] ?? 'left'))
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    wrapEl.appendChild(table)
    box.appendChild(wrapEl)
    attachTableControls(view, box, wrapEl)
    attachTableSelection(view, box)
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
  destroy(dom: HTMLElement): void {
    // 替身被拆时格子的收摊哨随 DOM 一起死 —— 按户口逐个摘掉
    dom.querySelectorAll('.cm-live-cell-src').forEach((el) => cellTeardown.get(el)?.())
    selectionTeardown.get(dom)?.()
  }
}

/** 造一个编辑格:td/th + 常驻 contenteditable 源码格(dataset.raw 是源码户口) */
function makeCell(view: EditorView, tag: 'th' | 'td', raw: string, align: MdAlign): HTMLElement {
  const cell = view.dom.ownerDocument.createElement(tag)
  cell.dataset.raw = raw
  cell.dataset.align = align
  cell.style.textAlign = align
  const src = view.dom.ownerDocument.createElement('div')
  src.className = 'cm-live-cell-src'
  src.contentEditable = 'true'
  src.spellcheck = false
  renderCellSource(src, raw, view.dom.ownerDocument)
  cell.appendChild(src)
  attachCellEditing(view, cell, src)
  return cell
}
