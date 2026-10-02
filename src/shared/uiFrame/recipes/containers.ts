// 容器与数据类配方合集:acdn(折叠面板)、tbl(表格)、tree(树形列表)、tline(时间线)。
import type { PageNode, ThemeName } from '../types.ts'
import { demoCol, demoRow, demoSection, v, type ComponentRecipe } from './kit.ts'

const acdnItem = (title: string, open = false): PageNode => ({
  tag: 'div',
  cls: 'acdn__it',
  attrs: open ? { 'data-open': 'true' } : {},
  children: [
    {
      tag: 'button',
      cls: 'acdn__head',
      attrs: { type: 'button', 'aria-expanded': open ? 'true' : 'false' },
      children: [
        { tag: 'span', text: title },
        { tag: 'span', cls: 'acdn__ic', part: 'acdn-ic', icon: open ? 'demo-down' : 'demo-arrow' }
      ]
    },
    ...(open
      ? [
          {
            tag: 'div',
            cls: 'acdn__body',
            children: [{ tag: 'p', cls: 'acdn__text', text: '折叠区展开的内容。' }]
          }
        ]
      : [])
  ]
})

export const COLLAPSE: ComponentRecipe = {
  id: 'collapse',
  label: '折叠面板',
  group: 'acdn',
  stateNames: ['默认', '悬停', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.acdn',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['width', v('acdn-width')],
        ['border', `${v('acdn-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('acdn-radius')],
        ['background', v('color-surface')],
        ['overflow', 'hidden'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.acdn__it + .acdn__it',
      decls: [['border-top', `${v('acdn-border-width')} solid ${v('color-border')}`]]
    },
    {
      sel: '.acdn__head',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['justify-content', 'space-between'],
        ['width', 'inherit'],
        ['padding', `${v('acdn-head-padding-y')} ${v('acdn-padding-x')}`],
        ['border', 'none'],
        ['background', 'transparent'],
        ['color', v('color-text')],
        ['font-size', v('acdn-font-size')],
        ['font-weight', v('font-weight-medium')],
        ['text-align', 'left'],
        ['cursor', 'pointer'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.acdn__ic',
      decls: [
        ['width', v('acdn-icon-size')],
        ['height', v('acdn-icon-size')],
        ['display', 'inline-flex'],
        ['color', v('color-text-secondary')],
        ['flex-shrink', '0']
      ]
    },
    {
      sel: '.acdn__it[data-open="true"] .acdn__ic',
      // 展开态箭头朝下来自图标本身(demo-down);组件实现可自行换图标或加 transform
      decls: [['color', v('color-primary')]]
    },
    {
      sel: '.acdn__body',
      decls: [
        ['padding', `0 ${v('acdn-padding-x')} ${v('acdn-body-padding-y')}`],
        ['border-top', `${v('acdn-border-width')} solid ${v('color-border')}`]
      ]
    },
    {
      sel: '.acdn__text',
      decls: [
        ['font-size', v('acdn-text-size')],
        ['color', v('color-text-secondary')],
        ['line-height', v('line-height-normal')],
        ['margin', `${v('acdn-body-padding-y')} 0 0`]
      ]
    }
  ],
  states: [
    {
      base: '.acdn__head',
      state: 'hover',
      decls: [['background', v('color-hover-bg')]]
    },
    {
      base: '.acdn__head',
      state: 'focus',
      decls: [['box-shadow', `inset 0 0 0 ${v('focus-ring-width')} ${v('color-focus')}`]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '折叠面板', [
      demoCol([
        {
          tag: 'div',
          cls: 'acdn',
          part: 'acdn',
          children: [acdnItem('常规设置', true), acdnItem('通知'), acdnItem('隐私')]
        }
      ])
    ])
  }
}

export const TABLE: ComponentRecipe = {
  id: 'table',
  label: '表格',
  group: 'tbl',
  stateNames: ['默认', '悬停'],
  requiredStates: [':hover'],
  rules: [
    {
      sel: '.tbl',
      decls: [
        ['width', v('tbl-width')],
        ['border', `${v('tbl-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('tbl-radius')],
        ['background', v('color-surface')],
        ['border-collapse', 'separate'],
        ['border-spacing', '0'],
        ['overflow', 'hidden'],
        ['font-size', v('tbl-font-size')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.tbl th',
      decls: [
        ['padding', `${v('tbl-head-padding-y')} ${v('tbl-padding-x')}`],
        ['background', v('tbl-head-bg')],
        ['color', v('color-text-secondary')],
        ['font-size', v('tbl-head-font-size')],
        ['font-weight', v('font-weight-medium')],
        ['text-align', 'left'],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.tbl td',
      decls: [
        ['padding', `${v('tbl-cell-padding-y')} ${v('tbl-padding-x')}`],
        ['color', v('color-text')],
        ['line-height', v('line-height-tight')],
        ['border-top', `${v('tbl-border-width')} solid ${v('color-border')}`]
      ]
    }
  ],
  states: [
    {
      base: '.tbl tbody tr',
      state: 'hover',
      decls: [['background', v('color-hover-bg')]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const tr = (cells: string[]): PageNode => ({
      tag: 'tr',
      children: cells.map((c) => ({ tag: 'td', text: c }))
    })
    return demoSection(theme, '表格', [
      demoRow([
        {
          tag: 'table',
          cls: 'tbl',
          part: 'tbl',
          children: [
            {
              tag: 'thead',
              children: [
                {
                  tag: 'tr',
                  children: ['名称', '状态', '修改时间'].map((c) => ({ tag: 'th', text: c }))
                }
              ]
            },
            {
              tag: 'tbody',
              children: [tr(['落地页', '已发布', '昨天']), tr(['设置页', '草稿', '10-02'])]
            }
          ]
        }
      ])
    ])
  }
}

const treeItem = (text: string, depth: number, open = false, leaf = false): PageNode => ({
  tag: 'div',
  cls: 'tree__it',
  attrs: { role: 'treeitem', 'data-depth': String(depth) },
  children: [
    {
      tag: 'span',
      cls: 'tree__ic',
      part: 'tree-ic',
      ...(leaf ? {} : { icon: open ? 'demo-down' : 'demo-arrow' })
    },
    { tag: 'span', text }
  ]
})

export const TREE: ComponentRecipe = {
  id: 'tree',
  label: '树形列表',
  group: 'tree',
  stateNames: ['默认', '悬停', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.tree',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['gap', v('tree-gap')],
        ['width', v('tree-width')],
        ['padding', v('tree-pad')],
        ['border', `${v('tree-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('tree-radius')],
        ['background', v('color-surface')],
        ['font-size', v('tree-font-size')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.tree__it',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['gap', v('tree-item-gap')],
        ['height', v('tree-item-height')],
        ['padding', `0 ${v('tree-item-padding-x')}`],
        ['border-radius', v('tree-item-radius')],
        ['color', v('color-text')],
        ['line-height', v('line-height-tight')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.tree__ic',
      decls: [
        ['width', v('tree-icon-size')],
        ['height', v('tree-icon-size')],
        ['display', 'inline-flex'],
        ['color', v('color-text-secondary')],
        ['flex-shrink', '0']
      ]
    },
    // 层级缩进:每深一层左移 tree-indent(规约支持 4 层)
    {
      sel: '.tree__it[data-depth="1"]',
      decls: [['padding-left', `calc(${v('tree-item-padding-x')} + ${v('tree-indent')})`]]
    },
    {
      sel: '.tree__it[data-depth="2"]',
      decls: [
        [
          'padding-left',
          `calc(${v('tree-item-padding-x')} + ${v('tree-indent')} + ${v('tree-indent')})`
        ]
      ]
    },
    {
      sel: '.tree__it[data-depth="3"]',
      decls: [
        [
          'padding-left',
          `calc(${v('tree-item-padding-x')} + ${v('tree-indent')} + ${v('tree-indent')} + ${v('tree-indent')})`
        ]
      ]
    },
    {
      sel: '.tree__it[aria-selected="true"]',
      decls: [
        ['background', v('color-primary-subtle')],
        ['color', v('color-primary')],
        ['font-weight', v('font-weight-medium')]
      ]
    }
  ],
  states: [
    {
      base: '.tree__it',
      state: 'hover',
      real: ':hover:not([aria-selected="true"])',
      decls: [['background', v('color-hover-bg')]]
    },
    {
      base: '.tree__it',
      state: 'focus',
      decls: [['box-shadow', `inset 0 0 0 ${v('focus-ring-width')} ${v('color-focus')}`]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '树形列表', [
      demoRow([
        {
          tag: 'div',
          cls: 'tree',
          part: 'tree',
          attrs: { role: 'tree' },
          children: [
            treeItem('文档', 0, true),
            {
              ...treeItem('指南', 1, false, true),
              attrs: { role: 'treeitem', 'data-depth': '1', 'aria-selected': 'true' }
            },
            treeItem('参考', 1, false, true),
            treeItem('资源', 0)
          ]
        }
      ])
    ])
  }
}

const tlineItem = (title: string, sub: string, done = false): PageNode => ({
  tag: 'div',
  cls: 'tline__it',
  children: [
    {
      tag: 'span',
      cls: 'tline__dot',
      part: 'tline-dot',
      ...(done ? { attrs: { 'data-state': 'done' } } : {})
    },
    {
      tag: 'div',
      cls: 'tline__body',
      children: [
        { tag: 'div', cls: 'tline__title', text: title },
        { tag: 'div', cls: 'tline__sub', text: sub }
      ]
    }
  ]
})

export const TIMELINE: ComponentRecipe = {
  id: 'timeline',
  label: '时间线',
  group: 'tline',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.tline',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['width', v('tline-width')]
      ]
    },
    {
      sel: '.tline__it',
      decls: [
        ['position', 'relative'],
        ['display', 'flex'],
        ['gap', v('tline-item-gap')],
        ['padding-bottom', v('tline-item-gap-y')]
      ]
    },
    {
      sel: '.tline__dot',
      decls: [
        ['width', v('tline-dot')],
        ['height', v('tline-dot')],
        ['border-radius', v('radius-full')],
        ['border', `${v('tline-border-width')} solid ${v('color-border-strong')}`],
        ['background', v('color-surface')],
        ['flex-shrink', '0'],
        ['box-sizing', 'border-box'],
        ['margin-top', v('tline-dot-margin')]
      ]
    },
    {
      sel: '.tline__dot[data-state="done"]',
      decls: [
        ['border-color', v('color-primary')],
        ['background', v('color-primary')]
      ]
    },
    {
      sel: '.tline__it::before',
      decls: [
        ['content', '""'],
        ['position', 'absolute'],
        ['left', v('tline-line-x')],
        ['top', v('tline-dot')],
        ['bottom', '0'],
        ['width', v('tline-border-width')],
        ['background', v('color-border')]
      ]
    },
    {
      sel: '.tline__it:last-child::before',
      decls: [['display', 'none']]
    },
    {
      sel: '.tline__title',
      decls: [
        ['font-size', v('tline-title-size')],
        ['font-weight', v('font-weight-medium')],
        ['color', v('color-text')],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.tline__sub',
      decls: [
        ['font-size', v('tline-sub-size')],
        ['color', v('color-text-secondary')],
        ['line-height', v('line-height-normal')]
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '时间线', [
      demoCol([
        {
          tag: 'div',
          cls: 'tline',
          part: 'tline',
          children: [
            tlineItem('创建项目', '10-01 09:30', true),
            tlineItem('调整变量', '10-02 14:12', true),
            tlineItem('导出规格包', '待进行')
          ]
        }
      ])
    ])
  }
}
