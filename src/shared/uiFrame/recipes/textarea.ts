// 文本域配方:<textarea class="ta">…</textarea> —— 与输入框同一套视觉,多行版。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const ta = (cls: string, placeholder: string, disabled = false): PageNode => ({
  tag: 'textarea',
  cls: `ta${cls ? ` ${cls}` : ''}`,
  part: 'ta',
  attrs: {
    placeholder,
    ...(disabled ? { disabled: '' } : {})
  }
})

export const TEXTAREA: ComponentRecipe = {
  id: 'textarea',
  label: '文本域',
  group: 'ta',
  stateNames: ['默认', '悬停', '焦点', '禁用'],
  // 文本域没有按下态语义,:active 不作要求
  requiredStates: [':hover', ':focus-visible', ':disabled'],
  rules: [
    {
      sel: '.ta',
      decls: [
        ['width', v('ta-width')],
        ['min-height', v('ta-min-height')],
        ['padding', `${v('ta-padding-y')} ${v('ta-padding-x')}`],
        ['border', `${v('ta-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('ta-radius')],
        ['background', v('color-surface')],
        ['color', v('color-text')],
        ['font-family', 'inherit'],
        ['font-size', v('ta-font-size')],
        ['line-height', v('line-height-normal')],
        ['resize', 'vertical'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.ta::placeholder',
      decls: [['color', v('color-text-secondary')]]
    },
    {
      sel: '.ta:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    {
      base: '.ta',
      state: 'hover',
      decls: [['border-color', v('color-border-strong')]]
    },
    {
      base: '.ta',
      state: 'focus',
      decls: [
        ['border-color', v('color-primary')],
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const row = demoRow([
      demoLabel('多行'),
      ta('', '写点什么…'),
      ta(DEMO_STATE_CLASS.hover, '悬停态'),
      ta(DEMO_STATE_CLASS.focus, '焦点态'),
      ta('', '禁用态', true)
    ])
    return demoSection(theme, '文本域', [row])
  }
}
