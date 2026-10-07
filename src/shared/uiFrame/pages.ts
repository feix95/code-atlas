// 典型页(M3-f,第 5.5 节 示例屏扩编):列表页 / 设置页 / 表单页。
// 结构完全复用组件配方产出的真实标签与 class(与演示页同一份 HTML 形态);
// 页面级样式只写布局,数值一律 var(--pg-*) / var(--page-*) / var(--space-*)。
import type { CssRule } from './recipes/types.ts'
import type { PageNode } from './types.ts'

const v = (name: string): string => `var(--${name})`

const btn = (variant: string, text: string): PageNode => ({
  tag: 'button',
  cls: `btn btn--${variant}`,
  attrs: { type: 'button' },
  text,
  part: 'btn-md'
})

const link = (text: string, current = false): PageNode => ({
  tag: 'a',
  cls: 'abar__link',
  attrs: { href: '#', ...(current ? { 'aria-current': 'page' } : {}) },
  text
})

/** 页面顶栏:标题 + 导航 + 操作区(与 appbar 配方同构) */
const appbar = (title: string, navTexts: string[]): PageNode => ({
  tag: 'header',
  cls: 'abar',
  part: 'abar',
  children: [
    { tag: 'span', cls: 'abar__title', part: 'abar-title', text: title },
    {
      tag: 'nav',
      cls: 'abar__nav',
      children: navTexts.map((t, i) => link(t, i === 0))
    },
    { tag: 'span', cls: 'abar__spacer' },
    link('登录')
  ]
})

const liRow = (title: string, sub: string | null, trail: PageNode | null): PageNode => ({
  tag: 'div',
  cls: `li${sub ? ' li--two' : ''}`,
  part: 'li',
  children: [
    { tag: 'span', cls: 'li__lead', icon: 'demo-li', part: 'li-lead' },
    {
      tag: 'div',
      cls: 'li__main',
      children: [
        { tag: 'div', cls: 'li__title', text: title },
        ...(sub ? [{ tag: 'div', cls: 'li__sub', text: sub }] : [])
      ]
    },
    ...(trail ? [trail] : [])
  ]
})

const arrow: PageNode = { tag: 'span', cls: 'li__trail', icon: 'demo-arrow', part: 'li-trail' }

const toggle = (on = false): PageNode => ({
  tag: 'label',
  cls: 'sw sw--sm',
  children: [
    { tag: 'input', cls: 'sw__in', attrs: { type: 'checkbox', ...(on ? { checked: '' } : {}) } },
    { tag: 'span', cls: 'sw__thumb' }
  ]
})

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

const fieldLabel = (text: string): PageNode => ({
  tag: 'span',
  cls: 'pg-label',
  text
})

const textField = (placeholder: string): PageNode => ({
  tag: 'label',
  cls: 'ipt-box',
  part: 'ipt-box',
  children: [{ tag: 'input', cls: 'ipt', attrs: { type: 'text', placeholder } }]
})

// ── 列表页(第 5.5 节)──

export const LIST_PAGE = {
  id: 'list',
  title: '列表页',
  body: [
    appbar('项目列表', ['项目', '成员', '统计']),
    {
      tag: 'main',
      cls: 'pg',
      children: [
        {
          tag: 'div',
          cls: 'pg-toolbar',
          children: [
            { tag: 'h1', cls: 'pg-title', text: '全部项目' },
            { tag: 'span', cls: 'pg-spacer' },
            {
              tag: 'label',
              cls: 'srch',
              part: 'srch',
              children: [
                { tag: 'span', cls: 'srch__ic', part: 'srch-ic', icon: 'demo-search' } as PageNode,
                {
                  tag: 'input',
                  cls: 'srch__in',
                  attrs: { type: 'search', placeholder: '搜索项目…' }
                }
              ]
            },
            btn('solid', '新建项目')
          ]
        },
        {
          tag: 'div',
          cls: 'pg-card',
          children: [
            liRow('品牌视觉改版', '今天更新 · 3 人协作', arrow),
            liRow('移动端 2.0', '昨天更新 · 5 人协作', arrow),
            liRow('官网文案重写', '本周更新 · 2 人协作', arrow),
            liRow('数据看板', '上周更新 · 4 人协作', arrow),
            liRow('遗留项目', null, arrow)
          ]
        },
        {
          tag: 'nav',
          cls: 'pgn',
          attrs: { 'aria-label': '分页' },
          children: [
            pgnBtn('‹', false, true),
            pgnBtn('1', true),
            pgnBtn('2'),
            pgnBtn('3'),
            pgnBtn('›')
          ]
        }
      ]
    }
  ]
}

// ── 设置页(第 5.5 节)──

export const SETTINGS_PAGE = {
  id: 'settings',
  title: '设置页',
  body: [
    appbar('设置', ['通用', '账号', '关于']),
    {
      tag: 'main',
      cls: 'pg pg--narrow',
      children: [
        { tag: 'h1', cls: 'pg-title', text: '设置' },
        {
          tag: 'section',
          cls: 'pg-card',
          children: [
            { tag: 'h2', cls: 'pg-subtitle', text: '个人资料' },
            {
              tag: 'div',
              cls: 'pg-profile',
              children: [
                { tag: 'span', cls: 'avt avt--lg', children: [{ tag: 'span', text: '葵' }] },
                {
                  tag: 'div',
                  cls: 'li__main',
                  children: [
                    { tag: 'div', cls: 'li__title', text: '小葵' },
                    { tag: 'div', cls: 'li__sub', text: 'kui@example.com' }
                  ]
                },
                { tag: 'span', cls: 'abar__spacer' },
                btn('ghost', '编辑')
              ]
            }
          ]
        },
        {
          tag: 'section',
          cls: 'pg-card',
          children: [
            { tag: 'h2', cls: 'pg-subtitle', text: '偏好' },
            liRow('通知', '推送与邮件提醒', toggle(true)),
            liRow('自动保存', '编辑内容实时保存', toggle(true)),
            liRow('数据同步', '跨设备同步设置', toggle()),
            { tag: 'span', cls: 'div', attrs: { role: 'separator' } },
            liRow('语言', '跟随系统', arrow),
            liRow('主题', '亮色', arrow)
          ]
        },
        {
          tag: 'section',
          cls: 'pg-card',
          children: [
            { tag: 'h2', cls: 'pg-subtitle', text: '账户' },
            {
              tag: 'div',
              cls: 'pg-actions',
              children: [btn('outline', '退出登录'), btn('solid', '保存修改')]
            }
          ]
        }
      ]
    }
  ]
}

// ── 表单页(第 5.5 节)──

export const FORM_PAGE = {
  id: 'form',
  title: '表单页',
  body: [
    appbar('新建', ['表单', '草稿', '模板']),
    {
      tag: 'main',
      cls: 'pg pg--narrow',
      children: [
        { tag: 'h1', cls: 'pg-title', text: '新建项目' },
        {
          tag: 'form',
          cls: 'pg-card pg-form',
          attrs: { action: '#', method: 'post' },
          children: [
            fieldLabel('项目名称'),
            textField('给项目起个名字'),
            fieldLabel('简介'),
            {
              tag: 'textarea',
              cls: 'ta',
              part: 'ta',
              attrs: { placeholder: '一句话说明这个项目做什么' }
            },
            fieldLabel('类型'),
            {
              tag: 'label',
              cls: 'sel-box',
              part: 'sel-box',
              children: [
                {
                  tag: 'select',
                  cls: 'sel',
                  children: ['内部项目', '对外产品', '临时任务'].map((t): PageNode => ({
                    tag: 'option',
                    text: t,
                    attrs: { value: t }
                  }))
                },
                { tag: 'span', cls: 'sel-ic', part: 'sel-ic', icon: 'demo-down' } as PageNode
              ]
            },
            fieldLabel('可见范围'),
            {
              tag: 'div',
              cls: 'pg-radios',
              children: ['仅自己', '团队可见', '公开'].map((t, i): PageNode => ({
                tag: 'label',
                cls: 'rdo',
                children: [
                  {
                    tag: 'input',
                    cls: 'rdo__in',
                    attrs: { type: 'radio', name: 'scope', ...(i === 0 ? { checked: '' } : {}) }
                  },
                  { tag: 'span', cls: 'rdo__dot' },
                  { tag: 'span', text: t }
                ]
              }))
            },
            {
              tag: 'label',
              cls: 'chk',
              children: [
                { tag: 'input', cls: 'chk__in', attrs: { type: 'checkbox', checked: '' } },
                { tag: 'span', cls: 'chk__box', icon: 'demo-check' } as PageNode,
                { tag: 'span', text: '创建后通知团队成员' }
              ]
            },
            {
              tag: 'div',
              cls: 'pg-actions',
              children: [btn('ghost', '取消'), btn('solid', '创建项目')]
            }
          ]
        }
      ]
    }
  ]
}

// ── 页面布局样式(全部变量值;第 13.2 节 规则 11)──

const pgBase: CssRule[] = [
  {
    sel: '.pg',
    decls: [
      ['box-sizing', 'border-box'],
      ['display', 'flex'],
      ['flex-direction', 'column'],
      ['gap', v('pg-section-gap')],
      ['max-width', v('pg-content-max')],
      ['margin', '0 auto'],
      ['padding', `${v('pg-pad-y')} ${v('page-gutter')}`]
    ]
  },
  {
    sel: '.pg--narrow',
    decls: [['max-width', v('pg-narrow-max')]]
  },
  {
    sel: '.pg-title',
    decls: [
      ['margin', '0'],
      ['font-size', v('pg-title-size')],
      ['font-weight', v('font-weight-bold')],
      ['line-height', v('line-height-tight')],
      ['color', v('color-text')]
    ]
  },
  {
    sel: '.pg-subtitle',
    decls: [
      ['margin', `0 0 ${v('pg-field-gap')}`],
      ['font-size', v('font-size-lg')],
      ['font-weight', v('font-weight-semibold')],
      ['line-height', v('line-height-normal')],
      ['color', v('color-text')]
    ]
  },
  {
    sel: '.pg-card',
    decls: [
      ['box-sizing', 'border-box'],
      ['display', 'flex'],
      ['flex-direction', 'column'],
      ['background', v('color-surface')],
      ['border', `${v('border-width-1')} solid ${v('color-border')}`],
      ['border-radius', v('radius-lg')],
      ['padding', v('pg-card-pad')]
    ]
  },
  {
    sel: '.pg-toolbar',
    decls: [
      ['display', 'flex'],
      ['align-items', 'center'],
      ['gap', v('pg-toolbar-gap')],
      ['flex-wrap', 'wrap']
    ]
  },
  { sel: '.pg-spacer', decls: [['flex', 'auto']] },
  { sel: '.pg-toolbar .pg-title', decls: [['flex', 'none']] },
  {
    sel: '.pg-label',
    decls: [
      ['font-size', v('font-size-md')],
      ['font-weight', v('font-weight-medium')],
      ['color', v('color-text')],
      ['line-height', v('line-height-normal')]
    ]
  },
  {
    sel: '.pg-actions',
    decls: [
      ['display', 'flex'],
      ['justify-content', 'flex-end'],
      ['gap', v('pg-actions-gap')],
      ['margin-top', v('pg-field-gap')]
    ]
  },
  {
    sel: '.pg-form',
    decls: [['gap', v('pg-field-gap')]]
  },
  {
    sel: '.pg-profile',
    decls: [
      ['display', 'flex'],
      ['align-items', 'center'],
      ['gap', v('li-gap')]
    ]
  },
  {
    sel: '.pg-radios',
    decls: [
      ['display', 'flex'],
      ['gap', v('pg-toolbar-gap')],
      ['flex-wrap', 'wrap']
    ]
  }
]

export const LIST_RULES: CssRule[] = [
  ...pgBase,
  {
    sel: '.pgn',
    decls: [
      ['justify-content', 'center'],
      ['display', 'flex']
    ]
  },
  {
    sel: '.pg-card .li',
    decls: [
      ['width', 'auto'],
      ['flex', 'none']
    ]
  },
  {
    sel: '.pg-card .li:last-child',
    decls: [['border-bottom', 'none']]
  }
]

export const SETTINGS_RULES: CssRule[] = [
  ...pgBase,
  {
    sel: '.pg-card .li',
    decls: [
      ['width', 'auto'],
      ['flex', 'none']
    ]
  },
  { sel: '.pg-card .li:last-child', decls: [['border-bottom', 'none']] },
  { sel: '.pg-card .div', decls: [['margin', `${v('pg-field-gap')} 0`]] }
]

export const FORM_RULES: CssRule[] = [
  ...pgBase,
  { sel: '.pg-form .ipt-box', decls: [['width', 'auto']] },
  { sel: '.pg-form .ta', decls: [['width', 'auto']] },
  { sel: '.pg-form .sel-box', decls: [['width', 'auto']] }
]
