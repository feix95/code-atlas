// 撤销/重做历史(纯逻辑,无 React / DOM):快照式双栈。
// past = 可撤销的基准快照,future = 可重做的快照;一步 = 「动作前的状态」压入 past。
// 手势期间的中间帧不入账:documentStore 的批次(beginBatch/endBatch)负责把一笔手势收成一条。
import type { LineNode } from './line.ts'
import type { RectNode } from './node.ts'
import type { Page } from './page.ts'
import type { SceneNode } from './scene.ts'

/** 一步撤销需要还原的全部内容:全部页面 + 动作发生时所在的页 + 当时的多选集
 *  (撤销会跳回动作发生的那一页,Figma 同款;只切页不入账) */
export interface Snapshot {
  pages: readonly Page[]
  activePageId: string
  selectedIds: readonly string[]
}

/** 历史上限:内存栈,超过丢最老的 */
export const HISTORY_LIMIT = 100

export interface DocHistory {
  readonly past: readonly Snapshot[]
  readonly future: readonly Snapshot[]
}

export function emptyHistory(): DocHistory {
  return { past: [], future: [] }
}

/** 新动作入账:before 是动作前的快照;任何新动作都会砍掉 future( redo 分支作废) */
export function pushHistory(history: DocHistory, before: Snapshot): DocHistory {
  const past = [...history.past, before]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { past, future: [] }
}

/** 撤销:past 弹顶还原,当前状态进 future;无可撤返回 null */
export function undoHistory(
  history: DocHistory,
  current: Snapshot
): { history: DocHistory; restore: Snapshot } | null {
  const restore = history.past.at(-1)
  if (!restore) return null
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, current] },
    restore
  }
}

/** 重做:future 弹顶还原,当前状态回压 past;无可重做返回 null */
export function redoHistory(
  history: DocHistory,
  current: Snapshot
): { history: DocHistory; restore: Snapshot } | null {
  const restore = history.future.at(-1)
  if (!restore) return null
  return {
    history: { past: [...history.past, current], future: history.future.slice(0, -1) },
    restore
  }
}

function sameStroke(a: RectNode['stroke'], b: RectNode['stroke']): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return a.color === b.color && a.width === b.width && a.style === b.style
}

function sameLine(a: LineNode, b: SceneNode): boolean {
  return (
    b.type === 'line' &&
    a.id === b.id &&
    a.name === b.name &&
    a.visible === b.visible &&
    a.locked === b.locked &&
    a.x1 === b.x1 &&
    a.y1 === b.y1 &&
    a.x2 === b.x2 &&
    a.y2 === b.y2 &&
    a.cap === b.cap &&
    a.styleId === b.styleId &&
    sameStroke(a.stroke, b.stroke)
  )
}

/** 逐节点逐字段值比较:applyNodeAction 每次都生成新数组新对象,引用比较恒为 false */
export function sameNodes(a: readonly SceneNode[], b: readonly SceneNode[]): boolean {
  if (a.length !== b.length) return false
  return a.every((na, i) => {
    const nb = b[i]
    if (na.type === 'line') return sameLine(na, nb)
    if (nb.type !== 'rect') return false
    return (
      na.id === nb.id &&
      na.type === nb.type &&
      na.name === nb.name &&
      na.visible === nb.visible &&
      na.locked === nb.locked &&
      na.x === nb.x &&
      na.y === nb.y &&
      na.width === nb.width &&
      na.height === nb.height &&
      na.rotation === nb.rotation &&
      na.fill === nb.fill &&
      sameStroke(na.stroke, nb.stroke) &&
      na.styleId === nb.styleId &&
      na.radii.every((r, j) => r === nb.radii[j])
    )
  })
}

/** 逐页比较:页名、底色、画板尺寸、节点(含顺序)任一不同即异;页顺序也算 */
export function samePages(a: readonly Page[], b: readonly Page[]): boolean {
  if (a.length !== b.length) return false
  return a.every((pa, i) => {
    const pb = b[i]
    return (
      pa.id === pb.id &&
      pa.name === pb.name &&
      pa.background.color === pb.background.color &&
      pa.background.opacity === pb.background.opacity &&
      pa.background.visible === pb.background.visible &&
      pa.artboard.width === pb.artboard.width &&
      pa.artboard.height === pb.artboard.height &&
      sameNodes(pa.nodes, pb.nodes)
    )
  })
}
