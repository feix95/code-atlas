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
  ibtn: {
    label: '图标按钮 · 中',
    group: 'ibtn',
    handles: [
      { edge: 'right', token: 'ibtn-size-md', label: '按钮尺寸', factor: 1, min: 16, max: 96 },
      { edge: 'corner', token: 'ibtn-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'ibtn-sm': {
    label: '图标按钮 · 小',
    group: 'ibtn',
    handles: [
      { edge: 'right', token: 'ibtn-size-sm', label: '按钮尺寸', factor: 1, min: 16, max: 96 },
      { edge: 'corner', token: 'ibtn-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'ibtn-lg': {
    label: '图标按钮 · 大',
    group: 'ibtn',
    handles: [
      { edge: 'right', token: 'ibtn-size-lg', label: '按钮尺寸', factor: 1, min: 16, max: 96 },
      { edge: 'corner', token: 'ibtn-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'ibtn-icon': {
    label: '图标按钮图标',
    group: 'ibtn',
    handles: [
      { edge: 'right', token: 'ibtn-icon-size', label: '图标尺寸', factor: 1, min: 8, max: 48 }
    ]
  },
  sw: {
    label: '开关 · 中',
    group: 'sw',
    handles: [
      { edge: 'right', token: 'sw-width-md', label: '轨道宽', factor: 1, min: 24, max: 96 },
      { edge: 'bottom', token: 'sw-height-md', label: '轨道高', factor: 1, min: 12, max: 64 }
    ]
  },
  'sw-sm': {
    label: '开关 · 小',
    group: 'sw',
    handles: [
      { edge: 'right', token: 'sw-width-sm', label: '轨道宽', factor: 1, min: 24, max: 96 },
      { edge: 'bottom', token: 'sw-height-sm', label: '轨道高', factor: 1, min: 12, max: 64 }
    ]
  },
  chk: {
    label: '复选框 · 中',
    group: 'chk',
    handles: [
      { edge: 'right', token: 'chk-size-md', label: '尺寸', factor: 1, min: 10, max: 48 },
      { edge: 'corner', token: 'chk-radius', label: '圆角', factor: 1, min: 0, max: 24 }
    ]
  },
  'chk-sm': {
    label: '复选框 · 小',
    group: 'chk',
    handles: [
      { edge: 'right', token: 'chk-size-sm', label: '尺寸', factor: 1, min: 10, max: 48 },
      { edge: 'corner', token: 'chk-radius', label: '圆角', factor: 1, min: 0, max: 24 }
    ]
  },
  'chk-mark': {
    label: '复选框勾号',
    group: 'chk',
    handles: [
      { edge: 'right', token: 'chk-mark-md', label: '勾号尺寸', factor: 1, min: 6, max: 40 }
    ]
  },
  'ipt-box': {
    label: '输入框',
    group: 'ipt',
    handles: [
      { edge: 'bottom', token: 'ipt-height-md', label: '高度', factor: 1, min: 24, max: 96 },
      { edge: 'right', token: 'ipt-width', label: '宽度', factor: 1, min: 80, max: 640 },
      { edge: 'corner', token: 'ipt-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'ipt-icon': {
    label: '输入框图标',
    group: 'ipt',
    handles: [
      { edge: 'right', token: 'ipt-icon-size', label: '图标尺寸', factor: 1, min: 8, max: 40 }
    ]
  },
  tab: {
    label: '页签',
    group: 'tab',
    handles: [
      {
        edge: 'right',
        token: 'tab-padding-x-md',
        label: '左右内边距',
        factor: 0.5,
        min: 0,
        max: 64
      },
      {
        edge: 'bottom',
        token: 'tab-padding-y-md',
        label: '上下内边距',
        factor: 0.5,
        min: 0,
        max: 32
      }
    ]
  },
  li: {
    label: '列表行',
    group: 'li',
    handles: [
      { edge: 'right', token: 'li-padding-x', label: '左右内边距', factor: 0.5, min: 0, max: 64 },
      { edge: 'bottom', token: 'li-padding-y', label: '上下内边距', factor: 0.5, min: 0, max: 48 }
    ]
  },
  'li-lead': {
    label: '列表行前置位',
    group: 'li',
    handles: [
      { edge: 'right', token: 'li-icon-box', label: '前置位尺寸', factor: 1, min: 16, max: 64 }
    ]
  },
  'li-lead-icon': {
    label: '列表行前置图标',
    group: 'li',
    handles: [
      { edge: 'right', token: 'li-icon-size', label: '图标尺寸', factor: 1, min: 8, max: 48 }
    ]
  },
  'li-avatar': {
    label: '列表行头像',
    group: 'li',
    handles: [{ edge: 'right', token: 'li-avatar', label: '头像尺寸', factor: 1, min: 16, max: 80 }]
  },
  'li-trail': { label: '列表行尾部', group: 'li', handles: [] },
  'li-trail-icon': {
    label: '列表行尾部图标',
    group: 'li',
    handles: [
      { edge: 'right', token: 'li-trail-icon', label: '图标尺寸', factor: 1, min: 8, max: 40 }
    ]
  },
  'li-value': {
    label: '列表行数值',
    group: 'li',
    handles: [
      { edge: 'bottom', token: 'li-value-size', label: '数值字号', factor: 1, min: 8, max: 32 }
    ]
  },
  tip: {
    label: '提示气泡',
    group: 'tip',
    handles: [
      { edge: 'right', token: 'tip-padding-x', label: '左右内边距', factor: 0.5, min: 0, max: 48 },
      { edge: 'bottom', token: 'tip-padding-y', label: '上下内边距', factor: 0.5, min: 0, max: 32 },
      { edge: 'corner', token: 'tip-radius', label: '圆角', factor: 1, min: 0, max: 32 }
    ]
  },
  'tip-arrow': {
    label: '提示气泡箭头',
    group: 'tip',
    handles: [
      { edge: 'right', token: 'tip-arrow-size', label: '箭头尺寸', factor: 1, min: 4, max: 24 }
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
  },
  'app-screen': { label: '应用页容器', group: 'app', handles: [] },
  'app-nav': {
    label: '应用导航栏',
    group: 'app',
    handles: [
      {
        edge: 'bottom',
        token: 'app-nav-height',
        label: '导航栏高度',
        factor: 1,
        min: 32,
        max: 128
      }
    ]
  },
  'app-body': {
    label: '页面内容区',
    group: 'app',
    handles: [
      {
        edge: 'bottom',
        token: 'app-body-gap',
        label: '区块间距',
        factor: 1,
        min: 0,
        max: 64
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
