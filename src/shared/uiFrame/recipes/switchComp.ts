// 开关配方:<label class="sw"><input class="sw__in"><span class="sw__thumb"></span></label>
// 勾选态走真实 checked 属性(演示与导出同一份);内嵌 / 外凸两种滑块样式 × 小中。
// 组件级自定义属性(--sw-w 等)只在本文件里改绑,数值仍全部来自 tokens。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const STATES: Array<[cls: string, label: string, on: boolean, disabled: boolean]> = [
  ['', '默认', false, false],
  ['', '开', true, false],
  [DEMO_STATE_CLASS.hover, '悬停', false, false],
  [DEMO_STATE_CLASS.focus, '焦点', true, false],
  ['', '禁用·关', false, true],
  ['', '禁用·开', true, true]
]

export const SWITCH: ComponentRecipe = {
  id: 'switch',
  label: '开关',
  group: 'sw',
  stateNames: ['默认', '开', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.sw',
      decls: [
        ['--sw-w', v('sw-width-md')],
        ['--sw-h', v('sw-height-md')],
        ['--sw-thumb', v('sw-thumb-md')],
        ['--sw-travel', v('sw-travel-md')],
        ['box-sizing', 'border-box'],
        ['position', 'relative'],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['width', v('sw-w')],
        ['height', v('sw-h')],
        ['margin', '0'],
        ['padding', '0'],
        ['border', `${v('sw-border-width')} solid ${v('sw-off-border')}`],
        ['border-radius', v('sw-radius')],
        ['background', v('sw-off-bg')],
        ['cursor', 'pointer'],
        ['vertical-align', 'middle']
      ]
    },
    {
      sel: '.sw__in',
      decls: [
        ['position', 'absolute'],
        ['inset', '0'],
        ['margin', '0'],
        ['opacity', '0'],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.sw__thumb',
      decls: [
        ['display', 'block'],
        ['width', v('sw-thumb')],
        ['height', v('sw-thumb')],
        ['margin-left', v('sw-inset-md')],
        ['border-radius', v('radius-full')],
        ['background', v('sw-thumb-bg')],
        ['box-shadow', v('sw-thumb-shadow')],
        ['transform', 'translateX(0)']
      ]
    },
    {
      sel: '.sw--sm',
      decls: [
        ['--sw-w', v('sw-width-sm')],
        ['--sw-h', v('sw-height-sm')],
        ['--sw-thumb', v('sw-thumb-sm')],
        ['--sw-travel', v('sw-travel-sm')]
      ]
    },
    {
      sel: '.sw--pop',
      decls: [
        ['--sw-thumb', v('sw-thumb-pop')],
        ['--sw-travel', v('sw-travel-pop')]
      ]
    },
    {
      sel: '.sw--sm.sw--pop',
      decls: [['--sw-travel', v('sw-travel-pop-sm')]]
    },
    {
      sel: '.sw:has(.sw__in:checked)',
      decls: [
        ['background', v('color-primary')],
        ['border-color', v('color-primary')]
      ]
    },
    {
      sel: '.sw__in:checked + .sw__thumb',
      decls: [['transform', `translateX(${v('sw-travel')})`]]
    },
    {
      sel: '.sw:has(.sw__in:disabled)',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    },
    {
      sel: '.sw:has(.sw__in:disabled) .sw__in',
      decls: [['cursor', 'not-allowed']]
    },
    // 带文字(第 7.4 节 文字轴):开关后随一行说明文字
    {
      sel: '.sw-txt',
      decls: [
        ['font-size', v('font-size-md')],
        ['line-height', v('line-height-normal')],
        ['color', v('color-text')]
      ]
    }
  ],
  states: [
    {
      base: '.sw',
      state: 'hover',
      real: ':hover:not(:has(.sw__in:disabled))',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.sw',
      state: 'active',
      real: ':active:not(:has(.sw__in:disabled))',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.sw',
      state: 'focus',
      real: ':has(.sw__in:focus-visible)',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const sw = (cls: string, on: boolean, disabled: boolean): PageNode => {
      const input: PageNode = { tag: 'input', cls: 'sw__in', attrs: { type: 'checkbox' } }
      if (on) input.attrs!['checked'] = ''
      if (disabled) input.attrs!['disabled'] = ''
      return {
        tag: 'label',
        cls: `sw${cls ? ` ${cls}` : ''}`,
        part: cls.includes('sw--sm') ? 'sw-sm' : 'sw',
        children: [input, { tag: 'span', cls: 'sw__thumb' }]
      }
    }
    const mainRow = demoRow([
      demoLabel('内嵌'),
      ...STATES.map(([cls, , on, disabled]) => sw(cls, on, disabled))
    ])
    const popRow = demoRow([
      demoLabel('外凸'),
      sw('sw--pop', false, false),
      sw('sw--pop', true, false),
      sw(`sw--pop ${DEMO_STATE_CLASS.hover}`, false, false),
      sw(`sw--pop ${DEMO_STATE_CLASS.focus}`, true, false)
    ])
    const sizeRow = demoRow([
      demoLabel('尺寸'),
      sw('sw--sm', true, false),
      sw('', true, false),
      sw('sw--sm sw--pop', true, false),
      sw('sw--pop', true, false)
    ])
    const textRow = demoRow([
      demoLabel('带文字'),
      sw('', true, false),
      { tag: 'span', cls: 'sw-txt', text: '接收通知' },
      sw('sw--pop', false, false),
      { tag: 'span', cls: 'sw-txt', text: '静音' }
    ])
    return demoSection(theme, '开关', [mainRow, popRow, sizeRow, textRow])
  }
}
