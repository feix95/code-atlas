// 体检:design.json 只含可机读数据(规则 14)、design.json 与 tokens.css 逐项一致。
import type { LintIssue, SpecPackage } from './types.ts'

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }
type Obj = { [k: string]: Json }

const isObj = (v: Json | undefined): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

interface JsonToken {
  name: string
  type: string
  value: Json
  dark?: Json
  unit?: string
}

/** 拍平 design.json 的两级分组:变量名 = 分组-名称 */
function tokensOf(root: Obj, ext: string): JsonToken[] {
  const out: JsonToken[] = []
  for (const [group, bucket] of Object.entries(root)) {
    if (group.startsWith('$') || !isObj(bucket)) continue
    for (const [name, tok] of Object.entries(bucket)) {
      if (!isObj(tok) || typeof tok['$type'] !== 'string') continue
      const e = isObj(tok['$extensions']) ? tok['$extensions'][ext] : undefined
      const modes = isObj(e) && isObj(e['modes']) ? e['modes'] : undefined
      out.push({
        name: `${group}-${name}`,
        type: tok['$type'],
        value: tok['$value'] ?? null,
        dark: modes?.['dark'],
        unit: isObj(e) && typeof e['unit'] === 'string' ? e['unit'] : undefined
      })
    }
  }
  return out
}

const EXT = 'com.codeatlas.uiframe'

function parseJson(pkg: SpecPackage, issues: LintIssue[]): Obj | null {
  try {
    const parsed = JSON.parse(pkg.files['design.json'] ?? '') as Json
    return isObj(parsed) ? parsed : null
  } catch (err) {
    issues.push({
      level: 'error',
      check: '数据含描述文字',
      file: 'design.json',
      message: `不是合法 JSON:${err instanceof Error ? err.message : String(err)}`
    })
    return null
  }
}

const REF_RE = /^\{[\w.-]+\}$/

export function checkDesignJsonData(pkg: SpecPackage, issues: LintIssue[]): void {
  const root = parseJson(pkg, issues)
  if (!root) return
  for (const t of tokensOf(root, EXT)) {
    const bad =
      typeof t.value === 'string'
        ? !REF_RE.test(t.value)
        : Array.isArray(t.value)
          ? t.type !== 'fontFamily'
          : false
    if (bad || /[\u4e00-\u9fff]/.test(JSON.stringify(t.value))) {
      issues.push({
        level: 'error',
        check: '数据含描述文字',
        file: 'design.json',
        message: `${t.name} 的 $value 不是可机读数据:${JSON.stringify(t.value)}`
      })
    }
  }
}

function num(n: Json | undefined): string {
  return typeof n === 'number' ? String(Number(n.toFixed(4))) : '?'
}

function dimText(v: Json | undefined): string {
  if (!isObj(v)) return '?'
  return v['value'] === 0 ? '0' : `${num(v['value'])}${String(v['unit'])}`
}

function colorText(v: Json | undefined, asHex: boolean): string {
  if (!isObj(v)) return '?'
  if (asHex && typeof v['hex'] === 'string') return v['hex'].toLowerCase()
  const c = Array.isArray(v['components']) ? v['components'] : []
  const rgb = c.map((x) => (typeof x === 'number' ? Math.round(x * 255) : 0)).join(', ')
  return `rgba(${rgb}, ${num(v['alpha'])})`
}

/** design.json 的值按 tokens.css 的写法还原成 CSS 文本 */
function expectedCss(t: JsonToken, v: Json | undefined): string {
  if (typeof v === 'string') return `var(--${v.slice(1, -1).replace('.', '-')})`
  switch (t.type) {
    case 'color':
      return colorText(v, true)
    case 'dimension':
      return dimText(v)
    case 'number':
      return t.unit === 'em' ? (v === 0 ? '0' : `${num(v)}em`) : num(v)
    case 'fontWeight':
      return num(v)
    case 'fontFamily':
      return Array.isArray(v)
        ? v
            .map((f) => (typeof f === 'string' && /^[a-z-]+$/.test(f) ? f : `"${String(f)}"`))
            .join(', ')
        : '?'
    case 'shadow':
      return isObj(v)
        ? [v['offsetX'], v['offsetY'], v['blur'], v['spread']].map(dimText).join(' ') +
            ` ${colorText(v['color'], false)}`
        : '?'
    default:
      return '?'
  }
}

/** tokens.css 的声明:亮色表(:root / light / 通用块)与暗色表 */
function declaredMaps(css: string): { light: Map<string, string>; dark: Map<string, string> } {
  const light = new Map<string, string>()
  const dark = new Map<string, string>()
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const target = m[1].includes("'dark'") ? dark : light
    for (const d of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) target.set(d[1], d[2].trim())
  }
  return { light, dark }
}

export function checkConsistency(pkg: SpecPackage, issues: LintIssue[]): void {
  const root = (() => {
    try {
      const parsed = JSON.parse(pkg.files['design.json'] ?? '') as Json
      return isObj(parsed) ? parsed : null
    } catch {
      return null
    }
  })()
  if (!root) return
  const { light, dark } = declaredMaps(pkg.files['tokens.css'] ?? '')
  const report = (name: string, mode: string, want: string, got: string | undefined): void => {
    issues.push({
      level: 'error',
      check: '三份数据不一致',
      file: 'tokens.css',
      message: `--${name}(${mode})tokens.css 为「${got ?? '缺失'}」,design.json 为「${want}」`
    })
  }
  for (const t of tokensOf(root, EXT)) {
    const want = expectedCss(t, t.value)
    const got = light.get(t.name)
    if (want.toLowerCase() !== got?.toLowerCase()) report(t.name, '亮色', want, got)
    if (t.dark !== undefined) {
      const wantDark = expectedCss(t, t.dark)
      const gotDark = dark.get(t.name)
      if (wantDark.toLowerCase() !== gotDark?.toLowerCase())
        report(t.name, '暗色', wantDark, gotDark)
    }
  }
}
