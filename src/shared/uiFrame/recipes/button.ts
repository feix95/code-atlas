// 按钮配方:实心 / 描边 / 幽灵 × 小中大 × 默认/悬停/按下/焦点/禁用。
// 变体维度见 §7.4;状态表同时生成真实伪类与演示 class。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe,
  type CssRule
} from './kit.ts'

const SIZES: Array<['sm' | 'lg', string]> = [
  ['sm', '.btn--sm'],
  ['lg', '.btn--lg']
]

const VARIANTS: Array<[string, string]> = [
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

export const BUTTON: ComponentRecipe = {
  id: 'button',
  label: '按钮',
  group: 'btn',
  stateNames: ['默认', '悬停', '按下', '焦点', '禁用'],
  rules: [
    {
      sel: '.btn',
      decls: [
        ['box-sizing', 'border-box'],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['gap', v('btn-gap')],
        ['height', v('btn-height-md')],
        ['margin', '0'],
        ['padding', `0 ${v('btn-padding-x-md')}`],
        ['font-family', v('font-family')],
        ['font-size', v('btn-font-size-md')],
        ['font-weight', v('btn-font-weight')],
        ['line-height', v('btn-line-height')],
        ['letter-spacing', '0'],
        ['text-align', 'center'],
        ['border', `${v('btn-border-width')} solid transparent`],
        ['border-radius', v('btn-radius')],
        ['background', 'transparent'],
        ['color', v('color-text')],
        ['cursor', 'pointer'],
        ['white-space', 'nowrap'],
        ['text-decoration', 'none']
      ]
    },
    {
      sel: '.btn svg',
      decls: [
        ['display', 'block'],
        ['flex', 'none'],
        ['width', v('btn-icon-size')],
        ['height', v('btn-icon-size')],
        ['stroke-width', v('icon-stroke')]
      ]
    },
    ...SIZES.map(([size, sel]): CssRule => ({
      sel,
      decls: [
        ['height', v(`btn-height-${size}`)],
        ['padding', `0 ${v(`btn-padding-x-${size}`)}`],
        ['font-size', v(`btn-font-size-${size}`)]
      ]
    })),
    {
      sel: '.btn--solid',
      decls: [
        ['background', v('color-primary')],
        ['color', v('color-on-primary')]
      ]
    },
    { sel: '.btn--outline', decls: [['border-color', v('color-border-strong')]] },
    {
      sel: '.btn:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    { base: '.btn--solid', state: 'hover', decls: [['background', v('color-primary-hover')]] },
    { base: '.btn--solid', state: 'active', decls: [['background', v('color-primary-active')]] },
    { base: '.btn--outline', state: 'hover', decls: [['background', v('color-hover-bg')]] },
    { base: '.btn--outline', state: 'active', decls: [['background', v('color-pressed-bg')]] },
    { base: '.btn--ghost', state: 'hover', decls: [['background', v('color-hover-bg')]] },
    { base: '.btn--ghost', state: 'active', decls: [['background', v('color-pressed-bg')]] },
    {
      base: '.btn',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const btn = (cls: string, text: string, part: string, disabled = false): PageNode => {
      const attrs: Record<string, string> = { type: 'button' }
      if (disabled) attrs['disabled'] = ''
      return { tag: 'button', cls, attrs, text, part }
    }
    const variantRows = VARIANTS.map(([variant, name]) =>
      demoRow([
        demoLabel(name),
        ...STATES.map(([state, stateLabel, disabled]) =>
          btn(`btn btn--${variant}${state ? ` ${state}` : ''}`, stateLabel, 'btn-md', disabled)
        )
      ])
    )
    const sizeRow = demoRow([
      demoLabel('尺寸'),
      btn('btn btn--solid btn--sm', '小', 'btn-sm'),
      btn('btn btn--solid', '中', 'btn-md'),
      btn('btn btn--solid btn--lg', '大', 'btn-lg')
    ])
    const iconRow = demoRow([
      demoLabel('带图标'),
      {
        ...btn('btn btn--solid btn--lg', '免费开始', 'btn-lg'),
        icon: 'demo-button',
        iconAt: 'end'
      },
      { ...btn('btn btn--outline', '继续', 'btn-md'), icon: 'demo-button', iconAt: 'end' }
    ])
    return demoSection(theme, '按钮', [...variantRows, sizeRow, iconRow])
  }
}
