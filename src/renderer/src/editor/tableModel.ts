/** 表格模型:管道表源码 ↔ 中间账(纯函数,无 DOM / 无 CM 依赖,node 自测直接驱动) */
import type { MdAlign } from '../../../shared/markdown.ts'

// 模型:源码 ↔ 中间账

/** 表格模型:表头格 + 对齐登记 + 数据行;格内是源码文本(含 \| 转义) */
export interface TableModel {
  head: string[]
  aligns: MdAlign[]
  rows: string[][]
}

/**
 * 管道行拆格:掐掉可选的头尾外管,按未转义 | 切开,逐格修边。
 * `a\|b` 里的 \| 是格内文字不当分隔,原样保留在格子里。
 * lezer 对空格不发 TableCell 节点,按 | 数格才能让空列登记不丢。
 */
export function splitRowCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  const cells: string[] = []
  let buf = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length) {
      buf += ch + s[i + 1]
      i++
      continue
    }
    if (ch === '|') {
      cells.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  cells.push(buf.trim())
  return cells
}

const sepAlign = (c: string): MdAlign =>
  c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'

/** 表格源码段 → 模型;第二行必须是分隔行才认账 */
export function tableModelFromSource(src: string): TableModel | null {
  const lines = src.split('\n')
  if (lines.length < 2) return null
  const sep = splitRowCells(lines[1])
  if (!sep.length || !sep.every((c) => /^:?-{2,}:?$/.test(c))) return null
  const head = splitRowCells(lines[0])
  if (!head.length) return null
  const aligns = head.map((_, i) => sepAlign(sep[i] ?? ''))
  const rows = lines
    .slice(2)
    .filter((l) => l.includes('|'))
    .map(splitRowCells)
  return { head, aligns, rows }
}

/** 格子源码安全化:换行压空格(行结构护体),裸 | 转义(格结构护体,已转义的不重复转) */
const escapeCell = (t: string): string => t.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|')

const sepCellOf = (a: MdAlign): string =>
  a === 'center' ? ':---:' : a === 'right' ? '---:' : '---'

/** 模型 → 规范 GFM 源码(整表重写入口;对齐登记写回分隔行) */
export function serializeTable(m: TableModel): string {
  const cols = m.head.length
  const row = (cells: string[]): string =>
    '| ' + Array.from({ length: cols }, (_, i) => escapeCell(cells[i] ?? '')).join(' | ') + ' |'
  return [
    row(m.head),
    '| ' + m.head.map((_, i) => sepCellOf(m.aligns[i] ?? 'left')).join(' | ') + ' |',
    ...m.rows.map(row)
  ].join('\n')
}
