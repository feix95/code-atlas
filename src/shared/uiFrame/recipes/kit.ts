// 配方与演示页的共用零件:var() 简写、演示节骨架、状态选择器映射、CSS 发射器。
import type { PageNode, ThemeName } from '../types.ts'
import type { ComponentRecipe, CssRule, StateName } from './types.ts'

export type { ComponentRecipe, CssRule, Decl, StateName, StateRule } from './types.ts'

export const v = (name: string): string => `var(--${name})`

export const THEME_LABEL: Record<ThemeName, string> = { light: '亮色', dark: '暗色' }
export const THEMES: ThemeName[] = ['light', 'dark']

/** 演示页模拟状态用的 class(只进 _demo.css,绝不出现在组件 CSS) */
export const DEMO_STATE_CLASS: Record<StateName, string> = {
  hover: 'is-hover',
  active: 'is-active',
  focus: 'is-focus'
}

const REAL_STATE: Record<StateName, string> = {
  hover: ':hover:not(:disabled)',
  active: ':active:not(:disabled)',
  focus: ':focus-visible'
}

/** 状态在导出 CSS 里的真实选择器(可被配方逐项覆盖,如 :focus-within) */
export function realState(s: { state: StateName; real?: string }): string {
  return s.real ?? REAL_STATE[s.state]
}

export function rulesCss(rules: CssRule[]): string {
  return rules
    .map((r) => `${r.sel} {\n${r.decls.map(([p, val]) => `  ${p}: ${val};`).join('\n')}\n}`)
    .join('\n\n')
}

/** 组件 CSS 正文(components/<组件>.css) */
export function componentCss(recipe: ComponentRecipe): string {
  const states = recipe.states.map((s) => ({
    sel: `${s.base}${realState(s)}`,
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

// ── 演示节骨架 ──────────────────────────────────────────────

export const demoLabel = (text: string): PageNode => ({ tag: 'span', cls: 'demo-label', text })
export const demoRow = (children: PageNode[]): PageNode => ({
  tag: 'div',
  cls: 'demo-row',
  children
})
export const demoCol = (children: PageNode[]): PageNode => ({
  tag: 'div',
  cls: 'demo-col',
  children
})

export function demoSection(theme: ThemeName, title: string, children: PageNode[]): PageNode {
  return {
    tag: 'section',
    cls: 'demo',
    attrs: { 'data-theme': theme },
    children: [
      { tag: 'h2', cls: 'demo-title', text: `${title} · ${THEME_LABEL[theme]}` },
      ...children
    ]
  }
}

/** 变体 × 状态 矩阵的一行:label + 每个状态各渲染一份 */
export function stateRow(
  name: string,
  states: ReadonlyArray<readonly [cls: string, label: string]>,
  render: (cls: string, state: string) => PageNode
): PageNode {
  return demoRow([demoLabel(name), ...states.map(([cls, state]) => render(cls, state))])
}
