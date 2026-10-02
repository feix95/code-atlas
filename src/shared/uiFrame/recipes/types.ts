// 组件配方的类型(§7.1):样式规则表、状态表、演示节、拖动手柄在 handles.ts。
// 组件 CSS(真实 :hover 等伪类)与演示 CSS(.is-hover 等模拟 class)由同一张状态表生成(§13.2 规则 12);
// 样式值只写 var(),数值全部住在 tokens.css(规则 11)。新增组件 = 新增一份配方。
import type { PageNode, ThemeName } from '../types.ts'

export type Decl = [prop: string, value: string]
export interface CssRule {
  sel: string
  decls: Decl[]
}

export type StateName = 'hover' | 'active' | 'focus'

export interface StateRule {
  /** 基础选择器,如 .btn--solid */
  base: string
  state: StateName
  decls: Decl[]
  /** 真实状态选择器与默认映射不同时给出,如 :focus-within、:has(.ipt:focus-visible) */
  real?: string
}

export interface ComponentRecipe {
  /** 组件 id:样式文件为 components/<id>.css,演示页为 components/<id>.html */
  id: string
  label: string
  /** 组件变量的分组名(tokens 的 path[0]) */
  group: string
  rules: CssRule[]
  states: StateRule[]
  /** 适用状态(体检「状态缺失」与 README 组件总表用) */
  stateNames: string[]
  /** 体检「状态缺失」要求该组件 CSS 出现的伪类;缺省按 INTERACTIVE_STATES 全查 */
  requiredStates?: readonly string[]
  /** 演示结构里复用了其他组件的 class 时,列出其 id(演示页会加挂对应 css) */
  demoDeps?: string[]
  /** 演示节:某主题下该组件的「变体 × 状态」矩阵(组件墙与演示页共用) */
  demo: (theme: ThemeName) => PageNode
}
