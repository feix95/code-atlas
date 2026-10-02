// 按钮组/工具条配方:<div class="bgrp"><button class="bgrp__it">…</button></div>
// 一组同级动作的连体按钮:外轮廓一条描边,内部靠竖直分隔线。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const bgrp = (cls = '', selected = -1, disabledIdx = -1): PageNode => ({
  tag: 'div',
  cls: `bgrp${cls ? ` ${cls}` : ''}`,
  part: 'bgrp',
  children: ['左对齐', '居中', '右对齐'].map((text, i) => ({
    tag: 'button',
    cls: 'bgrp__it',
    part: i === 0 ? 'bgrp-it' : undefined,
    attrs: {
      type: 'button',
      'aria-pressed': i === selected ? 'true' : 'false',
      ...(i === disabledIdx ? { disabled: '' } : {})
    },
    text
  }))
})

export const BUTTON_GROUP: ComponentRecipe = {
  id: 'button-group',
  label: '按钮组',
  group: 'bgrp',
  stateNames: ['默认', '选中', '悬停', '按下', '焦点', '禁用'],
  rules: [
    {
      sel: '.bgrp',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'stretch'],
        ['height', v('bgrp-height')],
        ['border', `${v('bgrp-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('bgrp-radius')],
        ['background', v('color-surface')],
        ['overflow', 'hidden'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.bgrp__it',
      decls: [
        ['border', 'none'],
        ['padding', `0 ${v('bgrp-padding-x')}`],
        ['background', 'transparent'],
        ['color', v('color-text')],
        ['font-size', v('bgrp-font-size')],
        ['font-weight', v('font-weight-medium')],
        ['line-height', v('line-height-tight')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.bgrp__it + .bgrp__it',
      decls: [['border-left', `${v('bgrp-border-width')} solid ${v('color-border')}`]]
    },
    {
      sel: '.bgrp__it[aria-pressed="true"]',
      decls: [
        ['background', v('color-primary-subtle')],
        ['color', v('color-primary')]
      ]
    },
    {
      sel: '.bgrp__it:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    {
      base: '.bgrp__it',
      state: 'hover',
      real: ':hover:not(:disabled):not([aria-pressed="true"])',
      decls: [['background', v('color-hover-bg')]]
    },
    {
      base: '.bgrp__it',
      state: 'active',
      decls: [['background', v('color-pressed-bg')]]
    },
    {
      base: '.bgrp__it',
      state: 'focus',
      // 连体按钮的焦点环收进内侧,避免画到相邻按钮上
      decls: [['box-shadow', `inset 0 0 0 ${v('focus-ring-width')} ${v('color-focus')}`]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const row = demoRow([
      demoLabel('三段'),
      bgrp(),
      bgrp('', 1),
      {
        tag: 'div',
        cls: 'bgrp',
        children: [
          {
            tag: 'button',
            cls: 'bgrp__it',
            attrs: { type: 'button', 'aria-pressed': 'false' },
            text: '日'
          },
          {
            tag: 'button',
            cls: `bgrp__it ${DEMO_STATE_CLASS.hover}`,
            attrs: { type: 'button', 'aria-pressed': 'false' },
            text: '周'
          },
          {
            tag: 'button',
            cls: `bgrp__it ${DEMO_STATE_CLASS.active}`,
            attrs: { type: 'button', 'aria-pressed': 'false' },
            text: '月'
          }
        ]
      },
      bgrp('', -1, 2)
    ])
    return demoSection(theme, '按钮组', [row])
  }
}
