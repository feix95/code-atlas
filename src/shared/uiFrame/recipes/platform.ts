// 平台专属配方合集:tbar(窗口标题栏,桌面)、statbar(状态栏,桌面)、split(分栏条,桌面)、
// pnav(手机导航栏带返回)、swrow(滑动操作行,手机)、ptr(下拉刷新,手机)。
import type { PageNode, ThemeName } from '../types.ts'
import { demoLabel, demoRow, demoSection, v, type ComponentRecipe } from './kit.ts'

export const TITLEBAR: ComponentRecipe = {
  id: 'titlebar',
  label: '窗口标题栏',
  group: 'tbar',
  stateNames: ['默认', '悬停'],
  requiredStates: [':hover'],
  rules: [
    {
      sel: '.tbar',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['gap', v('tbar-gap')],
        ['width', v('tbar-width')],
        ['height', v('tbar-height')],
        ['padding', `0 ${v('tbar-padding-x')}`],
        ['border-bottom', `${v('tbar-border-width')} solid ${v('color-border')}`],
        ['background', v('color-surface')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.tbar__title',
      decls: [
        ['font-size', v('tbar-font-size')],
        ['color', v('color-text')],
        ['line-height', v('line-height-tight')],
        ['flex', 'auto'],
        ['text-align', 'center']
      ]
    },
    {
      sel: '.tbar__ctl',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('tbar-ctl-size')],
        ['height', v('tbar-ctl-size')],
        ['border', 'none'],
        ['border-radius', v('radius-full')],
        ['background', v('color-border-strong')],
        ['cursor', 'pointer'],
        ['padding', '0']
      ]
    },
    {
      sel: '.tbar__ctl--close',
      decls: [['background', v('tbar-close-bg')]]
    }
  ],
  states: [
    {
      base: '.tbar__ctl',
      state: 'hover',
      decls: [['outline', `${v('focus-ring-width')} solid ${v('color-border-strong')}`]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '窗口标题栏', [
      demoRow([
        {
          tag: 'header',
          cls: 'tbar',
          part: 'tbar',
          children: [
            { tag: 'span', cls: 'tbar__title', part: 'tbar-title', text: '应用窗口' },
            { tag: 'button', cls: 'tbar__ctl', attrs: { type: 'button', 'aria-label': '最小化' } },
            { tag: 'button', cls: 'tbar__ctl', attrs: { type: 'button', 'aria-label': '最大化' } },
            {
              tag: 'button',
              cls: 'tbar__ctl tbar__ctl--close',
              part: 'tbar-close',
              attrs: { type: 'button', 'aria-label': '关闭' }
            }
          ]
        }
      ])
    ])
  }
}

export const STATUSBAR: ComponentRecipe = {
  id: 'statusbar',
  label: '状态栏',
  group: 'stat',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.stat',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['gap', v('stat-gap')],
        ['width', v('stat-width')],
        ['height', v('stat-height')],
        ['padding', `0 ${v('stat-padding-x')}`],
        ['border-top', `${v('stat-border-width')} solid ${v('color-border')}`],
        ['background', v('color-surface')],
        ['color', v('color-text-secondary')],
        ['font-size', v('stat-font-size')],
        ['line-height', v('line-height-tight')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.stat__sep',
      decls: [
        ['width', v('stat-border-width')],
        ['height', v('stat-sep-h')],
        ['background', v('color-border')],
        ['flex-shrink', '0']
      ]
    },
    {
      sel: '.stat__right',
      decls: [['margin-left', 'auto']]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    const seg = (text: string, right = false): PageNode => ({
      tag: 'span',
      cls: right ? 'stat__right' : undefined,
      text
    })
    return demoSection(theme, '状态栏', [
      demoRow([
        {
          tag: 'footer',
          cls: 'stat',
          part: 'stat',
          children: [
            seg('就绪'),
            { tag: 'span', cls: 'stat__sep' },
            seg('2 个文件'),
            seg('UTF-8 · LF', true)
          ]
        }
      ])
    ])
  }
}

export const SPLITTER: ComponentRecipe = {
  id: 'splitter',
  label: '分栏条',
  group: 'spl',
  stateNames: ['默认', '悬停', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.spl',
      decls: [
        ['display', 'block'],
        ['width', v('spl-width')],
        ['height', v('spl-length')],
        ['background', v('color-border')],
        ['cursor', 'col-resize'],
        ['flex-shrink', '0']
      ]
    },
    {
      sel: '.spl--v',
      decls: [
        ['width', v('spl-length')],
        ['height', v('spl-width')],
        ['cursor', 'row-resize']
      ]
    }
  ],
  states: [
    {
      base: '.spl',
      state: 'hover',
      decls: [['background', v('color-primary')]]
    },
    {
      base: '.spl',
      state: 'focus',
      decls: [['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '分栏条', [
      demoRow([
        demoLabel('竖分栏'),
        {
          tag: 'span',
          cls: 'spl',
          part: 'spl',
          attrs: { role: 'separator', 'aria-orientation': 'vertical', tabindex: '0' }
        }
      ])
    ])
  }
}

export const PHONE_NAVBAR: ComponentRecipe = {
  id: 'phone-navbar',
  label: '手机导航栏',
  group: 'pnav',
  stateNames: ['默认', '按下'],
  requiredStates: [':active'],
  rules: [
    {
      sel: '.pnav',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['width', v('pnav-width')],
        ['height', v('pnav-height')],
        ['padding', `0 ${v('pnav-padding-x')}`],
        ['background', v('color-surface')],
        ['border-bottom', `${v('pnav-border-width')} solid ${v('color-border')}`],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.pnav__back',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('pnav-back-size')],
        ['height', v('pnav-back-size')],
        ['border', 'none'],
        ['border-radius', v('radius-full')],
        ['background', 'transparent'],
        ['color', v('color-text')],
        ['cursor', 'pointer'],
        ['padding', '0']
      ]
    },
    {
      sel: '.pnav__back svg',
      decls: [
        ['width', v('pnav-icon-size')],
        ['height', v('pnav-icon-size')]
      ]
    },
    {
      sel: '.pnav__title',
      decls: [
        ['flex', 'auto'],
        ['text-align', 'center'],
        ['font-size', v('pnav-title-size')],
        ['font-weight', v('font-weight-semibold')],
        ['color', v('color-text')],
        ['line-height', v('line-height-tight')],
        // 左右各留一个按钮位,标题在可用区间内居中
        ['margin', `0 ${v('pnav-back-size')}`]
      ]
    }
  ],
  states: [
    {
      base: '.pnav__back',
      state: 'active',
      decls: [['background', v('color-pressed-bg')]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '手机导航栏', [
      demoRow([
        {
          tag: 'header',
          cls: 'pnav',
          part: 'pnav',
          children: [
            {
              tag: 'button',
              cls: 'pnav__back',
              part: 'pnav-back',
              attrs: { type: 'button', 'aria-label': '返回' },
              icon: 'app-back'
            },
            { tag: 'span', cls: 'pnav__title', part: 'pnav-title', text: '详情' }
          ]
        }
      ])
    ])
  }
}

export const SWIPE_ROW: ComponentRecipe = {
  id: 'swipe-row',
  label: '滑动操作行',
  group: 'swr',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.swr',
      decls: [
        ['display', 'flex'],
        ['width', v('swr-width')],
        ['height', v('swr-height')],
        ['border-radius', v('swr-radius')],
        ['overflow', 'hidden'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.swr__body',
      decls: [
        ['flex', 'auto'],
        ['display', 'flex'],
        ['align-items', 'center'],
        ['padding', `0 ${v('swr-padding-x')}`],
        ['background', v('color-surface')],
        ['color', v('color-text')],
        ['font-size', v('swr-font-size')],
        ['min-width', '0']
      ]
    },
    {
      sel: '.swr__act',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('swr-act-width')],
        ['border', 'none'],
        ['color', v('color-on-primary')],
        ['font-size', v('swr-font-size')],
        ['cursor', 'pointer'],
        ['flex-shrink', '0']
      ]
    },
    {
      sel: '.swr__act--danger',
      decls: [['background', v('swr-danger-bg')]]
    },
    {
      sel: '.swr__act--mute',
      decls: [['background', v('color-text-secondary')]]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    const act = (text: string, cls: string): PageNode => ({
      tag: 'button',
      cls: `swr__act ${cls}`,
      attrs: { type: 'button' },
      text
    })
    return demoSection(theme, '滑动操作行', [
      demoRow([
        {
          tag: 'div',
          cls: 'swr',
          part: 'swr',
          children: [
            {
              tag: 'div',
              cls: 'swr__body',
              children: [{ tag: 'span', text: '左滑出现的列表行' }]
            },
            act('归档', 'swr__act--mute'),
            act('删除', 'swr__act--danger')
          ]
        }
      ])
    ])
  }
}

export const PULL_REFRESH: ComponentRecipe = {
  id: 'pull-refresh',
  label: '下拉刷新',
  group: 'ptr',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.ptr',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['align-items', 'center'],
        ['gap', v('ptr-gap')],
        ['width', v('ptr-width')],
        ['padding', `${v('ptr-padding-y')} 0`],
        ['color', v('color-text-secondary')],
        ['font-size', v('ptr-font-size')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.ptr__ic',
      decls: [
        ['width', v('ptr-icon-size')],
        ['height', v('ptr-icon-size')],
        ['border-radius', v('radius-full')],
        ['border', `${v('ptr-border-width')} solid ${v('color-border')}`],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['background', v('color-surface')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.ptr__ic svg',
      decls: [
        ['width', v('ptr-icon')],
        ['height', v('ptr-icon')]
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '下拉刷新', [
      demoRow([
        {
          tag: 'div',
          cls: 'ptr',
          part: 'ptr',
          children: [
            { tag: 'span', cls: 'ptr__ic', part: 'ptr-ic', icon: 'demo-down' },
            { tag: 'span', text: '下拉刷新' }
          ]
        }
      ])
    ])
  }
}
