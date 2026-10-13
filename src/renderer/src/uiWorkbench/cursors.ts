// 光标决策:角手柄按其拖动轴在屏幕上的实际方向给 8 向 resize 光标(跟随节点旋转)。
// 拖动过程中光标固定在手势开始时算出的那支,由 useCanvasTools 落在 documentElement 上。
import { rotatePoint } from '@shared/uiWorkbench/geometry'
import type { CornerIndex, EdgeName } from '@shared/uiWorkbench/node'

/** 各角在矩形自身坐标里的拖动轴单位方向(TL/BR 一条对角线,TR/BL 一条) */
const CORNER_DIRS: readonly { x: number; y: number }[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 }
]

/** 按屏幕方向角分四档(屏幕 y 轴向下) */
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const

export function cornerResizeCursor(rotation: number, corner: CornerIndex): string {
  const dir = rotatePoint(CORNER_DIRS[corner], rotation)
  const deg = ((Math.atan2(dir.y, dir.x) * 180) / Math.PI + 180) % 180
  return RESIZE_CURSORS[Math.round(deg / 45) % 4]
}

/** 各边中点手柄的拖动轴 = 边的法线方向(上/下 = 纵向,左/右 = 横向) */
const EDGE_DIRS: Record<EdgeName, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
}

export function edgeResizeCursor(rotation: number, edge: EdgeName): string {
  const dir = rotatePoint(EDGE_DIRS[edge], rotation)
  const deg = ((Math.atan2(dir.y, dir.x) * 180) / Math.PI + 180) % 180
  return RESIZE_CURSORS[Math.round(deg / 45) % 4]
}
