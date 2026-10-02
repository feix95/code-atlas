// 数据展示类配方合集:tag(标签)、avatar(头像)、divider(分割线)。
// 展示件无交互态,states 为空豁免状态检查。
import type { PageNode, ThemeName } from '../types.ts'
import { demoLabel, demoRow, demoSection, v, type ComponentRecipe } from './kit.ts'

const tag = (cls: string, text: string, removable = false): PageNode => ({
  tag: 'span',
  cls: `tag${cls ? ` ${cls}` : ''}`,
  part: 'tag',
  children: [
    { tag: 'span', text },
    ...(removable
      ? [
          {
            tag: 'button',
            cls: 'tag__x',
            attrs: { type: 'button', 'aria-label': '移除' },
            text: '×'
          }
        ]
      : [])
  ]
})

export const TAG: ComponentRecipe = {
  id: 'tag',
  label: '标签',
  group: 'tag',
  stateNames: ['默认', '悬停', '焦点', '禁用'],
  // 可移除标签的 × 才有交互;整体豁免 :active
  requiredStates: [':hover', ':focus-visible', ':disabled'],
  rules: [
    {
      sel: '.tag',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('tag-gap')],
        ['height', v('tag-height')],
        ['padding', `0 ${v('tag-padding-x')}`],
        ['border-radius', v('tag-radius')],
        ['border', `${v('tag-border-width')} solid ${v('color-border')}`],
        ['background', v('color-surface')],
        ['color', v('color-text')],
        ['font-size', v('tag-font-size')],
        ['line-height', v('line-height-tight')],
        ['box-sizing', 'border-box'],
        ['vertical-align', 'middle']
      ]
    },
    {
      sel: '.tag--solid',
      decls: [
        ['background', v('color-primary')],
        ['border-color', v('color-primary')],
        ['color', v('color-on-primary')]
      ]
    },
    {
      sel: '.tag--subtle',
      decls: [
        ['background', v('color-primary-subtle')],
        ['border-color', 'transparent'],
        ['color', v('color-primary')]
      ]
    },
    {
      sel: '.tag__x',
      decls: [
        ['width', v('tag-x-size')],
        ['height', v('tag-x-size')],
        ['padding', '0'],
        ['border', 'none'],
        ['border-radius', v('radius-full')],
        ['background', 'transparent'],
        ['color', 'inherit'],
        ['font-size', v('tag-x-font')],
        ['line-height', v('line-height-tight')],
        ['cursor', 'pointer']
      ]
    }
  ],
  states: [
    {
      base: '.tag__x',
      state: 'hover',
      decls: [['background', v('color-hover-bg')]]
    },
    {
      base: '.tag__x',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '标签', [
      demoRow([
        demoLabel('样式'),
        tag('', '默认'),
        tag('tag--subtle', '浅底'),
        tag('tag--solid', '实底')
      ]),
      demoRow([demoLabel('可移除'), tag('', '可关闭', true)])
    ])
  }
}

const avatar = (cls: string, text: string, icon = false): PageNode => ({
  tag: 'span',
  cls: `avt${cls ? ` ${cls}` : ''}`,
  part: 'avt',
  children: [icon ? { tag: 'span', cls: 'avt__ic', icon: 'demo-li' } : { tag: 'span', text }]
})

export const AVATAR: ComponentRecipe = {
  id: 'avatar',
  label: '头像',
  group: 'avt',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.avt',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('avt-size-md')],
        ['height', v('avt-size-md')],
        ['border-radius', v('avt-radius')],
        ['background', v('avt-bg')],
        ['color', v('avt-fg')],
        ['font-size', v('avt-font-size-md')],
        ['font-weight', v('avt-font-weight')],
        ['overflow', 'hidden'],
        ['flex-shrink', '0'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.avt--sm',
      decls: [
        ['width', v('avt-size-sm')],
        ['height', v('avt-size-sm')],
        ['font-size', v('avt-font-size-sm')]
      ]
    },
    {
      sel: '.avt--lg',
      decls: [
        ['width', v('avt-size-lg')],
        ['height', v('avt-size-lg')],
        ['font-size', v('avt-font-size-lg')]
      ]
    },
    {
      sel: '.avt--square',
      decls: [['border-radius', v('radius-md')]]
    },
    {
      sel: '.avt .avt__ic',
      decls: [
        ['width', v('avt-icon-size')],
        ['height', v('avt-icon-size')],
        ['display', 'inline-flex']
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '头像', [
      demoRow([
        demoLabel('尺寸'),
        avatar('avt--lg', '葵'),
        avatar('', '葵'),
        avatar('avt--sm', '葵')
      ]),
      demoRow([demoLabel('变体'), avatar('avt--square', '葵'), avatar('', '', true)])
    ])
  }
}

export const DIVIDER: ComponentRecipe = {
  id: 'divider',
  label: '分割线',
  group: 'div',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.div',
      decls: [
        ['display', 'block'],
        ['width', v('div-length')],
        ['height', v('div-width')],
        ['background', v('color-border')],
        ['border', 'none'],
        ['margin', `${v('div-margin-y')} 0`]
      ]
    },
    {
      sel: '.div--v',
      decls: [
        ['width', v('div-width')],
        ['height', v('div-v-length')],
        ['margin', `0 ${v('div-margin-x')}`],
        ['display', 'inline-block'],
        ['vertical-align', 'middle']
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '分割线', [
      demoRow([
        demoLabel('水平'),
        { tag: 'span', cls: 'div', part: 'div', attrs: { role: 'separator' } }
      ]),
      demoRow([
        demoLabel('竖直'),
        { tag: 'span', text: '左' },
        { tag: 'span', cls: 'div div--v', part: 'div-v', attrs: { role: 'separator' } },
        { tag: 'span', text: '右' }
      ])
    ])
  }
}
