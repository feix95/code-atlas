// 图标按钮配方:正方形按钮、内容只有图标;实心 / 描边 / 幽灵 × 小中大 × 五态。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

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

export const ICON_BUTTON: ComponentRecipe = {
  id: 'icon-button',
  label: '图标按钮',
  group: 'ibtn',
  stateNames: ['默认', '悬停', '按下', '焦点', '禁用'],
  rules: [
    {
      sel: '.ibtn',
      decls: [
        ['box-sizing', 'border-box'],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('ibtn-size-md')],
        ['height', v('ibtn-size-md')],
        ['margin', '0'],
        ['padding', '0'],
        ['border', `${v('ibtn-border-width')} solid transparent`],
        ['border-radius', v('ibtn-radius')],
        ['background', 'transparent'],
        ['color', v('color-text-secondary')],
        ['cursor', 'pointer'],
        ['vertical-align', 'middle']
      ]
    },
    {
      sel: '.ibtn svg',
      decls: [
        ['display', 'block'],
        ['width', v('ibtn-icon-size')],
        ['height', v('ibtn-icon-size')],
        ['stroke-width', v('icon-stroke')]
      ]
    },
    {
      sel: '.ibtn--sm',
      decls: [
        ['width', v('ibtn-size-sm')],
        ['height', v('ibtn-size-sm')]
      ]
    },
    {
      sel: '.ibtn--lg',
      decls: [
        ['width', v('ibtn-size-lg')],
        ['height', v('ibtn-size-lg')]
      ]
    },
    {
      sel: '.ibtn--solid',
      decls: [
        ['background', v('color-primary')],
        ['color', v('color-on-primary')]
      ]
    },
    {
      sel: '.ibtn--outline',
      decls: [
        ['border-color', v('color-border-strong')],
        ['color', v('color-text')]
      ]
    },
    {
      sel: '.ibtn:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    { base: '.ibtn--solid', state: 'hover', decls: [['background', v('color-primary-hover')]] },
    { base: '.ibtn--solid', state: 'active', decls: [['background', v('color-primary-active')]] },
    { base: '.ibtn--outline', state: 'hover', decls: [['background', v('color-hover-bg')]] },
    { base: '.ibtn--outline', state: 'active', decls: [['background', v('color-pressed-bg')]] },
    { base: '.ibtn--ghost', state: 'hover', decls: [['background', v('color-hover-bg')]] },
    { base: '.ibtn--ghost', state: 'active', decls: [['background', v('color-pressed-bg')]] },
    {
      base: '.ibtn',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const ibtn = (cls: string, part: string, disabled = false): PageNode => {
      const attrs: Record<string, string> = { type: 'button', 'aria-label': '图标按钮' }
      if (disabled) attrs['disabled'] = ''
      return { tag: 'button', cls, attrs, icon: 'demo-ibtn', part }
    }
    const variantRows = VARIANTS.map(([variant, name]) =>
      demoRow([
        demoLabel(name),
        ...STATES.map(([state, , disabled]) =>
          ibtn(`ibtn ibtn--${variant}${state ? ` ${state}` : ''}`, 'ibtn', disabled)
        )
      ])
    )
    const sizeRow = demoRow([
      demoLabel('尺寸'),
      ibtn('ibtn ibtn--solid ibtn--sm', 'ibtn-sm'),
      ibtn('ibtn ibtn--solid', 'ibtn'),
      ibtn('ibtn ibtn--solid ibtn--lg', 'ibtn-lg')
    ])
    return demoSection(theme, '图标按钮', [...variantRows, sizeRow])
  }
}
