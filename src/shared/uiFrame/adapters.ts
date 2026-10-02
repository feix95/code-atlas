// 导出适配器(§13.5):把方案变量转写成目标框架的主题文件。
// Tailwind v4 → @theme 主题表;React Native → TypeScript 主题对象(数值为逻辑像素)。
// 纯函数,导出包、剪贴板复制与自测共用同一份生成器。
import { isThemed, literalCss, resolveValue } from './resolve.ts'
import type { ThemeName, TokenValue, UiFrameDoc } from './types.ts'

/** Tailwind v4 命名空间映射:按变量名前缀归位,没归位的原样进 @theme(仍是可用的 CSS 变量) */
const TW_NS: Array<[prefix: string, ns: string]> = [
  ['color-', 'color-'],
  ['space-', 'spacing-'],
  ['radius-', 'radius-'],
  ['font-size-', 'text-'],
  ['font-weight-', 'font-weight-'],
  ['line-height-', 'leading-'],
  ['shadow-', 'shadow-']
]

/** 精确改名:界面字族在 Tailwind 里是 --font-sans */
const TW_RENAME: Record<string, string> = { 'font-family': 'font-sans' }

function twVar(name: string): string {
  if (TW_RENAME[name]) return TW_RENAME[name]
  for (const [prefix, ns] of TW_NS) {
    if (name.startsWith(prefix)) return `${ns}${name.slice(prefix.length)}`
  }
  return name
}

/** Tailwind v4 主题文件(§13.5):@theme 给亮色值,暗色值落在 [data-theme='dark'] 块(与 tokens.css 同一约定) */
export function tailwindThemeCss(doc: UiFrameDoc): string {
  const light: string[] = []
  const dark: string[] = []
  for (const [name, def] of Object.entries(doc.tokens)) {
    const v = def.value.kind === 'ref' ? resolveValue(doc.tokens, name) : def.value
    light.push(`  --${twVar(name)}: ${literalCss(v, 'light', doc.rootFontPx)};`)
    if (isThemed(v)) {
      dark.push(`  --${twVar(name)}: ${literalCss(v, 'dark', doc.rootFontPx)};`)
    }
  }
  return [
    `/* tailwind.theme.css · Tailwind CSS v4 主题文件(由「${doc.name}」导出,根字号 ${doc.rootFontPx}px)`,
    '   用法:项目入口 CSS 里 @import "tailwindcss"; 之后 @import "./tailwind.theme.css";',
    '   暗色:在 <html> 上写 data-theme="dark"(与 tokens.css 同一约定) */',
    '',
    '@theme {',
    ...light,
    '}',
    '',
    "[data-theme='dark'] {",
    ...dark,
    '}',
    ''
  ].join('\n')
}

const camel = (s: string): string => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
const jsKey = (member: string): string => {
  const c = camel(member)
  return /^[a-zA-Z_$][\w$]*$/.test(c) ? c : JSON.stringify(member)
}

function rnLiteral(v: TokenValue, theme: ThemeName, indent: string): string {
  switch (v.kind) {
    case 'ref':
      return 'null /* 断链 */'
    case 'color':
      return JSON.stringify(v[theme])
    case 'dimension':
      return String(v.px)
    case 'em':
    case 'number':
    case 'fontWeight':
      return String(v.value)
    case 'fontFamily':
      return `[${v.families.map((f) => JSON.stringify(f)).join(', ')}]`
    case 'shadow':
      return `${indent}{ offset: { width: ${v.x}, height: ${v.y} }, radius: ${v.blur}, spread: ${v.spread}, color: ${JSON.stringify(v[theme])} }`
  }
}

/** React Native 主题对象(§13.5):亮暗两套颜色/阴影在 light/dark 分桶下,其余按变量分组 */
export function reactNativeThemeTs(doc: UiFrameDoc): string {
  const themed = new Map<string, Map<string, string>>() // theme → group → "key: value"
  const plain = new Map<string, string[]>() // group → members
  for (const [name, def] of Object.entries(doc.tokens)) {
    const [group, member] = def.path
    const g = camel(group)
    const v = def.value.kind === 'ref' ? resolveValue(doc.tokens, name) : def.value
    if (isThemed(v)) {
      for (const theme of ['light', 'dark'] as const) {
        const bucket = themed.get(theme) ?? new Map<string, string>()
        themed.set(theme, bucket)
        const members = bucket.get(g) ?? ''
        bucket.set(g, `${members}      ${jsKey(member)}: ${rnLiteral(v, theme, '')},\n`)
      }
    } else {
      const members = plain.get(g) ?? []
      members.push(`    ${jsKey(member)}: ${rnLiteral(v, 'light', '')},`)
      plain.set(g, members)
    }
  }
  const themeBlock = (theme: ThemeName): string => {
    const bucket = themed.get(theme)
    if (!bucket) return ''
    const groups = [...bucket.entries()].map(([g, members]) => `    ${g}: {\n${members}    },`)
    return `  ${theme}: {\n${groups.join('\n')}\n  },`
  }
  const plainBlocks = [...plain.entries()].map(
    ([g, members]) => `  ${g}: {\n${members.join('\n')}\n  },`
  )
  return [
    `// uiTheme.ts · React Native 主题对象(由「${doc.name}」导出,数值为逻辑像素)`,
    `// 阴影按 RN 习惯拆成 offset/radius/spread/color;颜色与阴影分 light/dark 两套`,
    '',
    'export const uiTheme = {',
    themeBlock('light'),
    themeBlock('dark'),
    ...plainBlocks,
    '} as const',
    '',
    'export type UiTheme = typeof uiTheme',
    ''
  ]
    .filter((s) => s !== '')
    .join('\n')
}
