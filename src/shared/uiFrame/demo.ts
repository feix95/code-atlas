// 组件演示页(components/<组件>.html 与画布「组件墙」共用):全部变体 × 状态 × 亮暗。
// 内容由组件配方注册表驱动(§7.1);演示专用的排版与状态模拟 class 只进 _demo.css(规则 12)。
import { RECIPES } from './recipes/index.ts'
import { demoStateRules, THEMES, v, type CssRule } from './recipes/kit.ts'
import type { PageNode } from './types.ts'

/** 某组件演示页的 body:亮暗各一节 */
export function demoBody(id: string): PageNode[] {
  const recipe = RECIPES.find((r) => r.id === id)
  if (!recipe) throw new Error(`未注册的组件:${id}`)
  return THEMES.map((theme) => recipe.demo(theme))
}

/** 画布「零件墙」:全部组件同屏(亮暗各一份);data-uf-wall 包一层供零件盒定位跳转 */
export function wallBody(): PageNode[] {
  return RECIPES.map((r) => ({
    tag: 'div',
    attrs: { 'data-uf-wall': r.id },
    children: THEMES.map((theme) => r.demo(theme))
  }))
}

/** _demo.css 正文:演示排版 + 各组件的状态模拟规则 */
export function demoRules(): CssRule[] {
  return [
    {
      sel: '.demo',
      decls: [
        ['padding', v('space-6')],
        ['background', v('color-bg')],
        ['color', v('color-text')],
        ['font-family', v('font-family')]
      ]
    },
    {
      sel: '.demo-title',
      decls: [
        ['margin', `0 0 ${v('space-4')}`],
        ['font-size', v('font-size-md')],
        ['font-weight', v('font-weight-semibold')],
        ['line-height', v('line-height-normal')]
      ]
    },
    {
      sel: '.demo-row',
      decls: [
        ['display', 'flex'],
        ['flex-wrap', 'wrap'],
        ['align-items', 'center'],
        ['gap', v('space-4')],
        ['margin', `0 0 ${v('space-4')}`]
      ]
    },
    {
      sel: '.demo-col',
      decls: [
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['align-items', 'flex-start'],
        ['gap', v('space-2')]
      ]
    },
    {
      sel: '.demo-label',
      decls: [
        ['width', v('space-16')],
        ['font-size', v('font-size-sm')],
        ['line-height', v('line-height-normal')],
        ['color', v('color-text-secondary')]
      ]
    },
    {
      sel: '.demo-cards',
      decls: [
        ['display', 'grid'],
        ['grid-template-columns', `repeat(${v('page-features-columns')}, minmax(0, 1fr))`],
        ['gap', v('page-features-gap')],
        ['max-width', v('page-content-max')]
      ]
    },
    ...RECIPES.flatMap(demoStateRules)
  ]
}
