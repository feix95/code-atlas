// 列表行配方:<div class="li">[前置]<div class="li__main">主/次行</div>[尾部]</div>
// 变体轴(第 7.4 节):单行/两行 × 前置(无/图标/头像)× 尾部(无/箭头/开关/数值)。
// 演示矩阵每轴至少覆盖一次;尾部开关直接复用 .sw 组件(演示页会加载全部组件 CSS)。
import type { PageNode, ThemeName } from '../types.ts'
import { DEMO_STATE_CLASS, demoCol, demoRow, demoSection, v, type ComponentRecipe } from './kit.ts'

const leadIcon: PageNode = { tag: 'span', cls: 'li__lead', icon: 'demo-li', part: 'li-lead' }
const leadAvatar: PageNode = {
  tag: 'span',
  cls: 'li__lead li__avatar',
  text: 'A',
  part: 'li-avatar'
}
const trailArrow: PageNode = { tag: 'span', cls: 'li__trail', icon: 'demo-arrow', part: 'li-trail' }
const trailValue: PageNode = {
  tag: 'span',
  cls: 'li__trail li__value',
  text: '99+',
  part: 'li-value'
}
const trailSwitch: PageNode = {
  tag: 'label',
  cls: 'sw sw--sm',
  children: [
    { tag: 'input', cls: 'sw__in', attrs: { type: 'checkbox', checked: '' } },
    { tag: 'span', cls: 'sw__thumb' }
  ]
}

const main = (two: boolean): PageNode => ({
  tag: 'div',
  cls: 'li__main',
  children: [
    { tag: 'div', cls: 'li__title', text: '列表标题' },
    ...(two ? [{ tag: 'div', cls: 'li__sub', text: '辅助说明文字' }] : [])
  ]
})

const row = (
  cls: string,
  lead: PageNode | null,
  two: boolean,
  trail: PageNode | null
): PageNode => ({
  tag: 'div',
  cls: `li${two ? ' li--two' : ''}${cls ? ` ${cls}` : ''}`,
  part: 'li',
  children: [...(lead ? [lead] : []), main(two), ...(trail ? [trail] : [])]
})

export const LIST_ROW: ComponentRecipe = {
  id: 'list-row',
  label: '列表行',
  group: 'li',
  stateNames: ['默认', '悬停', '按下', '禁用'],
  // 列表行本身不可聚焦、禁用用 class 表达,体检只查悬停与按下
  requiredStates: [':hover', ':active'],
  demoDeps: ['switch'],
  rules: [
    {
      sel: '.li',
      decls: [
        ['box-sizing', 'border-box'],
        ['display', 'flex'],
        ['align-items', 'center'],
        ['gap', v('li-gap')],
        ['width', v('li-width')],
        ['margin', '0'],
        ['padding', `${v('li-padding-y')} ${v('li-padding-x')}`],
        ['font-family', v('font-family')],
        ['border-bottom', `${v('li-divider-w')} solid ${v('color-border')}`],
        ['color', v('color-text')]
      ]
    },
    {
      sel: '.li__lead',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['flex', 'none'],
        ['width', v('li-icon-box')],
        ['height', v('li-icon-box')],
        ['color', v('color-text-secondary')]
      ]
    },
    {
      sel: '.li__lead svg',
      decls: [
        ['display', 'block'],
        ['width', v('li-icon-size')],
        ['height', v('li-icon-size')],
        ['stroke-width', v('icon-stroke')]
      ]
    },
    {
      sel: '.li__avatar',
      decls: [
        ['width', v('li-avatar')],
        ['height', v('li-avatar')],
        ['border-radius', v('radius-full')],
        ['background', v('li-avatar-bg')],
        ['color', v('li-avatar-fg')],
        ['font-size', v('li-avatar-fs')],
        ['font-weight', v('li-avatar-fw')]
      ]
    },
    {
      sel: '.li__main',
      decls: [
        ['flex', 'auto'],
        ['min-width', '0'],
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['gap', v('li-sub-gap')]
      ]
    },
    {
      sel: '.li__title',
      decls: [
        ['font-size', v('li-title-size')],
        ['font-weight', v('li-title-weight')],
        ['line-height', v('li-title-line-height')],
        ['color', v('color-text')]
      ]
    },
    {
      sel: '.li__sub',
      decls: [
        ['font-size', v('li-sub-size')],
        ['font-weight', v('font-weight-regular')],
        ['line-height', v('li-sub-line-height')],
        ['color', v('color-text-secondary')]
      ]
    },
    {
      sel: '.li__trail',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['flex', 'none'],
        ['color', v('color-text-secondary')]
      ]
    },
    {
      sel: '.li__trail svg',
      decls: [
        ['display', 'block'],
        ['width', v('li-trail-icon')],
        ['height', v('li-trail-icon')],
        ['stroke-width', v('icon-stroke')]
      ]
    },
    {
      sel: '.li__value',
      decls: [
        ['font-size', v('li-value-size')],
        ['font-weight', v('font-weight-regular')],
        ['line-height', v('line-height-normal')]
      ]
    },
    {
      sel: '.li--disabled',
      decls: [['opacity', v('opacity-disabled')]]
    }
  ],
  states: [
    {
      base: '.li',
      state: 'hover',
      real: ':hover:not(.li--disabled)',
      decls: [['background', v('color-hover-bg')]]
    },
    {
      base: '.li',
      state: 'active',
      real: ':active:not(.li--disabled)',
      decls: [['background', v('color-pressed-bg')]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const group = (name: string, rows: PageNode[]): PageNode =>
      demoRow([{ tag: 'span', cls: 'demo-label', text: name }, demoCol(rows)])
    return demoSection(theme, '列表行', [
      group('单行', [
        row('', null, false, null),
        row('', leadIcon, false, trailArrow),
        row('', leadAvatar, false, trailValue)
      ]),
      group('两行', [row('', leadIcon, true, trailArrow), row('', leadAvatar, true, trailSwitch)]),
      group('状态', [
        row('', leadIcon, false, trailArrow),
        row(DEMO_STATE_CLASS.hover, leadIcon, false, trailArrow),
        row(DEMO_STATE_CLASS.active, leadIcon, false, trailArrow),
        row('li--disabled', leadIcon, false, trailArrow)
      ])
    ])
  }
}
