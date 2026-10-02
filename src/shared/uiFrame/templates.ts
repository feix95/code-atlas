// 首批模板(§9.2):模板 = 平台 + 风格预设 + 全套变量。
// 实现方式:在默认变量表上叠加每套模板的覆盖值;组件变体差异经「组件级自定义属性」
// 传回变量名(如按钮圆角改成全圆),不写死数值,导出的包同样零写死。
import { defaultDoc } from './template.ts'
import type { TokenValue, UiFrameDoc, UiPlatform } from './types.ts'

const px = (v: number): TokenValue => ({ kind: 'dimension', px: v })
const ref = (r: string): TokenValue => ({ kind: 'ref', ref: r })
const color = (light: string, dark: string): TokenValue => ({ kind: 'color', light, dark })

export interface TemplateMeta {
  id: string
  name: string
  platform: UiPlatform
  /** 风格预设名(§8) */
  style: string
  blurb: string
}

/** §9.2 首批 4 个模板 + 空白起步(blank 不在表里,起步页单独画) */
export const TEMPLATES: TemplateMeta[] = [
  {
    id: 'minimal-desk',
    name: '极简工作台',
    platform: 'desktop',
    style: '极简中性',
    blurb: '灰阶结构、细描边、小圆角;工具类应用与桌面软件的中性起点'
  },
  {
    id: 'modern-desk',
    name: '现代仪表盘',
    platform: 'desktop',
    style: '现代简洁',
    blurb: '白底、细边框、克制主色;数据后台与 SaaS 的常见观感'
  },
  {
    id: 'tint-phone',
    name: '色调圆角',
    platform: 'phone',
    style: '色调圆角',
    blurb: '主色派生色调、胶囊形控件、柔和对比;手机应用路线'
  },
  {
    id: 'airy-phone',
    name: '留白清透',
    platform: 'phone',
    style: '留白清透',
    blurb: '大留白、细边框、浅底色;清爽路线的手机界面'
  }
]

export const BLANK_ID = 'blank'

/** 各模板对默认变量表的覆盖(键 = CSS 变量名,不含 --) */
const OVERRIDES: Record<string, Record<string, TokenValue>> = {
  'minimal-desk': {},
  'modern-desk': {
    'color-bg': color('#FFFFFF', '#09090B'),
    'color-surface': color('#FFFFFF', '#18181B'),
    'color-text': color('#18181B', '#FAFAFA'),
    'color-text-secondary': color('#71717A', '#A1A1AA'),
    'color-border': color('#E4E4E7', '#27272A'),
    'color-border-strong': color('#D4D4D8', '#3F3F46'),
    'color-primary': color('#18181B', '#FAFAFA'),
    'color-primary-hover': color('#3F3F46', '#E4E4E7'),
    'color-primary-active': color('#27272A', '#D4D4D8'),
    'color-on-primary': color('#FAFAFA', '#18181B'),
    'color-primary-subtle': color('#F4F4F5', '#27272A'),
    'color-hover-bg': color('#F4F4F5', '#27272A'),
    'color-pressed-bg': color('#E4E4E7', '#3F3F46'),
    'color-focus': color('#18181B', '#A1A1AA'),
    'control-md': px(36),
    'font-size-md': px(14),
    'radius-md': px(6)
  },
  'tint-phone': {
    'color-bg': color('#FEF7FF', '#141218'),
    'color-surface': color('#FFFBFE', '#211F26'),
    'color-text': color('#1D1B20', '#E6E0E9'),
    'color-text-secondary': color('#49454F', '#CAC4D0'),
    'color-border': color('#CAC4D0', '#49454F'),
    'color-border-strong': color('#79747E', '#938F99'),
    'color-primary': color('#6750A4', '#D0BCFF'),
    'color-primary-hover': color('#5B42A0', '#B69DF8'),
    'color-primary-active': color('#4F378B', '#B69DF8'),
    'color-on-primary': color('#FFFFFF', '#381E72'),
    'color-primary-subtle': color('#EADDFF', '#4F378B'),
    'color-hover-bg': color('#F3EDF7', '#2B2930'),
    'color-pressed-bg': color('#E8DEF8', '#36343B'),
    'color-focus': color('#6750A4', '#D0BCFF'),
    'radius-sm': px(8),
    'radius-md': px(12),
    'radius-lg': px(16),
    'btn-radius': ref('radius-full'),
    'ibtn-radius': ref('radius-full'),
    'chk-radius': px(2),
    'ipt-radius': px(4),
    'card-radius': px(12),
    'tab-seg-radius': ref('radius-full'),
    'tab-seg-outer-radius': ref('radius-full'),
    'tip-radius': px(4),
    'li-avatar': px(40)
  },
  'airy-phone': {
    'color-bg': color('#F2F2F7', '#000000'),
    'color-surface': color('#FFFFFF', '#1C1C1E'),
    'color-text': color('#1C1C1E', '#F2F2F7'),
    'color-text-secondary': color('#6C6C70', '#8E8E93'),
    'color-border': color('#C6C6C8', '#38383A'),
    'color-border-strong': color('#AEAEB2', '#545458'),
    'color-primary': color('#007AFF', '#0A84FF'),
    'color-primary-hover': color('#0066D6', '#409CFF'),
    'color-primary-active': color('#0056B8', '#66B2FF'),
    'color-on-primary': color('#FFFFFF', '#FFFFFF'),
    'color-primary-subtle': color('#EAF3FF', '#16324F'),
    'color-hover-bg': color('#F2F2F7', '#2C2C2E'),
    'color-pressed-bg': color('#E5E5EA', '#3A3A3C'),
    'color-focus': color('#007AFF', '#0A84FF'),
    'control-md': px(44),
    'font-size-sm': px(13),
    'font-size-md': px(15),
    'font-size-lg': px(17),
    'radius-sm': px(8),
    'radius-md': px(10),
    'radius-lg': px(14),
    'tip-radius': px(8)
  }
}

/** 由模板生成方案:默认变量表 + 该模板覆盖值;空白起步 = 默认表 + 名字 */
export function templateDoc(id: string, platform?: UiPlatform): UiFrameDoc {
  const meta = TEMPLATES.find((t) => t.id === id)
  const doc = defaultDoc()
  doc.name = meta ? `${meta.name}方案` : '未命名方案'
  doc.template = id
  doc.platform = meta ? meta.platform : (platform ?? 'desktop')
  const over = meta ? (OVERRIDES[meta.id] ?? {}) : {}
  for (const [name, value] of Object.entries(over)) {
    const def = doc.tokens[name]
    if (def) doc.tokens[name] = { ...def, value }
  }
  return doc
}
