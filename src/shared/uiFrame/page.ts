// 固定示例页(§5.5 示例屏、§19 M0):落地页结构 + 页面布局样式。
// 结构沿用 2026-10-02 实测页(§23.1);每个元素写明标签、class、属性与链接(规则 6)。
import type { CssRule } from './recipes/types.ts'
import type { PageNode } from './types.ts'

const v = (name: string): string => `var(--${name})`

const button = (variant: string, text: string, size = ''): PageNode => ({
  tag: 'button',
  cls: `btn btn--${variant}${size ? ` btn--${size}` : ''}`,
  attrs: { type: 'button' },
  text,
  part: `btn-${size || 'md'}`
})

const feature = (
  slot: 'feature-1' | 'feature-2' | 'feature-3',
  title: string,
  text: string
): PageNode => ({
  tag: 'div',
  cls: 'card',
  part: 'card',
  children: [
    { tag: 'div', cls: 'card__icon', icon: slot, part: 'card-icon-box' },
    { tag: 'h3', cls: 'card__title', text: title },
    { tag: 'p', cls: 'card__text', text }
  ]
})

export const HOME_PAGE: {
  id: string
  title: string
  width: number
  height: number
  body: PageNode[]
} = {
  id: 'home',
  title: '首页',
  width: 1280,
  height: 800,
  body: [
    {
      tag: 'header',
      cls: 'page-header',
      part: 'page-header',
      children: [
        { tag: 'div', cls: 'page-logo', text: 'BeatFit' },
        {
          tag: 'nav',
          cls: 'page-nav',
          children: ['功能', '玩法', '关于'].map((text) => ({
            tag: 'a',
            attrs: { href: '#' },
            text
          }))
        },
        {
          tag: 'div',
          cls: 'page-actions',
          children: [button('ghost', '登录'), button('solid', '开始使用')]
        }
      ]
    },
    {
      tag: 'main',
      children: [
        {
          tag: 'section',
          cls: 'page-hero',
          part: 'page-hero',
          children: [
            { tag: 'h1', cls: 'page-hero-title', text: '跟着节拍,动起来' },
            {
              tag: 'p',
              cls: 'page-hero-text',
              text: 'BeatFit 把你的训练组数和音乐节拍绑在一起,每一组都有节奏,每一次休息都刚刚好。'
            },
            {
              tag: 'div',
              cls: 'page-hero-actions',
              children: [
                { ...button('solid', '免费开始', 'lg'), icon: 'hero-cta', iconAt: 'end' },
                button('outline', '了解更多', 'lg')
              ]
            }
          ]
        },
        {
          tag: 'section',
          cls: 'page-features',
          children: [
            feature('feature-1', '节拍计时', '按 BPM 自动划分每组动作与休息时长。'),
            feature('feature-2', '音乐同步', '导入你的歌单,训练节奏跟着歌走。'),
            feature('feature-3', '训练记录', '组数、次数、重量,一页记完。')
          ]
        }
      ]
    },
    { tag: 'footer', cls: 'page-footer', text: '© 2026 BeatFit · 测试用示例页面' }
  ]
}

/** pages/home.css:页面布局样式,数值全部为变量(规则 11) */
export const HOME_RULES: CssRule[] = [
  {
    sel: 'body',
    decls: [
      ['background', v('color-bg')],
      ['color', v('color-text')],
      ['font-family', v('font-family')],
      ['font-size', v('font-size-lg')],
      ['font-weight', v('font-weight-regular')],
      ['line-height', v('line-height-normal')]
    ]
  },
  {
    sel: '.page-header',
    decls: [
      ['box-sizing', 'border-box'],
      ['display', 'flex'],
      ['align-items', 'center'],
      ['justify-content', 'space-between'],
      ['height', v('page-header-height')],
      ['padding', `0 ${v('page-gutter')}`],
      ['background', v('color-surface')],
      ['border-bottom', `${v('border-width-1')} solid ${v('color-border')}`]
    ]
  },
  {
    sel: '.page-logo',
    decls: [
      ['font-size', v('page-logo-size')],
      ['font-weight', v('font-weight-bold')],
      ['line-height', v('line-height-normal')]
    ]
  },
  {
    sel: '.page-nav',
    decls: [
      ['display', 'flex'],
      ['gap', v('page-nav-gap')]
    ]
  },
  {
    sel: '.page-nav a',
    decls: [
      ['font-size', v('font-size-md')],
      ['font-weight', v('font-weight-medium')],
      ['line-height', v('line-height-normal')],
      ['color', v('color-text-secondary')],
      ['text-decoration', 'none']
    ]
  },
  {
    sel: '.page-actions',
    decls: [
      ['display', 'flex'],
      ['gap', v('page-actions-gap')]
    ]
  },
  {
    sel: '.page-hero',
    decls: [
      ['padding', `${v('page-hero-pad-top')} ${v('page-gutter')} ${v('page-hero-pad-bottom')}`],
      ['text-align', 'center']
    ]
  },
  {
    sel: '.page-hero-title',
    decls: [
      ['max-width', v('page-hero-title-max')],
      ['margin', '0 auto'],
      ['font-size', v('page-hero-title-size')],
      ['font-weight', v('font-weight-bold')],
      ['line-height', v('line-height-tight')],
      ['letter-spacing', v('page-hero-title-tracking')]
    ]
  },
  {
    sel: '.page-hero-text',
    decls: [
      ['max-width', v('page-hero-text-max')],
      ['margin', `${v('page-hero-text-gap')} auto 0`],
      ['font-size', v('page-hero-text-size')],
      ['line-height', v('line-height-relaxed')],
      ['color', v('color-text-secondary')]
    ]
  },
  {
    sel: '.page-hero-actions',
    decls: [
      ['display', 'flex'],
      ['justify-content', 'center'],
      ['gap', v('page-hero-actions-spacing')],
      ['margin-top', v('page-hero-actions-gap')]
    ]
  },
  {
    sel: '.page-features',
    decls: [
      ['box-sizing', 'border-box'],
      ['display', 'grid'],
      ['grid-template-columns', `repeat(${v('page-features-columns')}, minmax(0, 1fr))`],
      ['gap', v('page-features-gap')],
      ['max-width', v('page-content-max')],
      ['margin', '0 auto'],
      ['padding', `0 ${v('page-gutter')} ${v('page-features-pad-bottom')}`]
    ]
  },
  {
    sel: '.page-footer',
    decls: [
      ['padding', v('page-footer-pad')],
      ['font-size', v('page-footer-text-size')],
      ['line-height', v('line-height-normal')],
      ['text-align', 'center'],
      ['color', v('color-text-secondary')],
      ['border-top', `${v('border-width-1')} solid ${v('color-border')}`]
    ]
  }
]
