// 提示气泡配方:<span class="tip">文字<span class="tip__arrow"></span></span>
// 变体轴(第 7.4 节):深色底 / 浅色底 × 带不带小尾巴(箭头)。
// 箭头是旋转 45deg 的方角块(deg 不是长度单位,不触发写死数值检查);
// 挂在气泡下沿,外露半边的偏移量走 tip-arrow-drop 变量。
import type { PageNode, ThemeName } from '../types.ts'
import { demoCol, demoLabel, demoRow, demoSection, v, type ComponentRecipe } from './kit.ts'

const VARIANTS: Array<[cls: string, name: string, arrow: boolean]> = [
  ['', '深色·带箭头', true],
  ['', '深色·无箭头', false],
  ['tip--light', '浅色·带箭头', true],
  ['tip--light', '浅色·无箭头', false]
]

export const TOOLTIP: ComponentRecipe = {
  id: 'tooltip',
  label: '提示气泡',
  group: 'tip',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.tip',
      decls: [
        ['--tip-bg', v('tip-dark-bg')],
        ['--tip-fg', v('tip-dark-fg')],
        ['--tip-arrow-border', 'transparent'],
        ['box-sizing', 'border-box'],
        ['position', 'relative'],
        ['display', 'inline-block'],
        ['margin', '0'],
        ['padding', `${v('tip-padding-y')} ${v('tip-padding-x')}`],
        ['font-family', v('font-family')],
        ['font-size', v('tip-font-size')],
        ['font-weight', v('font-weight-regular')],
        ['line-height', v('line-height-normal')],
        ['letter-spacing', '0'],
        ['white-space', 'nowrap'],
        ['border', '0'],
        ['border-radius', v('tip-radius')],
        ['background', v('tip-bg')],
        ['color', v('tip-fg')],
        ['box-shadow', v('tip-shadow')]
      ]
    },
    {
      sel: '.tip__arrow',
      decls: [
        ['position', 'absolute'],
        ['display', 'block'],
        ['box-sizing', 'border-box'],
        ['width', v('tip-arrow-size')],
        ['height', v('tip-arrow-size')],
        ['left', '0'],
        ['right', '0'],
        ['bottom', v('tip-arrow-drop')],
        ['margin', '0 auto'],
        ['border', '0'],
        ['border-right', `${v('tip-border-width')} solid ${v('tip-arrow-border')}`],
        ['border-bottom', `${v('tip-border-width')} solid ${v('tip-arrow-border')}`],
        ['border-radius', v('radius-none')],
        ['background', v('tip-bg')],
        ['transform', 'rotate(45deg)']
      ]
    },
    {
      sel: '.tip--light',
      decls: [
        ['--tip-bg', v('tip-light-bg')],
        ['--tip-fg', v('tip-light-fg')],
        ['border', `${v('tip-border-width')} solid ${v('color-border')}`]
      ]
    },
    {
      sel: '.tip--light .tip__arrow',
      decls: [['--tip-arrow-border', v('color-border')]]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    const tip = (cls: string, arrow: boolean): PageNode => ({
      tag: 'span',
      cls: `tip${cls ? ` ${cls}` : ''}`,
      part: 'tip',
      text: '提示文字',
      children: arrow ? [{ tag: 'span', cls: 'tip__arrow', part: 'tip-arrow' }] : undefined
    })
    return demoSection(theme, '提示气泡', [
      demoRow([demoLabel('样式'), demoCol(VARIANTS.map(([cls, , arrow]) => tip(cls, arrow)))])
    ])
  }
}
