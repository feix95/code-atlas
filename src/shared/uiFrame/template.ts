// M0 默认模板(§9、§19):数值沿用 2026-10-02 手工实测的规格包(§23.1),
// 以便功能导出的包与实测对照答案逐项比对。
// 三层变量(§6.1):基础变量写死数值;组件变量与页面变量默认引用基础变量。
import type { TokenDef, TokenMap, TokenTier, TokenValue, UiFrameDoc } from './types.ts'
import { DEFAULT_ROOT_PX } from './units.ts'

type Entry = [group: string, name: string, label: string, value: TokenValue]

const px = (v: number): TokenValue => ({ kind: 'dimension', px: v })
const ref = (r: string): TokenValue => ({ kind: 'ref', ref: r })
const num = (v: number): TokenValue => ({ kind: 'number', value: v })
const weight = (v: number): TokenValue => ({ kind: 'fontWeight', value: v })
const color = (light: string, dark: string): TokenValue => ({ kind: 'color', light, dark })

const BASE: Entry[] = [
  ['color', 'bg', '页面背景', color('#FAFAF9', '#0C0A09')],
  ['color', 'surface', '表面', color('#FFFFFF', '#1C1917')],
  ['color', 'text', '主文字', color('#1C1917', '#FAFAF9')],
  ['color', 'text-secondary', '次要文字', color('#57534E', '#A8A29E')],
  ['color', 'border', '边框', color('#E7E5E4', '#292524')],
  ['color', 'border-strong', '强边框', color('#D6D3D1', '#44403C')],
  ['color', 'primary', '主色', color('#2563EB', '#60A5FA')],
  ['color', 'primary-hover', '主色 · 悬停', color('#1D4ED8', '#93C5FD')],
  ['color', 'primary-active', '主色 · 按下', color('#1E40AF', '#BFDBFE')],
  ['color', 'on-primary', '主色上的文字', color('#FFFFFF', '#0C0A09')],
  ['color', 'primary-subtle', '主色浅底', color('#EFF6FF', '#172554')],
  ['color', 'hover-bg', '悬停底', color('#F5F5F4', '#292524')],
  ['color', 'pressed-bg', '按下底', color('#E7E5E4', '#44403C')],
  ['color', 'focus', '焦点环', color('#2563EB', '#60A5FA')],
  [
    'font',
    'family',
    '界面字体',
    { kind: 'fontFamily', families: ['Inter Variable', 'Noto Sans SC Variable', 'sans-serif'] }
  ],
  ['font-size', 'sm', '字号 · 小', px(13)],
  ['font-size', 'md', '字号 · 中', px(14)],
  ['font-size', 'lg', '字号 · 大', px(16)],
  ['font-size', 'xl', '字号 · 特大', px(18)],
  ['font-size', '5xl', '字号 · 标题', px(48)],
  ['font-weight', 'regular', '字重 · 常规', weight(400)],
  ['font-weight', 'medium', '字重 · 中', weight(500)],
  ['font-weight', 'semibold', '字重 · 半粗', weight(600)],
  ['font-weight', 'bold', '字重 · 粗', weight(700)],
  ['line-height', 'tight', '行高 · 紧', num(1.25)],
  ['line-height', 'normal', '行高 · 常规', num(1.5)],
  ['line-height', 'relaxed', '行高 · 宽松', num(1.75)],
  ['space', '1', '间距 1', px(4)],
  ['space', '2', '间距 2', px(8)],
  ['space', '3', '间距 3', px(12)],
  ['space', '4', '间距 4', px(16)],
  ['space', '6', '间距 6', px(24)],
  ['space', '8', '间距 8', px(32)],
  ['space', '10', '间距 10', px(40)],
  ['space', '16', '间距 16', px(64)],
  ['space', '24', '间距 24', px(96)],
  ['radius', 'md', '圆角 · 中', px(8)],
  ['radius', 'lg', '圆角 · 大', px(12)],
  ['control', 'sm', '控件高 · 小', px(32)],
  ['control', 'md', '控件高 · 中', px(40)],
  ['control', 'lg', '控件高 · 大', px(48)],
  ['icon', 'sm', '图标 · 小', px(16)],
  ['icon', 'md', '图标 · 中', px(20)],
  ['icon', 'lg', '图标 · 大', px(24)],
  ['icon', 'stroke', '图标线宽', num(2)],
  ['border-width', '1', '描边宽度', px(1)],
  ['focus-ring', 'width', '焦点环宽度', px(2)],
  ['focus-ring', 'offset', '焦点环外距', px(2)],
  ['opacity', 'disabled', '禁用透明度', num(0.4)],
  [
    'shadow',
    'sm',
    '阴影 · 小',
    {
      kind: 'shadow',
      x: 0,
      y: 1,
      blur: 2,
      spread: 0,
      light: 'rgba(28, 25, 23, 0.06)',
      dark: 'rgba(0, 0, 0, 0.4)'
    }
  ],
  [
    'shadow',
    'md',
    '阴影 · 中',
    {
      kind: 'shadow',
      x: 0,
      y: 4,
      blur: 12,
      spread: 0,
      light: 'rgba(28, 25, 23, 0.08)',
      dark: 'rgba(0, 0, 0, 0.5)'
    }
  ]
]

const COMPONENT: Entry[] = [
  ['btn', 'height-sm', '高度 · 小', ref('control-sm')],
  ['btn', 'height-md', '高度 · 中', ref('control-md')],
  ['btn', 'height-lg', '高度 · 大', ref('control-lg')],
  ['btn', 'padding-x-sm', '左右内边距 · 小', ref('space-3')],
  ['btn', 'padding-x-md', '左右内边距 · 中', ref('space-4')],
  ['btn', 'padding-x-lg', '左右内边距 · 大', ref('space-6')],
  ['btn', 'font-size-sm', '字号 · 小', ref('font-size-sm')],
  ['btn', 'font-size-md', '字号 · 中', ref('font-size-md')],
  ['btn', 'font-size-lg', '字号 · 大', ref('font-size-lg')],
  ['btn', 'font-weight', '字重', ref('font-weight-medium')],
  ['btn', 'line-height', '行高', ref('line-height-tight')],
  ['btn', 'radius', '圆角', ref('radius-md')],
  ['btn', 'gap', '图标与文字间距', ref('space-2')],
  ['btn', 'icon-size', '图标尺寸', ref('icon-md')],
  ['btn', 'border-width', '描边宽度', ref('border-width-1')],
  ['card', 'padding', '内边距', ref('space-6')],
  ['card', 'radius', '圆角', ref('radius-lg')],
  ['card', 'border-width', '描边宽度', ref('border-width-1')],
  ['card', 'shadow', '阴影', ref('shadow-sm')],
  ['card', 'icon-box', '图标底块尺寸', ref('space-10')],
  ['card', 'icon-radius', '图标底块圆角', ref('radius-md')],
  ['card', 'icon-size', '图标尺寸', ref('icon-md')],
  ['card', 'icon-gap', '图标底块下间距', ref('space-4')],
  ['card', 'title-size', '标题字号', ref('font-size-xl')],
  ['card', 'title-weight', '标题字重', ref('font-weight-semibold')],
  ['card', 'title-line-height', '标题行高', ref('line-height-tight')],
  ['card', 'title-gap', '标题下间距', ref('space-2')],
  ['card', 'text-size', '说明字号', ref('font-size-md')],
  ['card', 'text-line-height', '说明行高', ref('line-height-normal')]
]

const PAGE: Entry[] = [
  ['page', 'header-height', '顶栏高度', px(64)],
  ['page', 'gutter', '页面左右留白', ref('space-8')],
  ['page', 'logo-size', 'logo 字号', ref('font-size-xl')],
  ['page', 'nav-gap', '导航项间距', ref('space-8')],
  ['page', 'actions-gap', '顶栏按钮间距', ref('space-3')],
  ['page', 'hero-pad-top', '首屏上留白', ref('space-24')],
  ['page', 'hero-pad-bottom', '首屏下留白', ref('space-16')],
  ['page', 'hero-title-max', '标题最大宽度', px(640)],
  ['page', 'hero-title-size', '标题字号', ref('font-size-5xl')],
  ['page', 'hero-title-tracking', '标题字间距', { kind: 'em', value: -0.02 }],
  ['page', 'hero-text-gap', '标题与段落间距', ref('space-6')],
  ['page', 'hero-text-max', '段落最大宽度', px(576)],
  ['page', 'hero-text-size', '段落字号', ref('font-size-xl')],
  ['page', 'hero-actions-gap', '段落与按钮间距', ref('space-10')],
  ['page', 'hero-actions-spacing', '首屏按钮间距', ref('space-4')],
  ['page', 'content-max', '内容区最大宽度', px(1120)],
  ['page', 'features-columns', '卡片列数', num(3)],
  ['page', 'features-gap', '卡片间距', ref('space-6')],
  ['page', 'features-pad-bottom', '卡片区下留白', ref('space-24')],
  ['page', 'footer-pad', '页脚内边距', ref('space-8')],
  ['page', 'footer-text-size', '页脚字号', ref('font-size-md')]
]

function build(entries: Entry[], tier: TokenTier, into: TokenMap): void {
  for (const [group, name, label, value] of entries) {
    const def: TokenDef = { path: [group, name], label, tier, value }
    into[`${group}-${name}`] = def
  }
}

/** 默认变量表的全新副本(调用方可随意改写) */
export function defaultTokens(): TokenMap {
  const tokens: TokenMap = {}
  build(BASE, 'base', tokens)
  build(COMPONENT, 'component', tokens)
  build(PAGE, 'page', tokens)
  return tokens
}

export function defaultDoc(): UiFrameDoc {
  return {
    schemaVersion: 1,
    name: '落地页示例',
    platform: 'desktop',
    rootFontPx: DEFAULT_ROOT_PX,
    tokens: defaultTokens(),
    icons: {
      'demo-button': 'arrow-right',
      'demo-card': 'timer',
      'hero-cta': 'arrow-right',
      'feature-1': 'timer',
      'feature-2': 'music',
      'feature-3': 'dumbbell'
    }
  }
}
