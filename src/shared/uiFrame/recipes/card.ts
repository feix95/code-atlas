// 卡片配方:图标底块 + 标题 + 说明;变体见 第 7.4 节(描边 / 阴影 / 填充底、可点击)。
import type { PageNode, ThemeName } from '../types.ts'
import { demoCol, demoLabel, demoRow, demoSection, v, type ComponentRecipe } from './kit.ts'

// 样式轴(第 7.4 节):描边 / 阴影 / 填充底
const VARIANTS: Array<[cls: string, name: string]> = [
  ['card--outline', '描边'],
  ['card--shadow', '阴影'],
  ['card--fill', '填充底']
]

export const CARD: ComponentRecipe = {
  id: 'card',
  label: '卡片',
  group: 'card',
  stateNames: ['默认', '悬停', '焦点'],
  rules: [
    {
      sel: '.card',
      decls: [
        ['box-sizing', 'border-box'],
        ['margin', '0'],
        ['padding', v('card-padding')],
        ['font-family', v('font-family')],
        ['text-align', 'left'],
        ['color', v('color-text')],
        ['background', v('color-surface')],
        ['border', `${v('card-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('card-radius')],
        ['box-shadow', v('card-shadow')]
      ]
    },
    {
      sel: '.card__icon',
      decls: [
        ['box-sizing', 'border-box'],
        ['display', 'flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('card-icon-box')],
        ['height', v('card-icon-box')],
        ['margin', `0 0 ${v('card-icon-gap')}`],
        ['border-radius', v('card-icon-radius')],
        ['background', v('color-primary-subtle')],
        ['color', v('color-primary')]
      ]
    },
    {
      sel: '.card__icon svg',
      decls: [
        ['display', 'block'],
        ['flex', 'none'],
        ['width', v('card-icon-size')],
        ['height', v('card-icon-size')],
        ['stroke-width', v('icon-stroke')]
      ]
    },
    {
      sel: '.card__title',
      decls: [
        ['margin', `0 0 ${v('card-title-gap')}`],
        ['font-size', v('card-title-size')],
        ['font-weight', v('card-title-weight')],
        ['line-height', v('card-title-line-height')],
        ['color', v('color-text')]
      ]
    },
    {
      sel: '.card__text',
      decls: [
        ['margin', '0'],
        ['font-size', v('card-text-size')],
        ['font-weight', v('font-weight-regular')],
        ['line-height', v('card-text-line-height')],
        ['color', v('color-text-secondary')]
      ]
    },
    // 样式轴(第 7.4 节):纯描边 / 纯阴影 / 填充底
    { sel: '.card--outline', decls: [['box-shadow', 'none']] },
    {
      sel: '.card--shadow',
      decls: [
        ['border-color', 'transparent'],
        ['box-shadow', v('card-shadow')]
      ]
    },
    {
      sel: '.card--fill',
      decls: [
        ['background', v('color-hover-bg')],
        ['border-color', 'transparent'],
        ['box-shadow', 'none']
      ]
    },
    // 可点击(第 7.4 节):手型光标,悬停/焦点态走下方 states
    {
      sel: '.card--click',
      decls: [['cursor', 'pointer']]
    }
  ],
  states: [
    {
      base: '.card--click',
      state: 'hover',
      decls: [['border-color', v('color-border-strong')]]
    },
    {
      base: '.card--click',
      state: 'active',
      decls: [['border-color', v('color-primary')]]
    },
    {
      base: '.card--click',
      state: 'focus',
      real: ':focus-visible',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const card = (cls: string, title: string): PageNode => ({
      tag: 'div',
      cls: `card${cls ? ` ${cls}` : ''}`,
      part: 'card',
      children: [
        { tag: 'div', cls: 'card__icon', icon: 'demo-card', part: 'card-icon-box' },
        { tag: 'h3', cls: 'card__title', text: title },
        { tag: 'p', cls: 'card__text', text: '卡片说明文字,用于展示正文字号与行高。' }
      ]
    })
    const variantGrid = {
      tag: 'div',
      cls: 'demo-cards',
      children: VARIANTS.map(([cls]) =>
        card(
          cls,
          cls === 'card--outline' ? '描边卡片' : cls === 'card--shadow' ? '阴影卡片' : '填充底卡片'
        )
      )
    }
    const clickRow = demoRow([
      demoLabel('可点击'),
      demoCol([
        {
          tag: 'div',
          cls: 'card card--click',
          part: 'card',
          attrs: { tabindex: '0', role: 'button' },
          children: [
            { tag: 'h3', cls: 'card__title', text: '可点击卡片' },
            { tag: 'p', cls: 'card__text', text: '悬停换描边色,焦点出焦点环。' }
          ]
        }
      ])
    ])
    return demoSection(theme, '卡片', [variantGrid, clickRow])
  }
}
