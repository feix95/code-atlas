// 悬停提示框的内容与落位:只读节点与模块叠加层,不碰 DOM,便于自测。
// 只给「补全画布上看不全的信息」:文件说属于哪个模块,画布截断的名字在这里补全;
// 文件夹、overflow 节点不弹提示(文件数与模块数对理解项目没有直接帮助,统计看侧栏)。
// 提示贴在节点上方;上方放不下时翻到下方,左右越界夹回画布内。
import type { LevelNode } from '@shared/graphView'
import { GRAPH_LABEL, GRAPH_TIP } from './graphConfig.ts'

export interface NodeTipSignals {
  /** 模块数据可用:不可用时不能把没归属的文件说成「未归类」 */
  hasModules: boolean
  /** 文件所属模块名;没有归属为 null */
  moduleName: string | null
}

export interface NodeTipText {
  /** 画布上名字被截断时的完整名字;空串表示不显示 */
  title: string
  /** 第二行;空串表示不显示 */
  sub: string
}

/** 画布标签能完整显示时不再重复搬运同一个名字 */
function fullLabel(node: LevelNode): string {
  return node.label.length > GRAPH_LABEL.maxChars ? node.label : ''
}

export function nodeTipText(node: LevelNode, signals: NodeTipSignals): NodeTipText | null {
  switch (node.kind) {
    case 'file': {
      const sub = signals.hasModules
        ? signals.moduleName
          ? `属于 ${signals.moduleName}`
          : '未归类'
        : ''
      const title = fullLabel(node)
      return title || sub ? { title, sub } : null
    }
    case 'folder':
      return null
    case 'external':
      return { title: fullLabel(node), sub: '当前文件夹之外' }
    case 'overflow':
      return null
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
