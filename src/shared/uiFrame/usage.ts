// 共用变量的影响面(第 5.6 节):这个变量被多少地方引用,改动会波及几处。
// 两种引用都算:别的变量 ref → 它;组件/页面规则里 var(--它)。
// 「只改这一处」= 把 ref 解掉写专属字面量,不脱钩其它地方。
import { PAGE_RULES } from './documents.ts'
import { RECIPES } from './recipes/index.ts'
import type { CssRule } from './recipes/kit.ts'
import type { TokenMap, TokenValue } from './types.ts'

/** 变量值引用的目标名;字面量返回 null */
export function refTargetOf(value: TokenValue): string | null {
  return value.kind === 'ref' ? value.ref : null
}

function ruleDecls(rules: CssRule[]): string[] {
  return rules.flatMap((r) => r.decls.map(([, val]) => val))
}

/** 收集全部可见规则文本:组件配方规则+状态、页面布局规则(画布专属的 bench/board 不算,不进规格包) */
function allDeclTexts(): string[] {
  const texts: string[] = []
  for (const r of RECIPES) {
    texts.push(...ruleDecls(r.rules))
    for (const s of r.states) texts.push(...s.decls.map(([, val]) => val))
  }
  for (const rules of Object.values(PAGE_RULES)) texts.push(...ruleDecls(rules))
  return texts
}

let declCache: string[] | null = null
function decls(): string[] {
  declCache ??= allDeclTexts()
  return declCache
}

export interface TokenUsage {
  /** 值是 ref→本变量的其它变量名 */
  refs: string[]
  /** 规则里 var(--本变量) 出现的声明条数 */
  cssSites: number
  /** 合计影响面 */
  total: number
}

/** 数一下改这个变量会波及几处:引用它的变量 + 直接用 var() 的规则 */
export function tokenUsage(tokens: TokenMap, name: string): TokenUsage {
  const refs = Object.entries(tokens)
    .filter(([, def]) => refTargetOf(def.value) === name)
    .map(([n]) => n)
  const needle = `var(--${name})`
  const cssSites = decls().filter((d) => d.includes(needle)).length
  return { refs, cssSites, total: refs.length + cssSites }
}

/**
 * 「该给谁写」的答案:
 * shared 模式写到引用目标(改变量本身,波及全部引用处),
 * local 模式写回本变量(把 ref 解成专属字面量,只改这一处)。
 */
export function editTarget(name: string, mode: 'shared' | 'local', tokens: TokenMap): string {
  const def = tokens[name]
  const target = def ? refTargetOf(def.value) : null
  return mode === 'shared' && target ? target : name
}
