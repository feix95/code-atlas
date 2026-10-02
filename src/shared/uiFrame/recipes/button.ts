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
  ['tint', '浅底'],
  ['outline', '描边'],
  ['ghost', '幽灵'],
  ['text', '文字']
]

// 语义轴(§7.4):主要走 color-primary,危险走 btn-danger-* 三态
const SEMANTICS: Array<[string, string]> = [
  ['solid', '主要'],
  ['solid btn--danger', '危险']
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
      sel: '.btn--tint',
      decls: [
        ['background', v('color-primary-subtle')],
        ['color', v('color-primary')]
      ]
    },
    {
      sel: '.btn--text',
      decls: [
        ['padding', `0 ${v('space-1')}`],
        ['color', v('color-primary')]
      ]
    },
    // 危险语义(§7.4 语义轴):实心款换危险三色
    {
      sel: '.btn--danger',
      decls: [
        ['background', v('btn-danger-bg')],
        ['color', v('color-on-primary')]
      ]
    },
    // 形状轴:方角 / 胶囊(默认圆角由 --btn-radius 管)
    { sel: '.btn--square', decls: [['border-radius', v('radius-none')]] },
    { sel: '.btn--pill', decls: [['border-radius', v('radius-full')]] },
    // 宽度轴:撑满容器(§7.4 宽度;块级 flex 自动占满一行,flex 爹里再补 stretch)
    {
      sel: '.btn--block',
      decls: [
        ['display', 'flex'],
        ['align-self', 'stretch']
      ]
    },
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
    { base: '.btn--tint', state: 'hover', decls: [['background', v('btn-tint-hover-bg')]] },
    { base: '.btn--tint', state: 'active', decls: [['background', v('btn-tint-hover-bg')]] },
    { base: '.btn--danger', state: 'hover', decls: [['background', v('btn-danger-hover-bg')]] },
    { base: '.btn--danger', state: 'active', decls: [['background', v('btn-danger-active-bg')]] },
    { base: '.btn--text', state: 'hover', decls: [['background', v('color-hover-bg')]] },
    { base: '.btn--text', state: 'active', decls: [['background', v('color-pressed-bg')]] },
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
    // 语义/形状/宽度轴(§7.4):SEMANTICS 复用样式轴的 class 组合
    const semanticRow = demoRow([
      demoLabel('语义'),
      ...SEMANTICS.map(([cls, name]) => btn(`btn btn--${cls}`, name, 'btn-md'))
    ])
    const shapeRow = demoRow([
      demoLabel('形状'),
      btn('btn btn--solid', '圆角', 'btn-md'),
      btn('btn btn--solid btn--square', '方角', 'btn-md'),
      btn('btn btn--solid btn--pill', '胶囊', 'btn-md')
    ])
    const blockRow = demoRow([
      demoLabel('宽度'),
      {
        tag: 'div',
        cls: 'demo-stretch',
        children: [btn('btn btn--solid btn--block', '撑满容器', 'btn-md')]
      }
    ])
    return demoSection(theme, '按钮', [
      ...variantRows,
      semanticRow,
      sizeRow,
      shapeRow,
      iconRow,
      blockRow
    ])
  }
}
