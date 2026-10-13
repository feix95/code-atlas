// 对齐吸附(纯逻辑,无 React / DOM):Figma 式 Snap to objects。
// 拖动中矩形的 起边/中线/终边 逐一对目标(其他矩形 + 画板)的 起边/中线/终边,
// 最近且落在阈值内的那对即吸附;返回值附引导线的位置与跨越范围,交给覆盖层画线。
// 阈值是屏幕像素换算来的设计单位,调用方负责 /zoom。
import type { RectNode } from './node.ts'

/** 吸附参与方需要的最小几何:轴对齐包围盒(旋转矩形按声明外接框算,与选中描边同口径) */
export interface SnapBox {
  x: number
  y: number
  width: number
  height: number
}

/** 垂直引导线:横坐标 x,纵跨 [y1, y2];水平引导线同理(设计单位) */
export interface SnapGuides {
  v: { x: number; y1: number; y2: number } | null
  h: { y: number; x1: number; x2: number } | null
}

export interface SnapResult {
  x: number
  y: number
  guides: SnapGuides
}

/** 一条轴上的三个吸附锚点:起边 / 中线 / 终边(Figma 同款候选集) */
function anchors(start: number, size: number): readonly [number, number, number] {
  return [start, start + size / 2, start + size]
}

interface AxisHit {
  /** 被拖矩形需要补偿的位移量 */
  delta: number
  /** 对上的目标锚点坐标(引导线位置) */
  pos: number
  /** 对上的目标盒子,引导线跨越范围由它和被拖矩形的并集决定 */
  target: SnapBox
}

function snapAxis(
  draggedAnchors: readonly number[],
  targets: readonly SnapBox[],
  axis: 'x' | 'y',
  threshold: number
): AxisHit | null {
  let best: AxisHit | null = null
  for (const t of targets) {
    const tAnchors = axis === 'x' ? anchors(t.x, t.width) : anchors(t.y, t.height)
    for (const tp of tAnchors) {
      for (const dp of draggedAnchors) {
        const delta = tp - dp
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, pos: tp, target: t }
        }
      }
    }
  }
  return best
}

/**
 * 移动吸附:dragged 是位移后的候选位(未舍入),targets = 其他矩形 + 画板盒。
 * 两轴独立取最近命中;引导线跨越范围取「吸附后的被拖矩形 ∪ 命中目标」的并集。
 */
export function snapMove(
  dragged: SnapBox,
  targets: readonly SnapBox[],
  threshold: number
): SnapResult {
  const vx = snapAxis(anchors(dragged.x, dragged.width), targets, 'x', threshold)
  const hy = snapAxis(anchors(dragged.y, dragged.height), targets, 'y', threshold)
  const x = dragged.x + (vx?.delta ?? 0)
  const y = dragged.y + (hy?.delta ?? 0)
  return {
    x,
    y,
    guides: {
      v: vx
        ? {
            x: vx.pos,
            y1: Math.min(y, vx.target.y),
            y2: Math.max(y + dragged.height, vx.target.y + vx.target.height)
          }
        : null,
      h: hy
        ? {
            y: hy.pos,
            x1: Math.min(x, hy.target.x),
            x2: Math.max(x + dragged.width, hy.target.x + hy.target.width)
          }
        : null
    }
  }
}

/** 节点列表 → 吸附目标盒列表(排除自身),调用方再拼上画板盒 */
export function snapTargets(nodes: readonly RectNode[], excludeId: string): SnapBox[] {
  return nodes
    .filter((n) => n.id !== excludeId)
    .map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }))
}
