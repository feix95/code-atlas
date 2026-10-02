// 链接配方:<a class="lnk" href="#">…</a> —— 文内导航;悬停出下划线,焦点有环。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const lnk = (cls: string, text: string, part = 'lnk'): PageNode => ({
  tag: 'a',
  cls: `lnk${cls ? ` ${cls}` : ''}`,
  part,
  attrs: { href: '#' },
  text
})

export const LINK: ComponentRecipe = {
  id: 'link',
  label: '链接',
  group: 'lnk',
  stateNames: ['默认', '悬停', '按下', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.lnk',
      decls: [
        ['color', v('lnk-color')],
        ['font-size', v('lnk-font-size')],
        ['line-height', v('line-height-normal')],
        ['text-decoration', 'none'],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.lnk--underline',
      decls: [['text-decoration', 'underline']]
    },
    {
      sel: '.lnk--quiet',
      decls: [['color', v('color-text-secondary')]]
    },
    {
      sel: '.lnk--icon',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('lnk-gap')]
      ]
    },
    {
      sel: '.lnk--icon .lnk-ic',
      decls: [
        ['width', v('lnk-icon-size')],
        ['height', v('lnk-icon-size')],
        ['display', 'inline-flex']
      ]
    }
  ],
  states: [
    {
      base: '.lnk',
      state: 'hover',
      decls: [
        ['color', v('lnk-hover')],
        ['text-decoration', 'underline']
      ]
    },
    {
      base: '.lnk',
      state: 'active',
      decls: [['color', v('color-primary-active')]]
    },
    {
      base: '.lnk',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')],
        ['border-radius', v('radius-sm')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const row = demoRow([
      demoLabel('文内'),
      lnk('', '查看详情'),
      lnk(DEMO_STATE_CLASS.hover, '悬停态'),
      lnk(DEMO_STATE_CLASS.focus, '焦点态')
    ])
    const variants = demoRow([
      demoLabel('变体'),
      lnk('lnk--underline', '常带下划线'),
      lnk('lnk--quiet', '次要链接'),
      {
        tag: 'a',
        cls: 'lnk lnk--icon',
        attrs: { href: '#' },
        children: [
          { tag: 'span', cls: 'lnk-ic', icon: 'demo-arrow' },
          { tag: 'span', text: '返回列表' }
        ]
      }
    ])
    return demoSection(theme, '链接', [row, variants])
  }
}
