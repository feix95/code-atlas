// 浮层类配方合集:menu(下拉/右键菜单)、pop(气泡卡)、dlg(对话框)、dwr(抽屉)、
// sheet(底部面板,手机)、asheet(动作菜单,手机)。
// 规格包里浮层以静态形态呈现:结构 + 定位说明,不含开合逻辑。
import type { PageNode, ThemeName } from '../types.ts'
import { demoRow, demoSection, v, type ComponentRecipe } from './kit.ts'

const menuItem = (text: string, danger = false): PageNode => ({
  tag: 'button',
  cls: `menu__it${danger ? ' menu__it--danger' : ''}`,
  attrs: { type: 'button', role: 'menuitem' },
  text
})

export const MENU: ComponentRecipe = {
  id: 'menu',
  label: '下拉菜单',
  group: 'menu',
  stateNames: ['默认', '悬停', '焦点'],
  requiredStates: [':hover', ':focus-visible'],
  rules: [
    {
      sel: '.menu',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['min-width', v('menu-min-width')],
        ['padding', v('menu-pad')],
        ['border', `${v('menu-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('menu-radius')],
        ['background', v('color-surface')],
        ['box-shadow', v('menu-shadow')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.menu__it',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['width', 'inherit'],
        ['height', v('menu-item-height')],
        ['padding', `0 ${v('menu-item-padding-x')}`],
        ['border', 'none'],
        ['border-radius', v('menu-item-radius')],
        ['background', 'transparent'],
        ['color', v('color-text')],
        ['font-size', v('menu-font-size')],
        ['text-align', 'left'],
        ['cursor', 'pointer'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.menu__it--danger',
      decls: [['color', v('menu-danger')]]
    },
    {
      sel: '.menu__sep',
      decls: [
        ['height', v('menu-border-width')],
        ['margin', `${v('menu-pad')} 0`],
        ['background', v('color-border')],
        ['flex-shrink', '0']
      ]
    }
  ],
  states: [
    {
      base: '.menu__it',
      state: 'hover',
      decls: [['background', v('color-hover-bg')]]
    },
    {
      base: '.menu__it',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', `-${v('focus-ring-width')}`]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '下拉菜单', [
      demoRow([
        {
          tag: 'div',
          cls: 'menu',
          part: 'menu',
          attrs: { role: 'menu' },
          children: [
            menuItem('重命名'),
            menuItem('复制'),
            { tag: 'span', cls: 'menu__sep', part: 'menu-sep' },
            menuItem('删除', true)
          ]
        }
      ])
    ])
  }
}

export const POPOVER: ComponentRecipe = {
  id: 'popover',
  label: '气泡卡',
  group: 'pop',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.pop',
      decls: [
        ['display', 'block'],
        ['width', v('pop-width')],
        ['padding', v('pop-padding')],
        ['border', `${v('pop-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('pop-radius')],
        ['background', v('color-surface')],
        ['box-shadow', v('pop-shadow')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.pop__title',
      decls: [
        ['font-size', v('pop-title-size')],
        ['font-weight', v('font-weight-semibold')],
        ['color', v('color-text')],
        ['margin', `0 0 ${v('pop-title-gap')}`],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.pop__text',
      decls: [
        ['font-size', v('pop-text-size')],
        ['color', v('color-text-secondary')],
        ['line-height', v('line-height-normal')],
        ['margin', '0']
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '气泡卡', [
      demoRow([
        {
          tag: 'div',
          cls: 'pop',
          part: 'pop',
          children: [
            { tag: 'p', cls: 'pop__title', text: '快捷编辑' },
            { tag: 'p', cls: 'pop__text', text: '点击条目可直接在这里修改数值。' }
          ]
        }
      ])
    ])
  }
}

export const DIALOG: ComponentRecipe = {
  id: 'dialog',
  label: '对话框',
  group: 'dlg',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.dlg-mask',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('dlg-mask-w')],
        ['height', v('dlg-mask-h')],
        ['background', v('dlg-mask-bg')]
      ]
    },
    {
      sel: '.dlg',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['width', v('dlg-width')],
        ['padding', v('dlg-padding')],
        ['gap', v('dlg-gap')],
        ['border-radius', v('dlg-radius')],
        ['background', v('color-surface')],
        ['box-shadow', v('dlg-shadow')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.dlg__title',
      decls: [
        ['font-size', v('dlg-title-size')],
        ['font-weight', v('font-weight-semibold')],
        ['color', v('color-text')],
        ['margin', '0'],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.dlg__text',
      decls: [
        ['font-size', v('dlg-text-size')],
        ['color', v('color-text-secondary')],
        ['line-height', v('line-height-normal')],
        ['margin', '0']
      ]
    },
    {
      sel: '.dlg__actions',
      decls: [
        ['display', 'flex'],
        ['justify-content', 'flex-end'],
        ['gap', v('dlg-actions-gap')],
        ['margin-top', v('dlg-actions-margin')]
      ]
    }
  ],
  states: [],
  demoDeps: ['button'],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '对话框', [
      demoRow([
        {
          tag: 'div',
          cls: 'dlg-mask',
          children: [
            {
              tag: 'div',
              cls: 'dlg',
              part: 'dlg',
              attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': '确认删除' },
              children: [
                { tag: 'h3', cls: 'dlg__title', text: '删除这条记录?' },
                { tag: 'p', cls: 'dlg__text', text: '删除后不可恢复,确认继续吗。' },
                {
                  tag: 'div',
                  cls: 'dlg__actions',
                  children: [
                    {
                      tag: 'button',
                      cls: 'btn btn--ghost btn--md',
                      attrs: { type: 'button' },
                      text: '取消'
                    },
                    {
                      tag: 'button',
                      cls: 'btn btn--solid btn--md',
                      attrs: { type: 'button' },
                      text: '删除'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ])
    ])
  }
}

export const DRAWER: ComponentRecipe = {
  id: 'drawer',
  label: '抽屉',
  group: 'dwr',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.dwr-stage',
      decls: [
        ['position', 'relative'],
        ['display', 'flex'],
        ['width', v('dwr-stage-w')],
        ['height', v('dwr-stage-h')],
        ['background', v('color-bg')],
        ['overflow', 'hidden']
      ]
    },
    {
      sel: '.dwr',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['width', v('dwr-width')],
        ['height', 'inherit'],
        ['padding', v('dwr-padding')],
        ['gap', v('dwr-gap')],
        ['border-left', `${v('dwr-border-width')} solid ${v('color-border')}`],
        ['background', v('color-surface')],
        ['box-shadow', v('dwr-shadow')],
        ['margin-left', 'auto'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.dwr__title',
      decls: [
        ['font-size', v('dwr-title-size')],
        ['font-weight', v('font-weight-semibold')],
        ['color', v('color-text')],
        ['margin', '0'],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.dwr__text',
      decls: [
        ['font-size', v('dwr-text-size')],
        ['color', v('color-text-secondary')],
        ['line-height', v('line-height-normal')],
        ['margin', '0']
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '抽屉', [
      demoRow([
        {
          tag: 'div',
          cls: 'dwr-stage',
          children: [
            {
              tag: 'aside',
              cls: 'dwr',
              part: 'dwr',
              attrs: { 'aria-label': '详情面板' },
              children: [
                { tag: 'h3', cls: 'dwr__title', text: '详情' },
                { tag: 'p', cls: 'dwr__text', text: '从右侧滑出的面板,用来放详情或表单。' }
              ]
            }
          ]
        }
      ])
    ])
  }
}

export const SHEET: ComponentRecipe = {
  id: 'sheet',
  label: '底部面板',
  group: 'sht',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.sht-stage',
      decls: [
        ['position', 'relative'],
        ['display', 'flex'],
        ['align-items', 'flex-end'],
        ['width', v('sht-stage-w')],
        ['height', v('sht-stage-h')],
        ['background', v('sht-mask-bg')],
        ['overflow', 'hidden']
      ]
    },
    {
      sel: '.sht',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['width', 'inherit'],
        [
          'padding',
          `${v('sht-padding-y')} ${v('sht-padding-x')} calc(${v('sht-padding-y')} + ${v('app-safe-bottom')})`
        ],
        ['gap', v('sht-gap')],
        ['border-radius', `${v('sht-radius')} ${v('sht-radius')} 0 0`],
        ['background', v('color-surface')],
        ['box-shadow', v('sht-shadow')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.sht__grab',
      decls: [
        ['align-self', 'center'],
        ['width', v('sht-grab-w')],
        ['height', v('sht-grab-h')],
        ['border-radius', v('radius-full')],
        ['background', v('color-border-strong')]
      ]
    }
  ],
  states: [],
  demoDeps: ['list-row'],
  demo(theme: ThemeName): PageNode {
    const row = (text: string): PageNode => ({
      tag: 'div',
      cls: 'li',
      children: [
        { tag: 'div', cls: 'li__main', children: [{ tag: 'div', cls: 'li__title', text }] }
      ]
    })
    return demoSection(theme, '底部面板', [
      demoRow([
        {
          tag: 'div',
          cls: 'sht-stage',
          children: [
            {
              tag: 'div',
              cls: 'sht',
              part: 'sht',
              attrs: { role: 'dialog', 'aria-label': '底部面板' },
              children: [
                { tag: 'span', cls: 'sht__grab', part: 'sht-grab' },
                row('选项一'),
                row('选项二')
              ]
            }
          ]
        }
      ])
    ])
  }
}

export const ACTION_SHEET: ComponentRecipe = {
  id: 'action-sheet',
  label: '动作菜单',
  group: 'ash',
  stateNames: ['默认', '按下'],
  requiredStates: [':active'],
  rules: [
    {
      sel: '.ash',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['gap', v('ash-gap')],
        ['width', v('ash-width')],
        ['padding', v('ash-pad')],
        ['background', v('ash-stage-bg')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.ash__group',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['border-radius', v('ash-radius')],
        ['background', v('color-surface')],
        ['overflow', 'hidden']
      ]
    },
    {
      sel: '.ash__it',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['height', v('ash-item-height')],
        ['border', 'none'],
        ['background', 'transparent'],
        ['color', v('color-primary')],
        ['font-size', v('ash-font-size')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.ash__it + .ash__it',
      decls: [['border-top', `${v('ash-border-width')} solid ${v('color-border')}`]]
    },
    {
      sel: '.ash__it--danger',
      decls: [['color', v('ash-danger')]]
    },
    {
      sel: '.ash__it--cancel',
      decls: [['font-weight', v('font-weight-semibold')]]
    }
  ],
  states: [
    {
      base: '.ash__it',
      state: 'active',
      decls: [['background', v('color-pressed-bg')]]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const it = (text: string, cls = ''): PageNode => ({
      tag: 'button',
      cls: `ash__it${cls ? ` ${cls}` : ''}`,
      attrs: { type: 'button' },
      text
    })
    return demoSection(theme, '动作菜单', [
      demoRow([
        {
          tag: 'div',
          cls: 'ash',
          part: 'ash',
          children: [
            {
              tag: 'div',
              cls: 'ash__group',
              children: [it('分享'), it('收藏'), it('删除', 'ash__it--danger')]
            },
            {
              tag: 'div',
              cls: 'ash__group',
              children: [it('取消', 'ash__it--cancel')]
            }
          ]
        }
      ])
    ])
  }
}
