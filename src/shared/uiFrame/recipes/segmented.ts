// 分段控件配方:<div class="seg"><button class="seg__it">…</button></div>
// 选中段用 aria-selected;容器浅底 + 选中段浮起(阴影+表面底)。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const seg = (cls: string, selected: number): PageNode => ({
  tag: 'div',
  cls: `seg${cls ? ` ${cls}` : ''}`,
  part: 'seg',
  children: ['日', '周', '月'].map((text, i) => {
    const it: PageNode = { tag: 'button', cls: 'seg__it', attrs: { type: 'button' }, text }
    if (i === selected) it.attrs!['aria-selected'] = 'true'
    return it
  })
})

export const SEGMENTED: ComponentRecipe = {
  id: 'segmented',
  label: '分段控件',
  group: 'seg',
  stateNames: ['默认', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.seg',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('seg-gap')],
        ['padding', v('seg-pad')],
        ['border-radius', v('seg-outer-radius')],
        ['background', v('seg-bg')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.seg__it',
      decls: [
        ['border', 'none'],
        ['margin', '0'],
        ['padding', `${v('seg-it-padding-y')} ${v('seg-it-padding-x')}`],
        ['border-radius', v('seg-it-radius')],
        ['background', 'transparent'],
        ['color', v('color-text-secondary')],
        ['font-size', v('seg-font-size')],
        ['font-weight', v('font-weight-medium')],
        ['line-height', v('line-height-tight')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.seg__it[aria-selected="true"]',
      decls: [
        ['background', v('color-surface')],
        ['color', v('color-text')],
        ['box-shadow', v('seg-shadow')]
      ]
    },
    {
      sel: '.seg__it:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    {
      base: '.seg__it',
      state: 'hover',
      real: ':hover:not(:disabled):not([aria-selected="true"])',
      decls: [['color', v('color-text')]]
    },
    {
      base: '.seg__it',
      state: 'active',
      real: ':active:not(:disabled)',
      decls: [['background', v('color-pressed-bg')]]
    },
    {
      base: '.seg__it',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const row = demoRow([
      demoLabel('三段'),
      seg('', 1),
      {
        tag: 'div',
        cls: 'seg',
        children: [
          {
            tag: 'button',
            cls: 'seg__it',
            attrs: { type: 'button', 'aria-selected': 'true' },
            text: '列表'
          },
          {
            tag: 'button',
            cls: `seg__it ${DEMO_STATE_CLASS.hover}`,
            attrs: { type: 'button' },
            text: '网格'
          },
          {
            tag: 'button',
            cls: `seg__it ${DEMO_STATE_CLASS.focus}`,
            attrs: { type: 'button' },
            text: '看板'
          }
        ]
      },
      {
        tag: 'div',
        cls: 'seg',
        children: [
          {
            tag: 'button',
            cls: 'seg__it',
            attrs: { type: 'button', disabled: '' },
            text: '禁用'
          },
          { tag: 'button', cls: 'seg__it', attrs: { type: 'button' }, text: '可用' }
        ]
      }
    ])
    return demoSection(theme, '分段控件', [row])
  }
}
