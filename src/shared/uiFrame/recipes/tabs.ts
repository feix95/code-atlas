// 页签配方:<div class="tabs"><button class="tab">…</button></div>
// 容器仅负责排版;样式变体(下划线 / 胶囊 / 分段)与尺寸档靠组件级自定义属性改绑。
// 选中态是真实 aria-selected,悬停 / 焦点走伪类。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const VARIANTS: Array<[cls: string, name: string]> = [
  ['', '下划线'],
  ['tabs--pill', '胶囊'],
  ['tabs--seg', '分段'],
  ['tabs--card', '浏览器卡片']
]

const TAB_STATES: Array<[cls: string, label: string, selected: boolean]> = [
  ['', '默认', false],
  ['', '选中', true],
  [DEMO_STATE_CLASS.hover, '悬停', false],
  [DEMO_STATE_CLASS.focus, '焦点', false]
]

export const TABS: ComponentRecipe = {
  id: 'tabs',
  label: '页签',
  group: 'tab',
  stateNames: ['默认', '选中', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.tabs',
      decls: [
        ['--tab-fs', v('tab-font-size-md')],
        ['--tab-py', v('tab-padding-y-md')],
        ['--tab-px', v('tab-padding-x-md')],
        ['--tab-radius', v('radius-none')],
        ['--tab-fg', v('color-text-secondary')],
        ['--tab-on-fg', v('color-text')],
        ['--tab-on-bg', 'transparent'],
        ['box-sizing', 'border-box'],
        ['display', 'flex'],
        ['align-items', 'flex-end'],
        ['gap', v('tab-gap')],
        ['margin', '0'],
        ['padding', '0'],
        ['font-family', v('font-family')]
      ]
    },
    {
      sel: '.tab',
      decls: [
        ['box-sizing', 'border-box'],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['margin', '0'],
        ['padding', `${v('tab-py')} ${v('tab-px')}`],
        ['font-family', v('font-family')],
        ['font-size', v('tab-fs')],
        ['font-weight', v('tab-font-weight')],
        ['line-height', v('line-height-normal')],
        ['letter-spacing', '0'],
        ['white-space', 'nowrap'],
        ['border', '0'],
        ['border-bottom', `${v('tab-line-w')} solid transparent`],
        ['border-radius', v('tab-radius')],
        ['background', 'transparent'],
        ['color', v('tab-fg')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.tab[aria-selected="true"]',
      decls: [
        ['color', v('tab-on-fg')],
        ['border-bottom-color', v('color-primary')],
        ['background', v('tab-on-bg')]
      ]
    },
    {
      sel: '.tab:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    },
    {
      sel: '.tabs--sm',
      decls: [
        ['--tab-fs', v('tab-font-size-sm')],
        ['--tab-py', v('tab-padding-y-sm')],
        ['--tab-px', v('tab-padding-x-sm')]
      ]
    },
    {
      sel: '.tabs--pill',
      decls: [
        ['--tab-radius', v('radius-full')],
        ['--tab-on-bg', v('color-primary')],
        ['--tab-on-fg', v('color-on-primary')]
      ]
    },
    {
      sel: '.tabs--pill .tab',
      decls: [['border-bottom-color', 'transparent']]
    },
    {
      sel: '.tabs--seg',
      decls: [
        ['--tab-radius', v('tab-seg-radius')],
        ['--tab-on-bg', v('color-surface')],
        ['gap', '0'],
        ['padding', v('tab-seg-pad')],
        ['background', v('color-hover-bg')],
        ['border-radius', v('tab-seg-outer-radius')]
      ]
    },
    {
      sel: '.tabs--seg .tab',
      decls: [
        ['border-bottom-color', 'transparent'],
        ['box-shadow', 'none']
      ]
    },
    {
      sel: '.tabs--seg .tab[aria-selected="true"]',
      decls: [['box-shadow', v('tab-seg-shadow')]]
    },
    // 浏览器卡片型(第 7.4 节):选中页签上方圆角、贴卡片边线,底边并入分组底线
    {
      sel: '.tabs--card',
      decls: [
        ['--tab-radius', v('radius-md')],
        ['--tab-on-bg', v('color-surface')],
        ['gap', '0'],
        ['border-bottom', `${v('border-width-1')} solid ${v('color-border')}`]
      ]
    },
    {
      sel: '.tabs--card .tab',
      decls: [
        ['border', `${v('border-width-1')} solid transparent`],
        ['border-bottom', '0'],
        ['border-radius', `${v('tab-radius')} ${v('tab-radius')} 0 0`]
      ]
    },
    {
      sel: '.tabs--card .tab[aria-selected="true"]',
      decls: [['border-color', v('color-border')]]
    }
  ],
  states: [
    {
      base: '.tab',
      state: 'hover',
      real: ':hover:not(:disabled):not([aria-selected="true"])',
      decls: [['color', v('color-text')]]
    },
    {
      base: '.tab',
      state: 'active',
      real: ':active:not(:disabled)',
      decls: [['color', v('color-text')]]
    },
    {
      base: '.tab',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const tab = (cls: string, text: string, selected: boolean): PageNode => {
      const t: PageNode = { tag: 'button', cls, attrs: { type: 'button' }, text, part: 'tab' }
      if (selected) t.attrs!['aria-selected'] = 'true'
      return t
    }
    const groups = VARIANTS.map(([cls, name]) =>
      demoRow([
        demoLabel(name),
        {
          tag: 'div',
          cls: `tabs${cls ? ` ${cls}` : ''}`,
          children: TAB_STATES.map(([state, label, selected]) =>
            tab(`tab${state ? ` ${state}` : ''}`, label, selected)
          )
        }
      ])
    )
    const sizeRow = demoRow([
      demoLabel('尺寸'),
      {
        tag: 'div',
        cls: 'tabs tabs--sm',
        children: [
          tab('tab', '页签一', false),
          tab('tab', '页签二', true),
          tab('tab', '页签三', false)
        ]
      }
    ])
    return demoSection(theme, '页签', [...groups, sizeRow])
  }
}
