// 画布部件 → 拖动手柄映射(§5.6、§7.1 手柄映射):哪个部件、哪条边、改哪个变量、换算系数与上下限。
// 新增可拖部件只加配置。系数:拖动 1 逻辑像素对应变量变化多少(左右对称的内边距为 0.5)。
import { magnetCandidates, refGroup } from './resolve.ts'
import type { TokenMap, TokenValue } from './types.ts'
import { MAGNET_PX, SNAP_STEP_PX, snapPx } from './units.ts'

export type HandleEdge = 'right' | 'bottom' | 'corner'

export interface HandleDef {
  edge: HandleEdge
  token: string
  label: string
  factor: number
  min: number
  max: number
}

export interface PartDef {
  label: string
  /** 属性面板列出的变量分组(tokens 的 path[0]) */
  group: string
  handles: HandleDef[]
}

const btn = (size: 'sm' | 'md' | 'lg', label: string): PartDef => ({
  label,
  group: 'btn',
  handles: [
    { edge: 'bottom', token: `btn-height-${size}`, label: '高度', factor: 1, min: 16, max: 96 },
    {
      edge: 'right',
      token: `btn-padding-x-${size}`,
      label: '左右内边距',
      factor: 0.5,
      min: 0,
      max: 64
    },
    { edge: 'corner', token: 'btn-radius', label: '圆角', factor: 1, min: 0, max: 48 }
  ]
})

export const PARTS: Record<string, PartDef> = {
  'btn-sm': btn('sm', '按钮 · 小'),
  'btn-md': btn('md', '按钮 · 中'),
  'btn-lg': btn('lg', '按钮 · 大'),
  'btn-icon': {
    label: '按钮图标',
    group: 'btn',
    handles: [
      { edge: 'right', token: 'btn-icon-size', label: '图标尺寸', factor: 1, min: 8, max: 48 }
    ]
  },
  card: {
    label: '卡片',
    group: 'card',
    handles: [
      { edge: 'bottom', token: 'card-padding', label: '内边距', factor: 0.5, min: 0, max: 64 },
      { edge: 'corner', token: 'card-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'card-icon-box': {
    label: '卡片图标底块',
    group: 'card',
    handles: [
      { edge: 'right', token: 'card-icon-box', label: '底块尺寸', factor: 1, min: 16, max: 96 },
      { edge: 'bottom', token: 'card-icon-gap', label: '底块下间距', factor: 1, min: 0, max: 64 },
      { edge: 'corner', token: 'card-icon-radius', label: '底块圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'card-icon': {
    label: '卡片图标',
    group: 'card',
    handles: [
      { edge: 'right', token: 'card-icon-size', label: '图标尺寸', factor: 1, min: 8, max: 48 }
    ]
  },
  'page-header': {
    label: '顶栏',
    group: 'page',
    handles: [
      {
        edge: 'bottom',
        token: 'page-header-height',
        label: '顶栏高度',
        factor: 1,
        min: 32,
        max: 160
      }
    ]
  },
  'page-hero': {
    label: '首屏',
    group: 'page',
    handles: [
      {
        edge: 'bottom',
        token: 'page-hero-pad-bottom',
        label: '首屏下留白',
        factor: 1,
        min: 0,
        max: 256
      }
    ]
  }
}

/** 拖动位移 → 变量变化量(角点:向内拖为增大圆角) */
export function dragDelta(edge: HandleEdge, dx: number, dy: number): number {
  if (edge === 'right') return dx
  if (edge === 'bottom') return dy
  return (dx + dy) / 2
}

export interface DragOutcome {
  px: number
  value: TokenValue
  /** 磁吸到的基础变量名;没吸上为 null */
  magnet: string | null
}

/** 拖到的原始像素 → 最终写入的变量值。
 *  free = 按住 Alt:不吸附、不磁吸,保留 0.5 逻辑像素精度;
 *  否则按步长吸附,并在 MAGNET_PX 内磁吸到同族基础变量(写成引用) */
export function resolveDrag(
  tokens: TokenMap,
  defaults: TokenMap,
  handle: HandleDef,
  rawPx: number,
  free: boolean
): DragOutcome {
  if (free) {
    const px = snapPx(rawPx, 0.5, handle.min, handle.max)
    return { px, value: { kind: 'dimension', px }, magnet: null }
  }
  const px = snapPx(rawPx, SNAP_STEP_PX, handle.min, handle.max)
  const group = refGroup(defaults, handle.token)
  if (group) {
    const near = magnetCandidates(tokens, group).find((c) => Math.abs(c.px - rawPx) <= MAGNET_PX)
    if (near && near.px >= handle.min && near.px <= handle.max) {
      return { px: near.px, value: { kind: 'ref', ref: near.name }, magnet: near.name }
    }
  }
  return { px, value: { kind: 'dimension', px }, magnet: null }
}
