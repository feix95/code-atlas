// 反馈类配方合集:toast、banner、progress、spinner、skeleton、empty、badge。
// 均为状态展示件,无焦点/悬停要求(states 为空即豁免体检状态检查)。
import type { PageNode, ThemeName } from '../types.ts'
import { demoCol, demoLabel, demoRow, demoSection, v, type ComponentRecipe } from './kit.ts'

const toast = (cls: string, text: string): PageNode => ({
  tag: 'div',
  cls: `toast${cls ? ` ${cls}` : ''}`,
  part: 'toast',
  attrs: { role: 'status' },
  children: [
    { tag: 'span', cls: 'toast__text', text },
    { tag: 'button', cls: 'toast__act', attrs: { type: 'button' }, text: '撤销' }
  ]
})

export const TOAST: ComponentRecipe = {
  id: 'toast',
  label: '轻提示',
  group: 'toast',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.toast',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['gap', v('toast-gap')],
        ['padding', `${v('toast-padding-y')} ${v('toast-padding-x')}`],
        ['border-radius', v('toast-radius')],
        ['background', v('toast-bg')],
        ['color', v('toast-fg')],
        ['box-shadow', v('toast-shadow')],
        ['font-size', v('toast-font-size')],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.toast__act',
      decls: [
        ['border', 'none'],
        ['background', 'transparent'],
        ['color', v('color-primary')],
        ['font-size', v('toast-font-size')],
        ['font-weight', v('font-weight-medium')],
        ['cursor', 'pointer']
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '轻提示', [
      demoRow([demoLabel('提示'), toast('', '已保存'), toast('', '删除成功')])
    ])
  }
}

const banner = (cls: string, text: string): PageNode => ({
  tag: 'div',
  cls: `banner${cls ? ` ${cls}` : ''}`,
  part: 'banner',
  attrs: { role: 'alert' },
  children: [{ tag: 'span', cls: 'banner__text', text }]
})

export const BANNER: ComponentRecipe = {
  id: 'banner',
  label: '横幅',
  group: 'bnr',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.banner',
      decls: [
        ['display', 'flex'],
        ['align-items', 'center'],
        ['width', v('bnr-width')],
        ['padding', `${v('bnr-padding-y')} ${v('bnr-padding-x')}`],
        ['border-radius', v('bnr-radius')],
        ['border', `${v('bnr-border-width')} solid ${v('color-border')}`],
        ['background', v('color-surface')],
        ['color', v('color-text')],
        ['font-size', v('bnr-font-size')],
        ['line-height', v('line-height-normal')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.banner--info',
      decls: [
        ['background', v('color-primary-subtle')],
        ['border-color', v('color-primary')],
        ['color', v('color-primary')]
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '横幅', [
      demoCol([
        banner('', '版本已更新，部分内容需要刷新'),
        banner('banner--info', '新功能上线：支持导入现有样式')
      ])
    ])
  }
}

export const PROGRESS: ComponentRecipe = {
  id: 'progress',
  label: '进度条',
  group: 'prog',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.prog',
      decls: [
        ['display', 'block'],
        ['width', v('prog-width')],
        ['height', v('prog-height')],
        ['border-radius', v('radius-full')],
        ['background', v('prog-track-bg')],
        ['overflow', 'hidden']
      ]
    },
    {
      sel: '.prog__fill',
      decls: [
        ['display', 'block'],
        ['height', 'inherit'],
        // 演示固定进度:实现时按真实进度改 inline width 或自定义变量
        ['width', v('prog-fill')],
        ['border-radius', v('radius-full')],
        ['background', v('color-primary')]
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    const bar = (now: string): PageNode => ({
      tag: 'div',
      cls: 'prog',
      part: 'prog',
      attrs: { role: 'progressbar', 'aria-valuenow': now },
      children: [{ tag: 'span', cls: 'prog__fill', part: 'prog-fill' }]
    })
    return demoSection(theme, '进度条', [demoCol([bar('30'), bar('60'), bar('90')])])
  }
}

export const SPINNER: ComponentRecipe = {
  id: 'spinner',
  label: '加载圈',
  group: 'spin',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.spin',
      decls: [
        ['display', 'inline-block'],
        ['width', v('spin-size')],
        ['height', v('spin-size')],
        ['border-radius', v('radius-full')],
        ['border', `${v('spin-width')} solid ${v('spin-track')}`],
        ['border-top-color', v('color-primary')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.spin--sm',
      decls: [
        ['width', v('spin-size-sm')],
        ['height', v('spin-size-sm')],
        ['border-width', v('spin-width-sm')]
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '加载圈', [
      demoRow([
        demoLabel('加载'),
        { tag: 'span', cls: 'spin', part: 'spin', attrs: { role: 'progressbar' } },
        { tag: 'span', cls: 'spin spin--sm', part: 'spin-sm', attrs: { role: 'progressbar' } }
      ])
    ])
  }
}

export const SKELETON: ComponentRecipe = {
  id: 'skeleton',
  label: '骨架屏',
  group: 'skl',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.skl',
      decls: [
        ['display', 'block'],
        ['border-radius', v('skl-radius')],
        ['background', v('skl-bg')]
      ]
    },
    {
      sel: '.skl--line',
      decls: [
        ['height', v('skl-line-h')],
        ['width', v('skl-line-w')]
      ]
    },
    {
      sel: '.skl--line.skl--w60',
      decls: [['width', v('skl-line-w60')]]
    },
    {
      sel: '.skl--line.skl--w40',
      decls: [['width', v('skl-line-w40')]]
    },
    {
      sel: '.skl--circle',
      decls: [
        ['width', v('skl-circle')],
        ['height', v('skl-circle')],
        ['border-radius', v('radius-full')]
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    const line = (cls = 'skl--line'): PageNode => ({ tag: 'span', cls: `skl ${cls}`, part: 'skl' })
    return demoSection(theme, '骨架屏', [
      demoRow([
        demoLabel('占位'),
        { tag: 'span', cls: 'skl skl--circle' },
        demoCol([line(), line('skl--line skl--w60'), line('skl--line skl--w40')])
      ])
    ])
  }
}

export const EMPTY: ComponentRecipe = {
  id: 'empty',
  label: '空状态',
  group: 'emp',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.emp',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['align-items', 'center'],
        ['gap', v('emp-gap')],
        ['width', v('emp-width')],
        ['padding', `${v('emp-padding-y')} ${v('emp-padding-x')}`],
        ['text-align', 'center'],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.emp__icon',
      decls: [
        ['width', v('emp-icon-box')],
        ['height', v('emp-icon-box')],
        ['display', 'flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['border-radius', v('radius-full')],
        ['background', v('color-hover-bg')],
        ['color', v('color-text-secondary')]
      ]
    },
    {
      sel: '.emp__icon svg',
      decls: [
        ['width', v('emp-icon')],
        ['height', v('emp-icon')]
      ]
    },
    {
      sel: '.emp__title',
      decls: [
        ['font-size', v('emp-title-size')],
        ['font-weight', v('font-weight-semibold')],
        ['color', v('color-text')],
        ['line-height', v('line-height-tight')]
      ]
    },
    {
      sel: '.emp__text',
      decls: [
        ['font-size', v('emp-text-size')],
        ['color', v('color-text-secondary')],
        ['line-height', v('line-height-normal')]
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    return demoSection(theme, '空状态', [
      demoRow([
        {
          tag: 'div',
          cls: 'emp',
          part: 'emp',
          children: [
            { tag: 'span', cls: 'emp__icon', part: 'emp-icon', icon: 'demo-li' },
            { tag: 'span', cls: 'emp__title', text: '还没有内容' },
            { tag: 'span', cls: 'emp__text', text: '开始添加后，项目会出现在这里。' }
          ]
        }
      ])
    ])
  }
}

export const BADGE: ComponentRecipe = {
  id: 'badge',
  label: '徽标',
  group: 'bdg',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.bdg',
      decls: [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['min-width', v('bdg-min')],
        ['height', v('bdg-height')],
        ['padding', `0 ${v('bdg-padding-x')}`],
        ['border-radius', v('radius-full')],
        ['background', v('color-primary')],
        ['color', v('color-on-primary')],
        ['font-size', v('bdg-font-size')],
        ['font-weight', v('font-weight-medium')],
        ['line-height', v('line-height-tight')],
        ['box-sizing', 'border-box']
      ]
    },
    {
      sel: '.bdg--dot',
      decls: [
        ['min-width', v('bdg-dot')],
        ['width', v('bdg-dot')],
        ['height', v('bdg-dot')],
        ['padding', '0']
      ]
    },
    {
      sel: '.bdg--quiet',
      decls: [
        ['background', v('color-hover-bg')],
        ['color', v('color-text')]
      ]
    }
  ],
  states: [],
  demo(theme: ThemeName): PageNode {
    const bdg = (cls: string, text = ''): PageNode => ({
      tag: 'span',
      cls: `bdg${cls ? ` ${cls}` : ''}`,
      part: 'bdg',
      text
    })
    return demoSection(theme, '徽标', [
      demoRow([
        demoLabel('计数'),
        bdg('', '3'),
        bdg('', '12'),
        bdg('bdg--quiet', '99+'),
        bdg('bdg--dot')
      ])
    ])
  }
}
