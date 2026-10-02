// 组件演示页(components/<组件>.html 与画布「组件墙」共用):全部变体 × 状态 × 亮暗。
// 演示专用的排版与状态模拟 class 只进 _demo.css(§13.2 规则 12)。
import { BUTTON, CARD, DEMO_STATE_CLASS, demoStateRules, type CssRule } from './recipes.ts'
import type { PageNode, ThemeName } from './types.ts'

const v = (name: string): string => `var(--${name})`

const THEME_LABEL: Record<ThemeName, string> = { light: '亮色', dark: '暗色' }

const VARIANTS: Array<[variant: string, label: string]> = [
  ['solid', '实心'],
  ['outline', '描边'],
  ['ghost', '幽灵']
]

const STATES: Array<[cls: string, label: string, disabled: boolean]> = [
  ['', '默认', false],
  [DEMO_STATE_CLASS.hover, '悬停', false],
  [DEMO_STATE_CLASS.active, '按下', false],
  [DEMO_STATE_CLASS.focus, '焦点', false],
  ['', '禁用', true]
]

const label = (text: string): PageNode => ({ tag: 'span', cls: 'demo-label', text })
const row = (children: PageNode[]): PageNode => ({ tag: 'div', cls: 'demo-row', children })

function demoButton(cls: string, text: string, part: string, disabled = false): PageNode {
  const attrs: Record<string, string> = { type: 'button' }
  if (disabled) attrs['disabled'] = ''
  return { tag: 'button', cls, attrs, text, part }
}

function buttonSection(theme: ThemeName): PageNode {
  const variantRows = VARIANTS.map(([variant, name]) =>
    row([
      label(name),
      ...STATES.map(([state, stateLabel, disabled]) =>
        demoButton(`btn btn--${variant}${state ? ` ${state}` : ''}`, stateLabel, 'btn-md', disabled)
      )
    ])
  )
  const sizeRow = row([
    label('尺寸'),
    demoButton('btn btn--solid btn--sm', '小', 'btn-sm'),
    demoButton('btn btn--solid', '中', 'btn-md'),
    demoButton('btn btn--solid btn--lg', '大', 'btn-lg')
  ])
  const iconRow = row([
    label('带图标'),
    {
      ...demoButton('btn btn--solid btn--lg', '免费开始', 'btn-lg'),
      icon: 'demo-button',
      iconAt: 'end'
    },
    { ...demoButton('btn btn--outline', '继续', 'btn-md'), icon: 'demo-button', iconAt: 'end' }
  ])
  return section(theme, '按钮', [...variantRows, sizeRow, iconRow])
}

function cardSection(theme: ThemeName): PageNode {
  const card: PageNode = {
    tag: 'div',
    cls: 'card',
    part: 'card',
    children: [
      { tag: 'div', cls: 'card__icon', icon: 'demo-card', part: 'card-icon-box' },
      { tag: 'h3', cls: 'card__title', text: '卡片标题' },
      { tag: 'p', cls: 'card__text', text: '卡片说明文字,用于展示正文字号与行高。' }
    ]
  }
  return section(theme, '卡片', [{ tag: 'div', cls: 'demo-cards', children: [card] }])
}

function section(theme: ThemeName, title: string, children: PageNode[]): PageNode {
  return {
    tag: 'section',
    cls: 'demo',
    attrs: { 'data-theme': theme },
    children: [
      { tag: 'h2', cls: 'demo-title', text: `${title} · ${THEME_LABEL[theme]}` },
      ...children
    ]
  }
}

const THEMES: ThemeName[] = ['light', 'dark']

export const DEMOS: Record<'button' | 'card', () => PageNode[]> = {
  button: () => THEMES.map(buttonSection),
  card: () => THEMES.map(cardSection)
}

/** 画布「组件墙」:按钮 + 卡片同屏 */
export function wallBody(): PageNode[] {
  return [...DEMOS.button(), ...DEMOS.card()]
}

/** _demo.css 正文:演示排版 + 状态模拟 */
export function demoRules(): CssRule[] {
  return [
    {
      sel: '.demo',
      decls: [
        ['padding', v('space-6')],
        ['background', v('color-bg')],
        ['color', v('color-text')],
        ['font-family', v('font-family')]
      ]
    },
    {
      sel: '.demo-title',
      decls: [
        ['margin', `0 0 ${v('space-4')}`],
        ['font-size', v('font-size-md')],
        ['font-weight', v('font-weight-semibold')],
        ['line-height', v('line-height-normal')]
      ]
    },
    {
      sel: '.demo-row',
      decls: [
        ['display', 'flex'],
        ['flex-wrap', 'wrap'],
        ['align-items', 'center'],
        ['gap', v('space-4')],
        ['margin', `0 0 ${v('space-4')}`]
      ]
    },
    {
      sel: '.demo-label',
      decls: [
        ['width', v('space-16')],
        ['font-size', v('font-size-sm')],
        ['line-height', v('line-height-normal')],
        ['color', v('color-text-secondary')]
      ]
    },
    {
      sel: '.demo-cards',
      decls: [
        ['display', 'grid'],
        ['grid-template-columns', `repeat(${v('page-features-columns')}, minmax(0, 1fr))`],
        ['gap', v('page-features-gap')],
        ['max-width', v('page-content-max')]
      ]
    },
    ...demoStateRules(BUTTON),
    ...demoStateRules(CARD)
  ]
}
