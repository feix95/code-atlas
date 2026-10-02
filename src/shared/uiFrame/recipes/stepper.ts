// 数字步进器配方:<div class="stp"><button class="stp__btn">−</button><span class="stp__val">3</span><button class="stp__btn">+</button></div>
// 加减按钮与数值区共用一条描边,中间靠内边线分隔。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const stp = (minusCls: string, plusCls: string, disabled = false, part = 'stp'): PageNode => ({
  tag: 'div',
  cls: 'stp',
  part,
  children: [
    {
      tag: 'button',
      cls: `stp__btn${minusCls ? ` ${minusCls}` : ''}`,
      attrs: { type: 'button', 'aria-label': '减少', ...(disabled ? { disabled: '' } : {}) },
      text: '−'
    },
    { tag: 'span', cls: 'stp__val', part: 'stp-val', text: '3' },
    {
      tag: 'button',
      cls: `stp__btn${plusCls ? ` ${plusCls}` : ''}`,
      attrs: { type: 'button', 'aria-label': '增加', ...(disabled ? { disabled: '' } : {}) },
      text: '+'
    }
  ]
})

export const STEPPER: ComponentRecipe = {
  id: 'stepper',
  label: '步进器',
  group: 'stp',
  stateNames: ['默认', '悬停', '按下', '焦点', '禁用'],
  rules: [
    {
      sel: '.stp',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'stretch'],
        ['height', v('stp-height')],
        ['border', `${v('stp-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('stp-radius')],
        ['background', v('color-surface')],
        ['overflow', 'hidden'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.stp__btn',
      decls: [
        ['width', v('stp-btn-width')],
        ['border', 'none'],
        ['background', 'transparent'],
        ['color', v('color-text')],
        ['font-size', v('stp-font-size')],
        ['font-weight', v('font-weight-medium')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.stp__val',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['min-width', v('stp-val-width')],
        ['padding', `0 ${v('stp-val-padding-x')}`],
        ['border-left', `${v('stp-border-width')} solid ${v('color-border')}`],
        ['border-right', `${v('stp-border-width')} solid ${v('color-border')}`],
        ['color', v('color-text')],
        ['font-size', v('stp-font-size')],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.stp__btn:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    {
      base: '.stp__btn',
      state: 'hover',
      decls: [['background', v('color-hover-bg')]]
    },
    {
      base: '.stp__btn',
      state: 'active',
      decls: [['background', v('color-pressed-bg')]]
    },
    {
      base: '.stp__btn',
      state: 'focus',
      // 连体按钮的焦点环收进内侧,避免画到相邻按钮上
      decls: [['box-shadow', `inset 0 0 0 ${v('focus-ring-width')} ${v('color-focus')}`]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const row = demoRow([
      demoLabel('数值'),
      stp('', ''),
      stp(DEMO_STATE_CLASS.hover, ''),
      stp('', DEMO_STATE_CLASS.active),
      stp(DEMO_STATE_CLASS.focus, ''),
      stp('', '', true)
    ])
    return demoSection(theme, '步进器', [row])
  }
}
