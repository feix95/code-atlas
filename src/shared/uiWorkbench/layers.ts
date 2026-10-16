// 图层/页面列表拖拽排序的换算(纯逻辑,无 React / DOM)。
// 列表里的「槽位」= 行与行之间的缝:0 = 第一行上方,count = 最后一行下方;槽位按「含被拖行」的原列表算。
import type { SceneNode } from './scene.ts'

/** 图层面板的显示顺序:数组顺序是 z 序(靠后在上层),面板要上层在上,所以倒过来 */
export function layerDisplayOrder(nodes: readonly SceneNode[]): SceneNode[] {
  return [...nodes].reverse()
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
