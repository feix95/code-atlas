// 组件配方(§7.1):样式规则表、状态表、拖动手柄映射。
// 组件 CSS(真实 :hover 等伪类)与演示 CSS(.is-hover 等模拟 class)由同一张状态表生成(§13.2 规则 12);
// 样式值只写 var(),数值全部住在 tokens.css(规则 11)。新增组件 = 新增一份配方。

export type Decl = [prop: string, value: string]
export interface CssRule {
  sel: string
  decls: Decl[]
}

type StateName = 'hover' | 'active' | 'focus'

interface StateRule {
  /** 基础选择器,如 .btn--solid */
  base: string
  state: StateName
  decls: Decl[]
}

export interface ComponentRecipe {
  id: 'button' | 'card'
  label: string
  /** 组件变量的分组名(tokens 的 path[0]) */
  group: string
  rules: CssRule[]
  states: StateRule[]
  /** 适用状态(体检「状态缺失」与 README 组件总表用) */
  stateNames: string[]
}

const v = (name: string): string => `var(--${name})`

const BUTTON_SIZES: Array<['sm' | 'lg', string]> = [
  ['sm', '.btn--sm'],
  ['lg', '.btn--lg']
]

export const BUTTON: ComponentRecipe = {
  id: 'button',
  label: '按钮',
  group: 'btn',
  stateNames: ['默认', '悬停', '按下', '焦点', '禁用'],
  rules: [
    {
      sel: '.btn',
      decls: [
        ['box-sizing', 'border-box'],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['gap', v('btn-gap')],
        ['height', v('btn-height-md')],
        ['margin', '0'],
        ['padding', `0 ${v('btn-padding-x-md')}`],
        ['font-family', v('font-family')],
        ['font-size', v('btn-font-size-md')],
        ['font-weight', v('btn-font-weight')],
        ['line-height', v('btn-line-height')],
        ['letter-spacing', '0'],
        ['text-align', 'center'],
        ['border', `${v('btn-border-width')} solid transparent`],
        ['border-radius', v('btn-radius')],
        ['background', 'transparent'],
        ['color', v('color-text')],
        ['cursor', 'pointer'],
        ['white-space', 'nowrap'],
        ['text-decoration', 'none']
      ]
    },
    {
      sel: '.btn svg',
      decls: [
        ['display', 'block'],
        ['flex', 'none'],
        ['width', v('btn-icon-size')],
        ['height', v('btn-icon-size')],
        ['stroke-width', v('icon-stroke')]
      ]
    },
    ...BUTTON_SIZES.map(([size, sel]): CssRule => ({
      sel,
      decls: [
        ['height', v(`btn-height-${size}`)],
        ['padding', `0 ${v(`btn-padding-x-${size}`)}`],
        ['font-size', v(`btn-font-size-${size}`)]
      ]
    })),
    {
      sel: '.btn--solid',
      decls: [
        ['background', v('color-primary')],
        ['color', v('color-on-primary')]
      ]
    },
    { sel: '.btn--outline', decls: [['border-color', v('color-border-strong')]] },
    {
      sel: '.btn:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    }
  ],
  states: [
    { base: '.btn--solid', state: 'hover', decls: [['background', v('color-primary-hover')]] },
    { base: '.btn--solid', state: 'active', decls: [['background', v('color-primary-active')]] },
    { base: '.btn--outline', state: 'hover', decls: [['background', v('color-hover-bg')]] },
    { base: '.btn--outline', state: 'active', decls: [['background', v('color-pressed-bg')]] },
    { base: '.btn--ghost', state: 'hover', decls: [['background', v('color-hover-bg')]] },
    { base: '.btn--ghost', state: 'active', decls: [['background', v('color-pressed-bg')]] },
    {
      base: '.btn',
      state: 'focus',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ]
}

export const CARD: ComponentRecipe = {
  id: 'card',
  label: '卡片',
  group: 'card',
  stateNames: ['默认'],
  rules: [
    {
      sel: '.card',
      decls: [
        ['box-sizing', 'border-box'],
        ['margin', '0'],
        ['padding', v('card-padding')],
        ['font-family', v('font-family')],
        ['text-align', 'left'],
        ['color', v('color-text')],
        ['background', v('color-surface')],
        ['border', `${v('card-border-width')} solid ${v('color-border')}`],
        ['border-radius', v('card-radius')],
        ['box-shadow', v('card-shadow')]
      ]
    },
    {
      sel: '.card__icon',
      decls: [
        ['box-sizing', 'border-box'],
        ['display', 'flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('card-icon-box')],
        ['height', v('card-icon-box')],
        ['margin', `0 0 ${v('card-icon-gap')}`],
        ['border-radius', v('card-icon-radius')],
        ['background', v('color-primary-subtle')],
        ['color', v('color-primary')]
      ]
    },
    {
      sel: '.card__icon svg',
      decls: [
        ['display', 'block'],
        ['flex', 'none'],
        ['width', v('card-icon-size')],
        ['height', v('card-icon-size')],
        ['stroke-width', v('icon-stroke')]
      ]
    },
    {
      sel: '.card__title',
      decls: [
        ['margin', `0 0 ${v('card-title-gap')}`],
        ['font-size', v('card-title-size')],
        ['font-weight', v('card-title-weight')],
        ['line-height', v('card-title-line-height')],
        ['color', v('color-text')]
      ]
    },
    {
      sel: '.card__text',
      decls: [
        ['margin', '0'],
        ['font-size', v('card-text-size')],
        ['font-weight', v('font-weight-regular')],
        ['line-height', v('card-text-line-height')],
        ['color', v('color-text-secondary')]
      ]
    }
  ],
  states: []
}

export const RECIPES: ComponentRecipe[] = [BUTTON, CARD]

const REAL_STATE: Record<StateName, string> = {
  hover: ':hover:not(:disabled)',
  active: ':active:not(:disabled)',
  focus: ':focus-visible'
}

/** 演示页模拟状态用的 class(只进 _demo.css) */
export const DEMO_STATE_CLASS: Record<StateName, string> = {
  hover: 'is-hover',
  active: 'is-active',
  focus: 'is-focus'
}

export function rulesCss(rules: CssRule[]): string {
  return rules
    .map((r) => `${r.sel} {\n${r.decls.map(([p, val]) => `  ${p}: ${val};`).join('\n')}\n}`)
    .join('\n\n')
}

/** 组件 CSS 正文(components/<组件>.css) */
export function componentCss(recipe: ComponentRecipe): string {
  const states = recipe.states.map((s) => ({
    sel: `${s.base}${REAL_STATE[s.state]}`,
    decls: s.decls
  }))
  return `/* ${recipe.label} · 组件样式:直接复用,禁止改写 */\n\n${rulesCss([...recipe.rules, ...states])}\n`
}

/** 演示 CSS 里的状态模拟规则 */
export function demoStateRules(recipe: ComponentRecipe): CssRule[] {
  return recipe.states.map((s) => ({
    sel: `${s.base}.${DEMO_STATE_CLASS[s.state]}`,
    decls: s.decls
  }))
}
