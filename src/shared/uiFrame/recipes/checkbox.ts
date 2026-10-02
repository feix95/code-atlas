// 复选框配方:<label class="chk"><input class="chk__in"><span class="chk__box"><svg/></span></label>
// 勾选态走真实 checked 属性;勾号内联 lucide check 图标原文(与图标系统同源)。
// 形状变体(方角 / 圆角 / 圆形)与尺寸档(小 / 中)通过组件级自定义属性改绑变量。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const STATES: Array<[cls: string, label: string, on: boolean, disabled: boolean]> = [
  ['', '默认', false, false],
  ['', '勾选', true, false],
  [DEMO_STATE_CLASS.hover, '悬停', false, false],
  [DEMO_STATE_CLASS.focus, '焦点', true, false],
  ['', '禁用', true, true]
]

export const CHECKBOX: ComponentRecipe = {
  id: 'checkbox',
  label: '复选框',
  group: 'chk',
  stateNames: ['默认', '勾选', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.chk',
      decls: [
        ['--chk-size', v('chk-size-md')],
        ['--chk-radius', v('chk-radius')],
        ['--chk-mark', v('chk-mark-md')],
        ['box-sizing', 'border-box'],
        ['position', 'relative'],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['width', v('chk-size')],
        ['height', v('chk-size')],
        ['margin', '0'],
        ['padding', '0'],
        ['cursor', 'pointer'],
        ['vertical-align', 'middle']
      ]
    },
    {
      sel: '.chk__in',
      decls: [
        ['position', 'absolute'],
        ['inset', '0'],
        ['margin', '0'],
        ['opacity', '0'],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.chk__box',
      decls: [
        ['box-sizing', 'border-box'],
        ['display', 'flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('chk-size')],
        ['height', v('chk-size')],
        ['border', `${v('chk-border-width')} solid ${v('color-border-strong')}`],
        ['border-radius', v('chk-radius')],
        ['background', v('color-surface')],
        ['color', v('color-on-primary')]
      ]
    },
    {
      sel: '.chk__box svg',
      decls: [
        ['display', 'block'],
        ['width', v('chk-mark')],
        ['height', v('chk-mark')],
        ['stroke-width', v('chk-mark-stroke')],
        ['visibility', 'hidden']
      ]
    },
    {
      sel: '.chk--sm',
      decls: [
        ['--chk-size', v('chk-size-sm')],
        ['--chk-mark', v('chk-mark-sm')]
      ]
    },
    {
      sel: '.chk--square',
      decls: [['--chk-radius', v('radius-none')]]
    },
    {
      sel: '.chk--circle',
      decls: [['--chk-radius', v('radius-full')]]
    },
    {
      sel: '.chk:has(.chk__in:checked) .chk__box',
      decls: [
        ['background', v('color-primary')],
        ['border-color', v('color-primary')]
      ]
    },
    {
      sel: '.chk__in:checked + .chk__box svg',
      decls: [['visibility', 'visible']]
    },
    {
      sel: '.chk:has(.chk__in:disabled)',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    },
    {
      sel: '.chk:has(.chk__in:disabled) .chk__in',
      decls: [['cursor', 'not-allowed']]
    }
  ],
  states: [
    {
      base: '.chk',
      state: 'hover',
      real: ':hover:not(:has(.chk__in:disabled))',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.chk__box',
      state: 'hover',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.chk',
      state: 'active',
      real: ':active:not(:has(.chk__in:disabled))',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.chk__box',
      state: 'active',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.chk',
      state: 'focus',
      real: ':has(.chk__in:focus-visible)',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const chk = (cls: string, on: boolean, disabled: boolean): PageNode => {
      const input: PageNode = { tag: 'input', cls: 'chk__in', attrs: { type: 'checkbox' } }
      if (on) input.attrs!['checked'] = ''
      if (disabled) input.attrs!['disabled'] = ''
      return {
        tag: 'label',
        cls: `chk${cls ? ` ${cls}` : ''}`,
        part: cls.includes('chk--sm') ? 'chk-sm' : 'chk',
        children: [input, { tag: 'span', cls: 'chk__box', icon: 'demo-check' }]
      }
    }
    const round = demoRow([
      demoLabel('圆角'),
      ...STATES.map(([cls, , on, disabled]) => chk(cls, on, disabled))
    ])
    const square = demoRow([
      demoLabel('方角'),
      chk('chk--square', true, false),
      chk('chk--square', false, false)
    ])
    const circle = demoRow([
      demoLabel('圆形'),
      chk('chk--circle', true, false),
      chk('chk--circle', false, false)
    ])
    const sizes = demoRow([demoLabel('尺寸'), chk('chk--sm', true, false), chk('', true, false)])
    return demoSection(theme, '复选框', [round, square, circle, sizes])
  }
}
