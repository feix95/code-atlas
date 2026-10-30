// 悬停提示框的内容与落位:只读节点与模块叠加层,不碰 DOM,便于自测。
// 提示贴在节点上方;上方放不下时翻到下方,左右越界夹回画布内。
import type { LevelNode } from '@shared/graphView'
import { GRAPH_TIP } from './graphConfig.ts'

export interface NodeTipSignals {
  /** 模块数据可用:不可用时不能把没归属的文件说成「未归类」 */
  hasModules: boolean
  /** 文件:所属模块名;文件夹:占比过半的模块名(没有过半则为 null) */
  moduleName: string | null
  /** 文件夹:分段色环的段数(0 = 没有模块构成可显示) */
  ringSegments: number
}

export interface NodeTipText {
  title: string
  /** 第二行;空串表示不显示 */
  sub: string
}

export function nodeTipText(node: LevelNode, signals: NodeTipSignals): NodeTipText {
  switch (node.kind) {
    case 'file':
      return {
        title: node.label,
        sub: signals.hasModules ? (signals.moduleName ?? '未归类') : ''
      }
    case 'folder':
      if (signals.moduleName) return { title: node.label, sub: `主要 ${signals.moduleName}` }
      if (signals.ringSegments > 1)
        return { title: node.label, sub: `跨 ${signals.ringSegments} 个模块` }
      return { title: node.label, sub: `${node.descendantFiles} 个文件` }
    case 'external':
      return { title: node.label, sub: '当前文件夹之外' }
    case 'overflow':
      return { title: node.label, sub: `${node.hiddenCount ?? 0} 项未显示` }
  }
}

export interface TipAnchor {
  /** 节点圆心在画布内的像素坐标 */
  x: number
  y: number
  /** 缩放后的节点半径 */
  r: number
}

export interface BoxSize {
  w: number
  h: number
}

export interface TipPlacement {
  left: number
  top: number
  side: 'top' | 'bottom'
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), Math.max(lo, hi))

export function tipPlacement(anchor: TipAnchor, size: BoxSize, view: BoxSize): TipPlacement {
  const { gapPx, edgePx } = GRAPH_TIP
  const left = clamp(anchor.x - size.w / 2, edgePx, view.w - edgePx - size.w)
  const above = anchor.y - anchor.r - gapPx - size.h
  const below = anchor.y + anchor.r + gapPx
  const fitsBelow = below + size.h <= view.h - edgePx
  const side = above < edgePx && fitsBelow ? 'bottom' : 'top'
  const top = clamp(side === 'bottom' ? below : above, edgePx, view.h - edgePx - size.h)
  return { left, top, side }
}
