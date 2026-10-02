// 变量解析:引用链追到底、取某主题下的 CSS 值、按族找磁吸候选。
import type { ThemeName, TokenDef, TokenMap, TokenValue } from './types.ts'
import { emText, numberText, remText } from './units.ts'

/** 引用链最长层数;超过即视为环引用 */
const MAX_REF_DEPTH = 8

export function cssVarName(def: TokenDef): string {
  return def.path.join('-')
}

export function dtcgRef(def: TokenDef): string {
  return `{${def.path.join('.')}}`
}

/** 追到非引用的最终值;断链或环引用抛错(带变量名,便于定位) */
export function resolveValue(tokens: TokenMap, name: string): TokenValue {
  let current = tokens[name]
  for (let depth = 0; depth < MAX_REF_DEPTH; depth++) {
    if (!current) throw new Error(`变量不存在:--${name}`)
    if (current.value.kind !== 'ref') return current.value
    current = tokens[current.value.ref]
  }
  throw new Error(`变量引用超过 ${MAX_REF_DEPTH} 层,疑似环引用:--${name}`)
}

/** 最终值的逻辑像素;非尺寸变量回 null */
export function resolvePx(tokens: TokenMap, name: string): number | null {
  const v = resolveValue(tokens, name)
  return v.kind === 'dimension' ? v.px : null
}

/** 变量在 tokens.css 里的声明值(引用写 var(),其余写字面值) */
export function declaredCss(
  tokens: TokenMap,
  name: string,
  theme: ThemeName,
  rootPx: number
): string {
  const def = tokens[name]
  if (!def) throw new Error(`变量不存在:--${name}`)
  return literalCss(def.value, theme, rootPx)
}

export function literalCss(value: TokenValue, theme: ThemeName, rootPx: number): string {
  switch (value.kind) {
    case 'ref':
      return `var(--${value.ref})`
    case 'color':
      return value[theme]
    case 'dimension':
      return remText(value.px, rootPx)
    case 'em':
      return emText(value.value)
    case 'number':
    case 'fontWeight':
      return numberText(value.value)
    case 'fontFamily':
      return value.families.map((f) => (/^[a-z-]+$/.test(f) ? f : `"${f}"`)).join(', ')
    case 'shadow':
      return [value.x, value.y, value.blur, value.spread]
        .map((px) => remText(px, rootPx))
        .concat(value[theme])
        .join(' ')
  }
}

/** 是否随主题变化(颜色与阴影分亮暗两套) */
export function isThemed(value: TokenValue): boolean {
  return value.kind === 'color' || value.kind === 'shadow'
}

/** 磁吸候选:同分组的基础尺寸变量,按像素值升序 */
export function magnetCandidates(
  tokens: TokenMap,
  group: string
): Array<{ name: string; px: number }> {
  const out: Array<{ name: string; px: number }> = []
  for (const [name, def] of Object.entries(tokens)) {
    if (def.tier !== 'base' || def.path[0] !== group || def.value.kind !== 'dimension') continue
    out.push({ name, px: def.value.px })
  }
  return out.sort((a, b) => a.px - b.px)
}

/** 组件变量默认引用的基础变量所在分组(磁吸用);没有默认引用回 null */
export function refGroup(defaults: TokenMap, name: string): string | null {
  const def = defaults[name]
  if (!def || def.value.kind !== 'ref') return null
  return defaults[def.value.ref]?.path[0] ?? null
}
