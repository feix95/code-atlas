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
  rdo: {
    label: '单选 · 中',
    group: 'rdo',
    handles: [{ edge: 'right', token: 'rdo-size-md', label: '尺寸', factor: 1, min: 10, max: 48 }]
  },
  'rdo-sm': {
    label: '单选 · 小',
    group: 'rdo',
    handles: [{ edge: 'right', token: 'rdo-size-sm', label: '尺寸', factor: 1, min: 10, max: 40 }]
  },
  seg: {
    label: '分段控件',
    group: 'seg',
    handles: [
      { edge: 'right', token: 'seg-it-padding-x', label: '段内边距', factor: 0.5, min: 0, max: 48 }
    ]
  },
  sld: {
    label: '滑块',
    group: 'sld',
    handles: [
      { edge: 'right', token: 'sld-width', label: '轨道长', factor: 1, min: 80, max: 640 },
      { edge: 'bottom', token: 'sld-thumb', label: '滑块尺寸', factor: 1, min: 8, max: 40 }
    ]
  },
  'sel-box': {
    label: '下拉选择',
    group: 'sel',
    handles: [
      { edge: 'right', token: 'sel-width', label: '宽度', factor: 1, min: 80, max: 480 },
      { edge: 'bottom', token: 'sel-height-md', label: '高度', factor: 1, min: 24, max: 96 },
      { edge: 'corner', token: 'sel-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  stp: {
    label: '步进器',
    group: 'stp',
    handles: [
      { edge: 'bottom', token: 'stp-height', label: '高度', factor: 1, min: 24, max: 72 },
      { edge: 'corner', token: 'stp-radius', label: '圆角', factor: 1, min: 0, max: 32 }
    ]
  },
  rate: {
    label: '评分',
    group: 'rate',
    handles: [{ edge: 'right', token: 'rate-size', label: '星星尺寸', factor: 1, min: 10, max: 64 }]
  },
  ta: {
    label: '文本域',
    group: 'ta',
    handles: [
      { edge: 'right', token: 'ta-width', label: '宽度', factor: 1, min: 120, max: 640 },
      { edge: 'bottom', token: 'ta-min-height', label: '最小高度', factor: 1, min: 40, max: 400 },
      { edge: 'corner', token: 'ta-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  srch: {
    label: '搜索框',
    group: 'srch',
    handles: [
      { edge: 'right', token: 'srch-width', label: '宽度', factor: 1, min: 120, max: 560 },
      { edge: 'bottom', token: 'srch-height', label: '高度', factor: 1, min: 24, max: 96 }
    ]
  },
  'srch-ic': {
    label: '搜索框图标',
    group: 'srch',
    handles: [
      { edge: 'right', token: 'srch-icon-size', label: '图标尺寸', factor: 1, min: 8, max: 40 }
    ]
  },
  bgrp: {
    label: '按钮组',
    group: 'bgrp',
    handles: [
      { edge: 'bottom', token: 'bgrp-height', label: '高度', factor: 1, min: 24, max: 96 },
      { edge: 'corner', token: 'bgrp-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'bgrp-it': {
    label: '按钮组项',
    group: 'bgrp',
    handles: [
      { edge: 'right', token: 'bgrp-padding-x', label: '左右内边距', factor: 0.5, min: 0, max: 64 }
    ]
  },
  'sel-ic': {
    label: '下拉箭头',
    group: 'sel',
    handles: [
      { edge: 'right', token: 'sel-icon-size', label: '箭头尺寸', factor: 1, min: 8, max: 40 }
    ]
  },
  toast: {
    label: '轻提示',
    group: 'toast',
    handles: [
      {
        edge: 'right',
        token: 'toast-padding-x',
        label: '左右内边距',
        factor: 0.5,
        min: 0,
        max: 64
      },
      {
        edge: 'bottom',
        token: 'toast-padding-y',
        label: '上下内边距',
        factor: 0.5,
        min: 0,
        max: 48
      },
      { edge: 'corner', token: 'toast-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  banner: {
    label: '横幅',
    group: 'bnr',
    handles: [
      { edge: 'right', token: 'bnr-width', label: '宽度', factor: 1, min: 120, max: 960 },
      { edge: 'bottom', token: 'bnr-padding-y', label: '上下内边距', factor: 0.5, min: 0, max: 48 },
      { edge: 'corner', token: 'bnr-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  prog: {
    label: '进度条',
    group: 'prog',
    handles: [
      { edge: 'right', token: 'prog-width', label: '轨道长', factor: 1, min: 40, max: 640 },
      { edge: 'bottom', token: 'prog-height', label: '轨道高', factor: 1, min: 2, max: 32 }
    ]
  },
  'prog-fill': {
    label: '进度条填充',
    group: 'prog',
    handles: [{ edge: 'right', token: 'prog-fill', label: '填充长度', factor: 1, min: 0, max: 640 }]
  },
  spin: {
    label: '加载圈',
    group: 'spin',
    handles: [{ edge: 'right', token: 'spin-size', label: '尺寸', factor: 1, min: 8, max: 96 }]
  },
  'spin-sm': {
    label: '加载圈 · 小',
    group: 'spin',
    handles: [{ edge: 'right', token: 'spin-size-sm', label: '尺寸', factor: 1, min: 8, max: 64 }]
  },
  skl: {
    label: '骨架占位',
    group: 'skl',
    handles: [
      { edge: 'right', token: 'skl-line-w', label: '行宽', factor: 1, min: 24, max: 640 },
      { edge: 'bottom', token: 'skl-line-h', label: '行高', factor: 1, min: 4, max: 64 },
      { edge: 'corner', token: 'skl-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  emp: {
    label: '空状态',
    group: 'emp',
    handles: [
      { edge: 'right', token: 'emp-width', label: '宽度', factor: 1, min: 120, max: 720 },
      { edge: 'bottom', token: 'emp-padding-y', label: '上下留白', factor: 0.5, min: 0, max: 128 }
    ]
  },
  'emp-icon': {
    label: '空状态图标位',
    group: 'emp',
    handles: [
      { edge: 'right', token: 'emp-icon-box', label: '底块尺寸', factor: 1, min: 16, max: 128 }
    ]
  },
  bdg: {
    label: '徽标',
    group: 'bdg',
    handles: [{ edge: 'bottom', token: 'bdg-height', label: '高度', factor: 1, min: 8, max: 48 }]
  },
  tag: {
    label: '标签',
    group: 'tag',
    handles: [
      { edge: 'right', token: 'tag-padding-x', label: '左右内边距', factor: 0.5, min: 0, max: 48 },
      { edge: 'bottom', token: 'tag-height', label: '高度', factor: 1, min: 12, max: 64 },
      { edge: 'corner', token: 'tag-radius', label: '圆角', factor: 1, min: 0, max: 32 }
    ]
  },
  avt: {
    label: '头像 · 中',
    group: 'avt',
    handles: [{ edge: 'right', token: 'avt-size-md', label: '尺寸', factor: 1, min: 16, max: 128 }]
  },
  div: {
    label: '分割线',
    group: 'div',
    handles: [
      { edge: 'right', token: 'div-length', label: '长度', factor: 1, min: 8, max: 960 },
      { edge: 'bottom', token: 'div-width', label: '线宽', factor: 1, min: 1, max: 16 }
    ]
  },
  'div-v': {
    label: '竖分割线',
    group: 'div',
    handles: [{ edge: 'bottom', token: 'div-v-length', label: '高度', factor: 1, min: 8, max: 256 }]
  },
  abar: {
    label: '顶栏',
    group: 'abar',
    handles: [
      { edge: 'right', token: 'abar-width', label: '宽度', factor: 1, min: 240, max: 1600 },
      { edge: 'bottom', token: 'abar-height', label: '高度', factor: 1, min: 32, max: 128 }
    ]
  },
  sbar: {
    label: '侧边导航',
    group: 'sbar',
    handles: [
      { edge: 'right', token: 'sbar-width', label: '宽度', factor: 1, min: 120, max: 480 },
      { edge: 'bottom', token: 'sbar-height', label: '高度', factor: 1, min: 80, max: 960 }
    ]
  },
  'sbar-ic': {
    label: '侧边导航图标',
    group: 'sbar',
    handles: [
      { edge: 'right', token: 'sbar-icon-size', label: '图标尺寸', factor: 1, min: 8, max: 48 }
    ]
  },
  rail: {
    label: '图标栏',
    group: 'rail',
    handles: [
      { edge: 'right', token: 'rail-width', label: '栏宽', factor: 1, min: 40, max: 160 },
      { edge: 'bottom', token: 'rail-height', label: '栏高', factor: 1, min: 80, max: 960 }
    ]
  },
  bbar: {
    label: '底部页签栏',
    group: 'bbar',
    handles: [
      { edge: 'right', token: 'bbar-width', label: '宽度', factor: 1, min: 200, max: 960 },
      { edge: 'bottom', token: 'bbar-height', label: '高度', factor: 1, min: 40, max: 120 }
    ]
  },
  crumb: {
    label: '面包屑',
    group: 'crumb',
    handles: [{ edge: 'right', token: 'crumb-gap', label: '项间距', factor: 1, min: 0, max: 32 }]
  },
  'crumb-link': { label: '面包屑项', group: 'crumb', handles: [] },
  pgn: {
    label: '分页',
    group: 'pgn',
    handles: [{ edge: 'right', token: 'pgn-gap', label: '页码间距', factor: 1, min: 0, max: 32 }]
  },
  stps: {
    label: '步骤条',
    group: 'stps',
    handles: [{ edge: 'right', token: 'stps-gap', label: '步骤间距', factor: 1, min: 0, max: 48 }]
  },
  'stps-dot': {
    label: '步骤圆点',
    group: 'stps',
    handles: [{ edge: 'right', token: 'stps-dot', label: '圆点尺寸', factor: 1, min: 12, max: 48 }]
  },
  'stps-link': {
    label: '步骤连线',
    group: 'stps',
    handles: [{ edge: 'right', token: 'stps-link-w', label: '连线长', factor: 1, min: 8, max: 128 }]
  },
  fab: {
    label: '悬浮按钮',
    group: 'fab',
    handles: [
      { edge: 'right', token: 'fab-size', label: '尺寸', factor: 1, min: 32, max: 128 },
      { edge: 'corner', token: 'fab-radius', label: '圆角', factor: 1, min: 0, max: 64 }
    ]
  },
  menu: {
    label: '下拉菜单',
    group: 'menu',
    handles: [
      { edge: 'right', token: 'menu-min-width', label: '最小宽', factor: 1, min: 96, max: 480 },
      { edge: 'corner', token: 'menu-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'menu-sep': { label: '菜单分隔线', group: 'menu', handles: [] },
  pop: {
    label: '气泡卡',
    group: 'pop',
    handles: [
      { edge: 'right', token: 'pop-width', label: '宽度', factor: 1, min: 120, max: 560 },
      { edge: 'bottom', token: 'pop-padding', label: '内边距', factor: 0.5, min: 0, max: 64 },
      { edge: 'corner', token: 'pop-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  dlg: {
    label: '对话框',
    group: 'dlg',
    handles: [
      { edge: 'right', token: 'dlg-width', label: '宽度', factor: 1, min: 240, max: 960 },
      { edge: 'corner', token: 'dlg-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  dwr: {
    label: '抽屉',
    group: 'dwr',
    handles: [
      { edge: 'right', token: 'dwr-width', label: '宽度', factor: 1, min: 160, max: 720 },
      { edge: 'bottom', token: 'dwr-padding', label: '内边距', factor: 0.5, min: 0, max: 96 }
    ]
  },
  sht: {
    label: '底部面板',
    group: 'sht',
    handles: [
      { edge: 'right', token: 'sht-padding-x', label: '左右内边距', factor: 0.5, min: 0, max: 64 },
      { edge: 'corner', token: 'sht-radius', label: '顶部圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'sht-grab': {
    label: '面板把手',
    group: 'sht',
    handles: [{ edge: 'right', token: 'sht-grab-w', label: '把手宽', factor: 1, min: 16, max: 96 }]
  },
  ash: {
    label: '动作菜单',
    group: 'ash',
    handles: [
      { edge: 'right', token: 'ash-width', label: '宽度', factor: 1, min: 240, max: 560 },
      { edge: 'bottom', token: 'ash-item-height', label: '条目高度', factor: 1, min: 32, max: 96 }
    ]
  },
  acdn: {
    label: '折叠面板',
    group: 'acdn',
    handles: [
      { edge: 'right', token: 'acdn-width', label: '宽度', factor: 1, min: 200, max: 720 },
      { edge: 'corner', token: 'acdn-radius', label: '圆角', factor: 1, min: 0, max: 48 }
    ]
  },
  'acdn-ic': {
    label: '折叠箭头',
    group: 'acdn',
    handles: [
      { edge: 'right', token: 'acdn-icon-size', label: '箭头尺寸', factor: 1, min: 8, max: 40 }
    ]
  },
  tbl: {
    label: '表格',
    group: 'tbl',
    handles: [
      { edge: 'right', token: 'tbl-width', label: '宽度', factor: 1, min: 240, max: 1200 },
      {
        edge: 'bottom',
        token: 'tbl-cell-padding-y',
        label: '单元格上下内边距',
        factor: 0.5,
        min: 0,
        max: 48
      },
      { edge: 'corner', token: 'tbl-radius', label: '圆角', factor: 1, min: 0, max: 32 }
    ]
  },
  tree: {
    label: '树形列表',
    group: 'tree',
    handles: [
      { edge: 'right', token: 'tree-width', label: '宽度', factor: 1, min: 160, max: 560 },
      { edge: 'bottom', token: 'tree-item-height', label: '条目高度', factor: 1, min: 24, max: 72 }
    ]
  },
  'tree-ic': {
    label: '树箭头',
    group: 'tree',
    handles: [
      { edge: 'right', token: 'tree-icon-size', label: '箭头尺寸', factor: 1, min: 8, max: 32 }
    ]
  },
  tline: {
    label: '时间线',
    group: 'tline',
    handles: [
      { edge: 'right', token: 'tline-width', label: '宽度', factor: 1, min: 160, max: 640 },
      { edge: 'bottom', token: 'tline-item-gap-y', label: '条目间距', factor: 1, min: 0, max: 96 }
    ]
  },
  'tline-dot': {
    label: '时间线圆点',
    group: 'tline',
    handles: [{ edge: 'right', token: 'tline-dot', label: '圆点尺寸', factor: 1, min: 6, max: 32 }]
  },
  tbar: {
    label: '窗口标题栏',
    group: 'tbar',
    handles: [
      { edge: 'right', token: 'tbar-width', label: '宽度', factor: 1, min: 240, max: 1600 },
      { edge: 'bottom', token: 'tbar-height', label: '高度', factor: 1, min: 24, max: 72 }
    ]
  },
  'tbar-close': {
    label: '关闭钮',
    group: 'tbar',
    handles: [
      { edge: 'right', token: 'tbar-ctl-size', label: '控制钮尺寸', factor: 1, min: 8, max: 32 }
    ]
  },
  stat: {
    label: '状态栏',
    group: 'stat',
    handles: [
      { edge: 'right', token: 'stat-width', label: '宽度', factor: 1, min: 240, max: 1600 },
      { edge: 'bottom', token: 'stat-height', label: '高度', factor: 1, min: 16, max: 64 }
    ]
  },
  spl: {
    label: '分栏条',
    group: 'spl',
    handles: [
      { edge: 'right', token: 'spl-width', label: '条宽', factor: 1, min: 2, max: 24 },
      { edge: 'bottom', token: 'spl-length', label: '条长', factor: 1, min: 24, max: 640 }
    ]
  },
  pnav: {
    label: '手机导航栏',
    group: 'pnav',
    handles: [
      { edge: 'right', token: 'pnav-width', label: '宽度', factor: 1, min: 240, max: 720 },
      { edge: 'bottom', token: 'pnav-height', label: '高度', factor: 1, min: 32, max: 96 }
    ]
  },
  'pnav-back': {
    label: '返回钮',
    group: 'pnav',
    handles: [
      { edge: 'right', token: 'pnav-back-size', label: '钮尺寸', factor: 1, min: 24, max: 64 }
    ]
  },
  swr: {
    label: '滑动操作行',
    group: 'swr',
    handles: [
      { edge: 'right', token: 'swr-width', label: '行宽', factor: 1, min: 200, max: 560 },
      { edge: 'bottom', token: 'swr-height', label: '行高', factor: 1, min: 40, max: 120 }
    ]
  },
  ptr: {
    label: '下拉刷新',
    group: 'ptr',
    handles: [
      { edge: 'right', token: 'ptr-width', label: '宽度', factor: 1, min: 200, max: 560 },
      { edge: 'bottom', token: 'ptr-padding-y', label: '上下内边距', factor: 0.5, min: 0, max: 48 }
    ]
  },
  'ptr-ic': {
    label: '刷新图标位',
    group: 'ptr',
    handles: [
      { edge: 'right', token: 'ptr-icon-size', label: '图标位', factor: 1, min: 24, max: 64 }
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
