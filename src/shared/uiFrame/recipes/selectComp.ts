// 下拉选择配方:<label class="sel-box"><select class="sel">…</select><span class="sel-ic">⌄</span></label>
// 用原生 select 保语义;箭头用字符图标(规格包会替换为图标系统条目)。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const selBox = (cls: string, disabled = false, part = 'sel-box'): PageNode => ({
  tag: 'label',
  cls: `sel-box${cls ? ` ${cls}` : ''}`,
  part,
  children: [
    {
      tag: 'select',
      cls: 'sel',
      attrs: disabled ? { disabled: '' } : {},
      children: [{ tag: 'option', text: '所有项目' }]
    },
    { tag: 'span', cls: 'sel-ic', part: 'sel-ic', icon: 'demo-down' }
  ]
})

export const SELECT: ComponentRecipe = {
  id: 'select',
  label: '下拉选择',
  group: 'sel',
  stateNames: ['默认', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.sel-box',
      decls: [
        ['position', 'relative'],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['width', v('sel-width')],
        ['height', v('sel-height-md')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.sel',
      decls: [
        ['appearance', 'none'],
        ['width', 'inherit'],
        ['height', 'inherit'],
        ['padding', `0 ${v('sel-height-md')} 0 ${v('sel-padding-x')}`],
        ['border', `${v('sel-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('sel-radius')],
        ['background', v('color-surface')],
        ['color', v('color-text')],
        ['font-size', v('sel-font-size')],
        ['line-height', v('line-height-tight')],
        ['cursor', 'pointer'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.sel-ic',
      decls: [
        ['position', 'absolute'],
        ['right', v('sel-padding-x')],
        ['width', v('sel-icon-size')],
        ['height', v('sel-icon-size')],
        ['color', v('color-text-secondary')],
        ['pointer-events', 'none'],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center']
      ]
    },
    {
      sel: '.sel:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    {
      base: '.sel',
      state: 'hover',
      decls: [['border-color', v('color-border-strong')]]
    },
    {
      base: '.sel',
      state: 'focus',
      decls: [
        ['border-color', v('color-primary')],
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    },
    {
      base: '.sel',
      state: 'active',
      decls: [['border-color', v('color-primary')]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const row = demoRow([
      demoLabel('中'),
      selBox(''),
      selBox(DEMO_STATE_CLASS.hover),
      selBox(DEMO_STATE_CLASS.focus),
      selBox('', true)
    ])
    return demoSection(theme, '下拉选择', [row])
  }
}
