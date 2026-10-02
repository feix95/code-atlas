// 输入框配方:<label class="ipt-box"><svg?><input class="ipt"></label>
// 视觉壳在 .ipt-box 上(描边 / 填充底 / 下划线三种样式),内部 .ipt 是无框裸输入,
// 带不带图标外观一致;尺寸与样式全部通过组件级自定义属性改绑变量。
import type { IconSlot, PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoCol,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const VARIANTS: Array<[string, string]> = [
  ['', '描边'],
  ['ipt-box--filled', '填充底'],
  ['ipt-box--underline', '下划线']
]

const STATES: Array<[cls: string, label: string, disabled: boolean]> = [
  ['', '默认', false],
  [DEMO_STATE_CLASS.hover, '悬停', false],
  [DEMO_STATE_CLASS.focus, '焦点', false],
  ['', '禁用', true]
]

export const INPUT: ComponentRecipe = {
  id: 'input',
  label: '输入框',
  group: 'ipt',
  stateNames: ['默认', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.ipt-box',
      decls: [
        ['--ipt-height', v('ipt-height-md')],
        ['--ipt-fs', v('ipt-font-size-md')],
        ['box-sizing', 'border-box'],
        ['display', 'flex'],
        ['align-items', 'center'],
        ['gap', v('ipt-gap')],
        ['width', v('ipt-width')],
        ['height', v('ipt-height')],
        ['margin', '0'],
        ['padding', `0 ${v('ipt-padding-x')}`],
        ['border', `${v('ipt-border-width')} solid ${v('color-border-strong')}`],
        ['border-radius', v('ipt-radius')],
        ['background', v('color-surface')],
        ['color', v('color-text')],
        ['cursor', 'text']
      ]
    },
    {
      sel: '.ipt-ic',
      decls: [
        ['display', 'flex'],
        ['flex', 'none'],
        ['color', v('color-text-secondary')]
      ]
    },
    {
      sel: '.ipt-ic svg',
      decls: [
        ['display', 'block'],
        ['width', v('ipt-icon-size')],
        ['height', v('ipt-icon-size')],
        ['stroke-width', v('icon-stroke')]
      ]
    },
    {
      sel: '.ipt',
      decls: [
        ['flex', 'auto'],
        ['min-width', '0'],
        ['width', '0'],
        ['border', '0'],
        ['padding', '0'],
        ['font-family', v('font-family')],
        ['font-size', v('ipt-fs')],
        ['line-height', v('line-height-normal')],
        ['color', v('color-text')],
        ['background', 'transparent'],
        ['outline', 'none'],
        ['cursor', 'text']
      ]
    },
    {
      sel: '.ipt::placeholder',
      decls: [['color', v('color-text-secondary')]]
    },
    {
      sel: '.ipt-box--sm',
      decls: [
        ['--ipt-height', v('ipt-height-sm')],
        ['--ipt-fs', v('ipt-font-size-sm')]
      ]
    },
    {
      sel: '.ipt-box--lg',
      decls: [
        ['--ipt-height', v('ipt-height-lg')],
        ['--ipt-fs', v('ipt-font-size-lg')]
      ]
    },
    {
      sel: '.ipt-box--filled',
      decls: [['background', v('color-hover-bg')]]
    },
    {
      sel: '.ipt-box--underline',
      decls: [
        ['border-radius', v('radius-none')],
        ['border-top-color', 'transparent'],
        ['border-right-color', 'transparent'],
        ['border-left-color', 'transparent']
      ]
    },
    {
      sel: '.ipt-box:has(.ipt:disabled)',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    },
    {
      sel: '.ipt-box:has(.ipt:disabled) .ipt',
      decls: [['cursor', 'not-allowed']]
    }
  ],
  states: [
    {
      base: '.ipt-box',
      state: 'hover',
      real: ':hover:not(:has(.ipt:disabled))',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.ipt-box',
      state: 'active',
      real: ':active:not(:has(.ipt:disabled))',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.ipt-box',
      state: 'focus',
      real: ':has(.ipt:focus-visible)',
      decls: [
        ['border-color', v('color-primary')],
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const field = (
      cls: string,
      stateCls: string,
      disabled: boolean,
      leadIcon?: IconSlot,
      trailIcon?: IconSlot
    ): PageNode => ({
      tag: 'label',
      cls: `ipt-box${cls ? ` ${cls}` : ''}${stateCls ? ` ${stateCls}` : ''}`,
      part: 'ipt-box',
      children: [
        ...(leadIcon ? [{ tag: 'span', cls: 'ipt-ic', icon: leadIcon } as PageNode] : []),
        (() => {
          const input: PageNode = {
            tag: 'input',
            cls: 'ipt',
            attrs: { type: 'text', placeholder: '输入内容' }
          }
          if (disabled) input.attrs!['disabled'] = ''
          return input
        })(),
        ...(trailIcon ? [{ tag: 'span', cls: 'ipt-ic', icon: trailIcon } as PageNode] : [])
      ]
    })
    const variantRows = VARIANTS.map(([cls, name]) =>
      demoRow([
        demoLabel(name),
        demoCol(STATES.map(([state, , disabled]) => field(cls, state, disabled)))
      ])
    )
    const iconRow = demoRow([
      demoLabel('带图标'),
      demoCol([
        field('', '', false, 'demo-input'),
        field('ipt-box--filled', '', false, 'demo-input')
      ])
    ])
    // 附件轴(§7.4):尾图标 / 清除钮
    const attachRow = demoRow([
      demoLabel('附件'),
      demoCol([
        field('', '', false, undefined, 'demo-down'),
        field('', '', false, undefined, 'demo-x')
      ])
    ])
    const sizeRow = demoRow([
      demoLabel('尺寸'),
      demoCol([
        field('ipt-box--sm', '', false),
        field('', '', false),
        field('ipt-box--lg', '', false)
      ])
    ])
    return demoSection(theme, '输入框', [...variantRows, iconRow, attachRow, sizeRow])
  }
}
