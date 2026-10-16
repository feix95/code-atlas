// 节点在视口上的屏幕坐标轮廓:矩形取旋转后的四角,直线取两端点。选中描边与图层悬停描边共用。
import { cornerLocal, toWorld } from '@shared/uiWorkbench/geometry'
import { CORNERS } from '@shared/uiWorkbench/node'
import type { SceneNode } from '@shared/uiWorkbench/scene'
import type { Viewport } from './viewport'

export interface ScreenPoint {
  x: number
  y: number
}

export function toScreenPoint(view: Viewport, p: { x: number; y: number }): ScreenPoint {
  return { x: view.panX + p.x * view.zoom, y: view.panY + p.y * view.zoom }
}

export function nodeOutline(node: SceneNode, view: Viewport): ScreenPoint[] {
  if (node.type === 'line') {
    return [
      toScreenPoint(view, { x: node.x1, y: node.y1 }),
      toScreenPoint(view, { x: node.x2, y: node.y2 })
    ]
  }
  return CORNERS.map((c) => toScreenPoint(view, toWorld(node, cornerLocal(node, c))))
}

export function pointsAttr(points: readonly ScreenPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}
