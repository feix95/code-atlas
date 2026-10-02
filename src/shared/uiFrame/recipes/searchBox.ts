// 搜索框配方:<label class="srch"><span class="srch__ic"></span><input class="srch__in"></label>
// 输入框的胶囊变体:全圆角 + 前置搜索图标。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const srch = (cls: string, disabled = false, part = 'srch'): PageNode => ({
  tag: 'label',
  cls: `srch${cls ? ` ${cls}` : ''}`,
  part,
  children: [
    { tag: 'span', cls: 'srch__ic', part: 'srch-ic', icon: 'demo-search' },
    {
      tag: 'input',
      cls: 'srch__in',
      attrs: { type: 'search', placeholder: '搜索…', ...(disabled ? { disabled: '' } : {}) }
    }
  ]
})

export const SEARCH: ComponentRecipe = {
  id: 'search',
  label: '搜索框',
  group: 'srch',
  stateNames: ['默认', '悬停', '焦点', '禁用'],
  // 输入框容器,焦点落在内部 input 上;:active 不作要求
  requiredStates: [':hover', ':focus-visible', ':disabled'],
  rules: [
    {
      sel: '.srch',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('srch-gap')],
        ['width', v('srch-width')],
        ['height', v('srch-height')],
        ['padding', `0 ${v('srch-padding-x')}`],
        ['border', `${v('srch-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('srch-radius')],
        ['background', v('color-surface')],
        ['box-sizing', 'border-box'],
        ['cursor', 'text']
      ]
    },
    {
      sel: '.srch__ic',
      decls: [
        ['width', v('srch-icon-size')],
        ['height', v('srch-icon-size')],
        ['color', v('color-text-secondary')],
        ['flex-shrink', '0']
      ]
    },
    {
      sel: '.srch__in',
      decls: [
        ['flex', 'auto'],
        ['min-width', '0'],
        ['border', 'none'],
        ['outline', 'none'],
        ['background', 'transparent'],
        ['color', v('color-text')],
        ['font-size', v('srch-font-size')],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.srch__in::placeholder',
      decls: [['color', v('color-text-secondary')]]
    },
    {
      sel: '.srch:has(.srch__in:disabled)',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    {
      base: '.srch',
      state: 'hover',
      real: ':hover:not(:has(.srch__in:disabled))',
      decls: [['border-color', v('color-border-strong')]]
    },
    {
      base: '.srch',
      state: 'focus',
      real: ':has(.srch__in:focus-visible), .srch:focus-within',
      decls: [
        ['border-color', v('color-primary')],
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const row = demoRow([
      demoLabel('胶囊'),
      srch(''),
      srch(DEMO_STATE_CLASS.hover),
      srch(DEMO_STATE_CLASS.focus),
      srch('', true)
    ])
    return demoSection(theme, '搜索框', [row])
  }
}
