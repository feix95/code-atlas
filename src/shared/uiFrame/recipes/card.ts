// 卡片配方:图标底块 + 标题 + 说明;变体见 §7.4(描边 / 阴影 / 填充底、可点击)。
import type { PageNode, ThemeName } from '../types.ts'
import { demoSection, v, type ComponentRecipe } from './kit.ts'

export const CARD: ComponentRecipe = {
  id: 'card',
  label: '卡片',
  group: 'card',
  stateNames: ['默认'],
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
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    const card: PageNode = {
      tag: 'div',
      cls: 'card',
      part: 'card',
      children: [
        { tag: 'div', cls: 'card__icon', icon: 'demo-card', part: 'card-icon-box' },
        { tag: 'h3', cls: 'card__title', text: '卡片标题' },
        { tag: 'p', cls: 'card__text', text: '卡片说明文字,用于展示正文字号与行高。' }
      ]
    }
    return demoSection(theme, '卡片', [{ tag: 'div', cls: 'demo-cards', children: [card] }])
  }
}
