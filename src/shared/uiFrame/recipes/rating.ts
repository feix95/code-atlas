// 评分配方:<span class="rate"><button class="rate__star is-on">★</button>…</span>
// 静态展示用 .is-on 标记已选星;交互态逐个 button 悬停。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const rate = (on: number, cls = '', disabled = false): PageNode => ({
  tag: 'span',
  cls: `rate${cls ? ` ${cls}` : ''}`,
  part: 'rate',
  children: [1, 2, 3, 4, 5].map((i) => ({
    tag: 'button',
    cls: 'rate__star',
    attrs: {
      type: 'button',
      'aria-label': `${i} 星`,
      ...(i <= on ? { 'aria-pressed': 'true' } : {}),
      ...(disabled ? { disabled: '' } : {})
    },
    text: '★'
  }))
})

export const RATING: ComponentRecipe = {
  id: 'rating',
  label: '评分',
  group: 'rate',
  stateNames: ['默认', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.rate',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('rate-gap')]
      ]
    },
    {
      sel: '.rate__star',
      decls: [
        ['width', v('rate-size')],
        ['height', v('rate-size')],
        ['padding', '0'],
        ['border', 'none'],
        ['background', 'transparent'],
        ['color', v('rate-off')],
        ['font-size', v('rate-size')],
        ['line-height', v('line-height-tight')],
        ['cursor', 'pointer'],
        ['text-align', 'center']
      ]
    },
    {
      sel: '.rate__star[aria-pressed="true"]',
      decls: [['color', v('rate-on')]]
    },
    {
      sel: '.rate__star:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    {
      base: '.rate__star',
      state: 'hover',
      decls: [['color', v('color-primary')]]
    },
    {
      base: '.rate__star',
      state: 'active',
      decls: [['color', v('color-primary-active')]]
    },
    {
      base: '.rate__star',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const row = demoRow([
      demoLabel('值'),
      rate(3),
      rate(4, DEMO_STATE_CLASS.hover),
      rate(0),
      rate(3, '', true)
    ])
    return demoSection(theme, '评分', [row])
  }
}
