// 导航类配方合集:appbar(顶栏)、sidebar(侧边导航)、rail(图标栏)、bottombar(底部页签栏)、
// crumb(面包屑)、pgn(分页)、steps(步骤条)、fab(悬浮按钮,手机)。
import type { PageNode, ThemeName } from '../types.ts'
import { demoLabel, demoRow, demoSection, v, type ComponentRecipe } from './kit.ts'

export const APPBAR: ComponentRecipe = {
  id: 'appbar',
  label: '顶栏',
  group: 'abar',
  stateNames: ['默认', '悬停', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.abar',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['gap', v('abar-gap')],
        ['width', v('abar-width')],
        ['height', v('abar-height')],
        ['padding', `0 ${v('abar-padding-x')}`],
        ['border-bottom', `${v('abar-border-width')} solid ${v('color-border')}`],
        ['background', v('color-surface')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.abar__title',
      decls: [
        ['font-size', v('abar-title-size')],
        ['font-weight', v('font-weight-semibold')],
        ['color', v('color-text')],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.abar__spacer',
      decls: [['flex', 'auto']]
    },
    {
      sel: '.abar__nav',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('abar-nav-gap')]
      ]
    },
    {
      sel: '.abar__link',
      decls: [
        ['color', v('color-text-secondary')],
        ['font-size', v('abar-font-size')],
        ['text-decoration', 'none'],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.abar__link[aria-current]',
      decls: [
        ['color', v('color-text')],
        ['font-weight', v('font-weight-medium')]
      ]
    }
  ],
  states: [
    {
      base: '.abar__link',
      state: 'hover',
      decls: [['color', v('color-text')]]
    },
    {
      base: '.abar__link',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const link = (text: string, current = false): PageNode => ({
      tag: 'a',
      cls: 'abar__link',
      attrs: { href: '#', ...(current ? { 'aria-current': 'page' } : {}) },
      text
    })
    return demoSection(theme, '顶栏', [
      demoRow([
        {
          tag: 'header',
          cls: 'abar',
          part: 'abar',
          children: [
            { tag: 'span', cls: 'abar__title', part: 'abar-title', text: '产品名' },
            {
              tag: 'nav',
              cls: 'abar__nav',
              children: [link('功能', true), link('定价'), link('关于')]
            },
            { tag: 'span', cls: 'abar__spacer' },
            link('登录')
          ]
        }
      ])
    ])
  }
}

const sideItem = (
  text: string,
  icon: 'demo-li' | 'demo-card' | 'demo-arrow',
  current = false
): PageNode => ({
  tag: 'a',
  cls: `sbar__it`,
  attrs: { href: '#', ...(current ? { 'aria-current': 'page' } : {}) },
  children: [
    { tag: 'span', cls: 'sbar__ic', part: 'sbar-ic', icon },
    { tag: 'span', text }
  ]
})

export const SIDEBAR: ComponentRecipe = {
  id: 'sidebar',
  label: '侧边导航',
  group: 'sbar',
  stateNames: ['默认', '悬停', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.sbar',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['gap', v('sbar-gap')],
        ['width', v('sbar-width')],
        ['height', v('sbar-height')],
        ['padding', `${v('sbar-padding-y')} ${v('sbar-padding-x')}`],
        ['border-right', `${v('sbar-border-width')} solid ${v('color-border')}`],
        ['background', v('color-surface')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.sbar__it',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['gap', v('sbar-item-gap')],
        ['height', v('sbar-item-height')],
        ['padding', `0 ${v('sbar-item-padding-x')}`],
        ['border-radius', v('sbar-item-radius')],
        ['color', v('color-text-secondary')],
        ['font-size', v('sbar-font-size')],
        ['text-decoration', 'none'],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.sbar__it[aria-current]',
      decls: [
        ['background', v('color-primary-subtle')],
        ['color', v('color-primary')],
        ['font-weight', v('font-weight-medium')]
      ]
    },
    {
      sel: '.sbar__ic',
      decls: [
        ['width', v('sbar-icon-size')],
        ['height', v('sbar-icon-size')],
        ['display', 'inline-flex'],
        ['flex-shrink', '0']
      ]
    }
  ],
  states: [
    {
      base: '.sbar__it',
      state: 'hover',
      real: ':hover:not([aria-current])',
      decls: [
        ['background', v('color-hover-bg')],
        ['color', v('color-text')]
      ]
    },
    {
      base: '.sbar__it',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '侧边导航', [
      demoRow([
        {
          tag: 'nav',
          cls: 'sbar',
          part: 'sbar',
          children: [
            sideItem('概览', 'demo-card', true),
            sideItem('项目', 'demo-li'),
            sideItem('设置', 'demo-arrow')
          ]
        }
      ])
    ])
  }
}

export const RAIL: ComponentRecipe = {
  id: 'rail',
  label: '图标栏',
  group: 'rail',
  stateNames: ['默认', '悬停', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.rail',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['align-items', 'center'],
        ['gap', v('rail-gap')],
        ['width', v('rail-width')],
        ['height', v('rail-height')],
        ['padding', `${v('rail-padding-y')} 0`],
        ['border-right', `${v('rail-border-width')} solid ${v('color-border')}`],
        ['background', v('color-surface')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.rail__it',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('rail-item')],
        ['height', v('rail-item')],
        ['border', 'none'],
        ['border-radius', v('rail-item-radius')],
        ['background', 'transparent'],
        ['color', v('color-text-secondary')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.rail__it svg',
      decls: [
        ['width', v('rail-icon-size')],
        ['height', v('rail-icon-size')]
      ]
    },
    {
      sel: '.rail__it[aria-current]',
      decls: [
        ['background', v('color-primary-subtle')],
        ['color', v('color-primary')]
      ]
    }
  ],
  states: [
    {
      base: '.rail__it',
      state: 'hover',
      real: ':hover:not([aria-current])',
      decls: [
        ['background', v('color-hover-bg')],
        ['color', v('color-text')]
      ]
    },
    {
      base: '.rail__it',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const it = (icon: 'demo-li' | 'demo-card' | 'demo-ibtn', current = false): PageNode => ({
      tag: 'button',
      cls: 'rail__it',
      attrs: { type: 'button', ...(current ? { 'aria-current': 'page' } : {}) },
      children: [{ tag: 'span', cls: 'rail__ic', icon }]
    })
    return demoSection(theme, '图标栏', [
      demoRow([
        {
          tag: 'nav',
          cls: 'rail',
          part: 'rail',
          children: [it('demo-card', true), it('demo-li'), it('demo-ibtn')]
        }
      ])
    ])
  }
}

export const BOTTOMBAR: ComponentRecipe = {
  id: 'bottombar',
  label: '底部页签栏',
  group: 'bbar',
  stateNames: ['默认', '悬停', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.bbar',
      decls: [
        ['display', 'flex'],
        ['align-items', 'stretch'],
        ['width', v('bbar-width')],
        ['height', v('bbar-height')],
        ['border-top', `${v('bbar-border-width')} solid ${v('color-border')}`],
        ['background', v('color-surface')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.bbar__it',
      decls: [
        ['flex', 'auto'],
        ['display', 'inline-flex'],
        ['flex-direction', 'column'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['gap', v('bbar-item-gap')],
        ['border', 'none'],
        ['background', 'transparent'],
        ['color', v('color-text-secondary')],
        ['font-size', v('bbar-font-size')],
        ['line-height', v('line-height-tight')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.bbar__it svg',
      decls: [
        ['width', v('bbar-icon-size')],
        ['height', v('bbar-icon-size')]
      ]
    },
    {
      sel: '.bbar__it[aria-selected="true"]',
      decls: [['color', v('color-primary')]]
    }
  ],
  states: [
    {
      base: '.bbar__it',
      state: 'hover',
      real: ':hover:not([aria-selected="true"])',
      decls: [['color', v('color-text')]]
    },
    {
      base: '.bbar__it',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', `-${v('focus-ring-width')}`]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const it = (
      text: string,
      icon: 'demo-li' | 'demo-card' | 'demo-ibtn',
      on = false
    ): PageNode => ({
      tag: 'button',
      cls: 'bbar__it',
      attrs: { type: 'button', ...(on ? { 'aria-selected': 'true' } : {}) },
      children: [
        { tag: 'span', cls: 'bbar__ic', icon },
        { tag: 'span', text }
      ]
    })
    return demoSection(theme, '底部页签栏', [
      demoRow([
        {
          tag: 'nav',
          cls: 'bbar',
          part: 'bbar',
          children: [it('首页', 'demo-card', true), it('消息', 'demo-li'), it('我的', 'demo-ibtn')]
        }
      ])
    ])
  }
}

const crumbSep: PageNode = { tag: 'span', cls: 'crumb__sep', part: 'crumb-sep', text: '/' }

export const BREADCRUMB: ComponentRecipe = {
  id: 'breadcrumb',
  label: '面包屑',
  group: 'crumb',
  stateNames: ['默认', '悬停', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.crumb',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('crumb-gap')],
        ['font-size', v('crumb-font-size')],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.crumb__link',
      decls: [
        ['color', v('color-text-secondary')],
        ['text-decoration', 'none'],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.crumb__sep',
      decls: [['color', v('color-border-strong')]]
    },
    {
      sel: '.crumb__cur',
      decls: [
        ['color', v('color-text')],
        ['font-weight', v('font-weight-medium')]
      ]
    }
  ],
  states: [
    {
      base: '.crumb__link',
      state: 'hover',
      decls: [
        ['color', v('color-text')],
        ['text-decoration', 'underline']
      ]
    },
    {
      base: '.crumb__link',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const link = (text: string): PageNode => ({
      tag: 'a',
      cls: 'crumb__link',
      part: 'crumb-link',
      attrs: { href: '#' },
      text
    })
    return demoSection(theme, '面包屑', [
      demoRow([
        {
          tag: 'nav',
          cls: 'crumb',
          part: 'crumb',
          attrs: { 'aria-label': '面包屑' },
          children: [
            link('首页'),
            crumbSep,
            link('项目'),
            crumbSep,
            { tag: 'span', cls: 'crumb__cur', attrs: { 'aria-current': 'page' }, text: '设置' }
          ]
        }
      ])
    ])
  }
}

const pgnBtn = (text: string, on = false, disabled = false): PageNode => ({
  tag: 'button',
  cls: 'pgn__it',
  attrs: {
    type: 'button',
    ...(on ? { 'aria-current': 'page' } : {}),
    ...(disabled ? { disabled: '' } : {})
  },
  text
})

export const PAGINATION: ComponentRecipe = {
  id: 'pagination',
  label: '分页',
  group: 'pgn',
  stateNames: ['默认', '选中', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.pgn',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('pgn-gap')]
      ]
    },
    {
      sel: '.pgn__it',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['min-width', v('pgn-item')],
        ['height', v('pgn-item')],
        ['padding', `0 ${v('pgn-padding-x')}`],
        ['border', `${v('pgn-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('pgn-radius')],
        ['background', v('color-surface')],
        ['color', v('color-text')],
        ['font-size', v('pgn-font-size')],
        ['line-height', v('line-height-tight')],
        ['cursor', 'pointer'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.pgn__it[aria-current]',
      decls: [
        ['border-color', v('color-primary')],
        ['background', v('color-primary-subtle')],
        ['color', v('color-primary')],
        ['font-weight', v('font-weight-medium')]
      ]
    },
    {
      sel: '.pgn__it:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    {
      base: '.pgn__it',
      state: 'hover',
      real: ':hover:not(:disabled):not([aria-current])',
      decls: [['border-color', v('color-border-strong')]]
    },
    {
      base: '.pgn__it',
      state: 'active',
      real: ':active:not(:disabled)',
      decls: [['background', v('color-pressed-bg')]]
    },
    {
      base: '.pgn__it',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '分页', [
      demoRow([
        {
          tag: 'nav',
          cls: 'pgn',
          part: 'pgn',
          attrs: { 'aria-label': '分页' },
          children: [
            pgnBtn('‹', false, true),
            pgnBtn('1', true),
            pgnBtn('2'),
            pgnBtn('3'),
            pgnBtn('›')
          ]
        }
      ])
    ])
  }
}

export const STEPS: ComponentRecipe = {
  id: 'steps',
  label: '步骤条',
  group: 'stps',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.stps',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('stps-gap')]
      ]
    },
    {
      sel: '.stps__it',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('stps-item-gap')],
        ['color', v('color-text-secondary')],
        ['font-size', v('stps-font-size')],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.stps__dot',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('stps-dot')],
        ['height', v('stps-dot')],
        ['border-radius', v('radius-full')],
        ['border', `${v('stps-border-width')} solid ${v('color-border-strong')}`],
        ['background', v('color-surface')],
        ['color', v('color-text-secondary')],
        ['font-size', v('stps-dot-font')],
        ['box-sizing', 'border-box'],
        ['flex-shrink', '0']
      ]
    },
    {
      sel: '.stps__it[aria-current="step"]',
      decls: [
        ['color', v('color-text')],
        ['font-weight', v('font-weight-medium')]
      ]
    },
    {
      sel: '.stps__it[aria-current="step"] .stps__dot',
      decls: [
        ['border-color', v('color-primary')],
        ['background', v('color-primary')],
        ['color', v('color-on-primary')]
      ]
    },
    {
      sel: '.stps__it[data-state="done"] .stps__dot',
      decls: [
        ['border-color', v('color-primary')],
        ['color', v('color-primary')],
        ['background', v('color-primary-subtle')]
      ]
    },
    {
      sel: '.stps__link',
      decls: [
        ['width', v('stps-link-w')],
        ['height', v('stps-border-width')],
        ['background', v('color-border-strong')],
        ['flex-shrink', '0']
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    const step = (n: string, text: string, state: 'done' | 'cur' | 'todo'): PageNode => ({
      tag: 'span',
      cls: 'stps__it',
      attrs: {
        ...(state === 'cur' ? { 'aria-current': 'step' } : {}),
        ...(state === 'done' ? { 'data-state': 'done' } : {})
      },
      children: [
        { tag: 'span', cls: 'stps__dot', part: 'stps-dot', text: state === 'done' ? '✓' : n },
        { tag: 'span', text }
      ]
    })
    const link: PageNode = { tag: 'span', cls: 'stps__link', part: 'stps-link' }
    return demoSection(theme, '步骤条', [
      demoRow([
        {
          tag: 'nav',
          cls: 'stps',
          part: 'stps',
          attrs: { 'aria-label': '进度' },
          children: [
            step('1', '填写信息', 'done'),
            link,
            step('2', '确认方案', 'cur'),
            link,
            step('3', '导出', 'todo')
          ]
        }
      ])
    ])
  }
}

export const FAB: ComponentRecipe = {
  id: 'fab',
  label: '悬浮按钮',
  group: 'fab',
  stateNames: ['默认', '悬停', '按下', '焦点', '禁用'],
  rules: [
    {
      sel: '.fab',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('fab-size')],
        ['height', v('fab-size')],
        ['border', 'none'],
        ['border-radius', v('fab-radius')],
        ['background', v('color-primary')],
        ['color', v('color-on-primary')],
        ['box-shadow', v('fab-shadow')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.fab svg',
      decls: [
        ['width', v('fab-icon-size')],
        ['height', v('fab-icon-size')]
      ]
    },
    {
      sel: '.fab--sm',
      decls: [
        ['width', v('fab-size-sm')],
        ['height', v('fab-size-sm')]
      ]
    },
    {
      sel: '.fab:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    {
      base: '.fab',
      state: 'hover',
      decls: [['background', v('color-primary-hover')]]
    },
    {
      base: '.fab',
      state: 'active',
      decls: [['background', v('color-primary-active')]]
    },
    {
      base: '.fab',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const fab = (cls = '', disabled = false): PageNode => ({
      tag: 'button',
      cls: `fab${cls ? ` ${cls}` : ''}`,
      part: 'fab',
      attrs: { type: 'button', 'aria-label': '新建', ...(disabled ? { disabled: '' } : {}) },
      icon: 'demo-button'
    })
    return demoSection(theme, '悬浮按钮', [
      demoRow([demoLabel('圆形'), fab(), fab('fab--sm', false), fab('', true)])
    ])
  }
}
