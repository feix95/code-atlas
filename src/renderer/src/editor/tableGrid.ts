/** 表格格子网格的纯逻辑:选区矩形归一、剪贴板文本 ↔ 二维格子(无 DOM 依赖,node 自测直接驱动) */
import { serializeTable, tableModelFromSource } from './tableModel.ts'

/** 格子坐标:row 0 是表头行,1 起是数据行 */
export interface CellPos {
  row: number
  col: number
}

/** 选区矩形(闭区间) */
export interface CellRange {
  top: number
  left: number
  bottom: number
  right: number
}

/** 应用内格子剪贴板口径:JSON 二维数组,粘回表格时无损还原 */
export const CELLS_MIME = 'application/x-codeatlas-cells'

export function normalizeRange(a: CellPos, b: CellPos): CellRange {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col)
  }
}

export const isSingleCell = (r: CellRange): boolean => r.top === r.bottom && r.left === r.right

/** 选区矩形 → 全空二维格子(清空用) */
export const emptyGridOf = (r: CellRange): string[][] =>
  Array.from({ length: r.bottom - r.top + 1 }, () =>
    Array.from({ length: r.right - r.left + 1 }, () => '')
  )

const unescapePipe = (text: string): string => text.replace(/\\\|/g, '|')

/** 二维格子 → TSV 文本(Excel / 表格软件通用口径;格内转义的 \| 还原成 |) */
export const gridToTsv = (grid: string[][]): string =>
  grid.map((row) => row.map(unescapePipe).join('\t')).join('\n')

/** 二维格子 → GFM 管道表(首行当表头) */
export function gridToMarkdown(grid: string[][]): string {
  const [head = [], ...rows] = grid
  return serializeTable({ head, aligns: head.map(() => 'left'), rows })
}

/**
 * 剪贴板纯文本 → 二维格子。认三种形态:管道表源码、TSV(含制表符/多行)、单值。
 * 空内容返回 null(粘贴什么都不做)。
 */
export function parseClipboardText(text: string): string[][] | null {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!normalized.trim()) return null
  const table = tableModelFromSource(normalized)
  if (table) return [table.head, ...table.rows]
  if (normalized.includes('\t') || normalized.includes('\n'))
    return normalized.split('\n').map((line) => line.split('\t').map((cell) => cell.trim()))
  return [[normalized.trim()]]
}

/** 应用内 JSON 载荷 → 二维格子;不是合法二维字符串数组返回 null */
export function parseCellsPayload(json: string): string[][] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    console.warn('[tableGrid] 格子剪贴板载荷解析失败', err)
    return null
  }
  const isGrid =
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every((row) => Array.isArray(row) && row.every((c) => typeof c === 'string'))
  return isGrid ? (parsed as string[][]) : null
}
