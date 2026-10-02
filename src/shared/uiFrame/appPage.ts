// 手机端示例页(§5.4/§5.5):一个常见的 app 列表页结构——导航栏 / 搜索框 / 分段页签 /
// 列表卡片 / 底部主按钮。布局数值全部走 app-* 页面变量,顶端与底端留足系统安全区。
// 画布视口与设备外框由设备预设决定(见 devices.ts),页面本体只管内容结构。
import type { CssRule } from './recipes/types.ts'
import type { PageNode } from './types.ts'

const v = (name: string): string => `var(--${name})`

const navBtn = (icon: 'app-back' | 'app-bell', label: string): PageNode => ({
  tag: 'button',
  cls: 'ibtn ibtn--ghost ibtn--sm',
  attrs: { type: 'button', 'aria-label': label },
  icon,
  part: 'ibtn-sm'
})

const row = (lead: PageNode, title: string, sub: string, trail: PageNode): PageNode => ({
  tag: 'div',
  cls: 'li li--two',
  part: 'li',
  children: [
    lead,
    {
      tag: 'div',
      cls: 'li__main',
      children: [
        { tag: 'div', cls: 'li__title', text: title },
        { tag: 'div', cls: 'li__sub', text: sub }
      ]
    },
    trail
  ]
})

export const APP_PAGE: { id: string; title: string; body: PageNode[] } = {
  id: 'app',
  title: '示例应用页',
  body: [
    {
      tag: 'div',
      cls: 'app-screen',
      part: 'app-screen',
      children: [
        {
          tag: 'header',
          cls: 'app-nav',
          part: 'app-nav',
          children: [
            navBtn('app-back', '返回'),
            { tag: 'div', cls: 'app-nav-title', text: '今日训练' },
            navBtn('app-bell', '通知')
          ]
        },
        {
          tag: 'main',
          cls: 'app-body',
          part: 'app-body',
          children: [
            {
              tag: 'label',
              cls: 'ipt-box ipt-box--filled',
              part: 'ipt-box',
              children: [
                { tag: 'span', cls: 'ipt-ic', icon: 'app-search' },
                {
                  tag: 'input',
                  cls: 'ipt',
                  attrs: { type: 'search', placeholder: '搜索训练' }
                }
              ]
            },
            {
              tag: 'div',
              cls: 'tabs tabs--seg',
              part: 'tab',
              children: ['推荐', '力量', '有氧'].map((text, i) => {
                const n: PageNode = {
                  tag: 'button',
                  cls: 'tab',
                  attrs: { type: 'button' },
                  text
                }
                if (i === 0) n.attrs!['aria-selected'] = 'true'
                return n
              })
            },
            {
              tag: 'div',
              cls: 'app-list',
              children: [
                row(
                  { tag: 'span', cls: 'li__lead', icon: 'app-row-1', part: 'li-lead' },
                  '腿部训练',
                  '45 分钟 · 中强度',
                  {
                    tag: 'label',
                    cls: 'sw sw--sm',
                    children: [
                      {
                        tag: 'input',
                        cls: 'sw__in',
                        attrs: { type: 'checkbox', checked: '' }
                      },
                      { tag: 'span', cls: 'sw__thumb' }
                    ]
                  }
                ),
                row(
                  { tag: 'span', cls: 'li__lead', icon: 'app-row-2', part: 'li-lead' },
                  '有氧间歇',
                  '30 分钟 · 高强度',
                  { tag: 'span', cls: 'li__trail', icon: 'app-arrow', part: 'li-trail' }
                ),
                row(
                  { tag: 'span', cls: 'li__lead li__avatar', text: '力', part: 'li-avatar' },
                  '上肢力量',
                  '60 分钟 · 低强度',
                  { tag: 'span', cls: 'li__trail li__value', text: '4 组', part: 'li-value' }
                )
              ]
            },
            {
              tag: 'div',
              cls: 'app-cta',
              children: [
                {
                  tag: 'button',
                  cls: 'btn btn--solid btn--lg',
                  attrs: { type: 'button' },
                  text: '开始今日训练',
                  part: 'btn-lg'
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

/** pages/app.css:手机示例页布局样式,数值全部为变量(规则 11) */
export const APP_RULES: CssRule[] = [
  {
    sel: 'body',
    decls: [
      ['background', v('color-bg')],
      ['color', v('color-text')],
      ['font-family', v('font-family')],
      ['font-size', v('font-size-md')],
      ['font-weight', v('font-weight-regular')],
      ['line-height', v('line-height-normal')]
    ]
  },
  {
    sel: '.app-screen',
    decls: [
      ['box-sizing', 'border-box'],
      ['display', 'flex'],
      ['flex-direction', 'column'],
      ['padding-top', v('app-safe-top')],
      ['background', v('color-bg')],
      ['color', v('color-text')]
    ]
  },
  {
    sel: '.app-nav',
    decls: [
      ['box-sizing', 'border-box'],
      ['display', 'flex'],
      ['align-items', 'center'],
      ['justify-content', 'space-between'],
      ['gap', v('app-nav-gap')],
      ['height', v('app-nav-height')],
      ['padding', `0 ${v('app-gutter')}`],
      ['background', v('color-surface')],
      ['border-bottom', `${v('border-width-1')} solid ${v('color-border')}`]
    ]
  },
  {
    sel: '.app-nav-title',
    decls: [
      ['font-size', v('app-title-size')],
      ['font-weight', v('app-title-weight')],
      ['line-height', v('line-height-normal')]
    ]
  },
  {
    sel: '.app-body',
    decls: [
      ['box-sizing', 'border-box'],
      ['display', 'flex'],
      ['flex-direction', 'column'],
      ['gap', v('app-body-gap')],
      ['padding', `${v('app-body-pad-y')} ${v('app-gutter')} ${v('app-safe-bottom')}`]
    ]
  },
  {
    sel: '.app-body .ipt-box',
    decls: [['width', 'auto']]
  },
  {
    sel: '.app-list',
    decls: [
      ['display', 'flex'],
      ['flex-direction', 'column'],
      ['background', v('color-surface')],
      ['border', `${v('border-width-1')} solid ${v('color-border')}`],
      ['border-radius', v('app-list-radius')],
      ['overflow', 'hidden']
    ]
  },
  {
    sel: '.app-list .li',
    decls: [['width', 'auto']]
  },
  {
    sel: '.app-list .li:last-child',
    decls: [['border-bottom', 'none']]
  },
  {
    sel: '.app-cta',
    decls: [
      ['display', 'flex'],
      ['padding-top', v('app-cta-gap')]
    ]
  },
  {
    sel: '.app-cta .btn',
    decls: [
      ['flex', 'auto'],
      ['justify-content', 'center']
    ]
  }
]
