// 图层/页面列表拖拽排序的换算(纯逻辑,无 React / DOM)。
// 列表里的「槽位」= 行与行之间的缝:0 = 第一行上方,count = 最后一行下方;槽位按「含被拖行」的原列表算。
import type { SceneNode } from './scene.ts'
import { childrenOf, siblingReorderIndex } from './tree.ts'

/** 平铺显示顺序:数组顺序是 z 序(靠后在上层),上层在上所以倒过来(不分层级) */
export function layerDisplayOrder(nodes: readonly SceneNode[]): SceneNode[] {
  return [...nodes].reverse()
}

/** 图层面板的一行:树里的一个节点 + 它的缩进深度与折叠状态 */
export interface LayerRow {
  node: SceneNode
  depth: number
  /** 实际所在容器(悬空的 parentId 已归一为 null) */
  parentId: string | null
  hasChildren: boolean
  isExpanded: boolean
}

/** 图层面板的显示行(树形):同级数组顺序是 z 序(靠后在上层),面板要上层在上,所以同级倒过来;
 *  画板的后代缩进显示在它下面;collapsed 里的画板不展开后代 */
export function layerTreeRows(
  nodes: readonly SceneNode[],
  collapsed: ReadonlySet<string> = new Set()
): LayerRow[] {
  const rows: LayerRow[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const node of [...childrenOf(nodes, parentId)].reverse()) {
      const kids = node.type === 'frame' ? childrenOf(nodes, node.id) : []
      const isExpanded = kids.length > 0 && !collapsed.has(node.id)
      rows.push({ node, depth, parentId, hasChildren: kids.length > 0, isExpanded })
      if (isExpanded) walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/** 拖第 fromRow 行落到槽位 slot(只在同一容器的兄弟之间调序):返回 reorder 动作的 toIndex(数组下标);
 *  原地不动返回 null。位置 = 槽位上方的同级兄弟个数(不含自己),即落定后它在同级里从上数的名次 */
export function layerTreeReorderIndex(
  nodes: readonly SceneNode[],
  rows: readonly LayerRow[],
  fromRow: number,
  slot: number
): number | null {
  const from = rows[fromRow]
  if (!from) return null
  const above = rows.filter(
    (r, i) => i < slot && i !== fromRow && r.parentId === from.parentId
  ).length
  const siblings = rows.filter((r, i) => i !== fromRow && r.parentId === from.parentId).length
  const toIndex = siblingReorderIndex(nodes, from.node.id, siblings - above)
  return toIndex === nodes.indexOf(from.node) ? null : toIndex
}

/** 拖第 fromRow 行落到槽位 slot:返回落定后该行在列表里的位置;原地不动(落在自己上下缝)返回 null */
export function rowDropPosition(count: number, fromRow: number, slot: number): number | null {
  const clamped = Math.min(count, Math.max(0, Math.round(slot)))
  const position = clamped > fromRow ? clamped - 1 : clamped
  return position === fromRow ? null : position
}

/** 图层行(上层在前)落位 → reorder 动作的 toIndex(数组下标);原地不动返回 null */
export function layerReorderIndex(count: number, fromRow: number, slot: number): number | null {
  const position = rowDropPosition(count, fromRow, slot)
  return position === null ? null : count - 1 - position
}

/** 指针 Y 落在哪条缝:rowMids 是各行垂直中线(自上而下),指针在第 i 行中线之上则落在第 i 缝 */
export function slotFromPointer(rowMids: readonly number[], pointerY: number): number {
  const index = rowMids.findIndex((mid) => pointerY < mid)
  return index < 0 ? rowMids.length : index
}
