// 聊天/阅读稿里的 LaTeX 与 HTML 实体:模型爱写 $\rightarrow$ / $\neq$ / &rarr;,
// MiniMD 不引入 KaTeX(要 innerHTML 和字体包),这里把常见命令收成 Unicode,
// 解析层拿纯字符串对账,渲染层只摆字。对照表住 mdMathTables。
import { COMMAND_NAMES, COMMANDS, NAMED_ENTITIES, SUB, SUPER, TEXT_MACROS } from './mdMathTables.ts'

function mapChars(src: string, table: Record<string, string>): string {
  let out = ''
  for (const ch of src) out += table[ch] ?? ch
  return out
}

/** 这段是不是公式:认得出的命令、上下标,或 frac/sqrt/text。路径 C:\\Users 这种不认。 */
export function looksLikeLatex(src: string): boolean {
  const s = src.trim()
  if (s === '') return false
  if (/\\(?:frac|sqrt|binom)\s*\{/.test(s)) return true
  const names = s.match(/\\([a-zA-Z]+)/g)
  if (names) {
    return names.some((token) => {
      const name = token.slice(1)
      return COMMANDS[name] !== undefined || TEXT_MACROS.has(name)
    })
  }
  return /[A-Za-z]\^[\w{]|[A-Za-z0-9]_([A-Za-z0-9{])|[_^]\{/.test(s)
}

export interface UnwrappedMath {
  tex: string
  display: boolean
}

/** 剥掉 $...$ / $$...$$ / \\(...\\) / \\[...\\];剥不掉返回 null */
export function unwrapMathSource(raw: string): UnwrappedMath | null {
  const t = raw.trim()
  const displayDollar = /^\$\$([\s\S]+)\$\$$/.exec(t)
  if (displayDollar) return { tex: displayDollar[1], display: true }
  const inlineDollar = /^\$(.+)\$$/.exec(t)
  if (inlineDollar) return { tex: inlineDollar[1], display: false }
  const paren = /^\\\(([\s\S]+)\\\)\s*$/.exec(t)
  if (paren) return { tex: paren[1], display: false }
  const brack = /^\\\[([\s\S]+)\\\]\s*$/.exec(t)
  if (brack) return { tex: brack[1], display: true }
  return null
}

function replaceScripts(src: string): string {
  return src
    .replace(/\^\{([^{}]*)\}/g, (_, body: string) => mapChars(body, SUPER))
    .replace(/\^([A-Za-z0-9+-])/g, (_, ch: string) => SUPER[ch] ?? `^${ch}`)
    .replace(/_\{([^{}]*)\}/g, (_, body: string) => mapChars(body, SUB))
    .replace(/_([A-Za-z0-9+-])/g, (_, ch: string) => SUB[ch] ?? `_${ch}`)
}

function replaceCommands(src: string): string {
  let s = src
  for (const name of COMMAND_NAMES) {
    const needle = `\\${name}`
    if (!s.includes(needle)) continue
    s = s.replace(new RegExp(`\\\\${name}(?![a-zA-Z])`, 'g'), COMMANDS[name])
  }
  return s
}

/**
 * 把一段 TeX 收成 Unicode。复杂排版(矩阵、多行 align)会降成近似字,
 * 认不出的命令丢掉反斜杠留下名字,不把原文吞没。
 */
export function latexToUnicode(src: string): string {
  let s = src.trim()
  s = s.replace(
    /\\(?:text|mathrm|mathbf|operatorname|textit|textbf|textrm|mathsf|mathtt)\s*\{([^{}]*)\}/g,
    '$1'
  )
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    s = s.replace(/\\binom\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, 'C($1,$2)')
  }
  s = replaceCommands(s)
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg|displaystyle|textstyle)\s*/g, '')
  s = s.replace(/\\[,;!:]/g, ' ')
  s = replaceScripts(s)
  s = s.replace(/\\([a-zA-Z]+)/g, '$1')
  s = s.replace(/[{}]/g, '')
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** 行内代码整段是公式时才改画:剥层后仍像 LaTeX 才转换,普通代码原样留 */
export function mathFromCodeSpan(raw: string): { text: string; display: boolean } | null {
  const wrapped = unwrapMathSource(raw)
  const tex = wrapped ? wrapped.tex : raw
  if (!looksLikeLatex(tex)) return null
  return { text: latexToUnicode(tex), display: wrapped?.display === true }
}

/** 从位置 i 起若是一段公式,返回 tex 与结束下标;货币 $50 这种不当公式 */
export function matchMathAt(
  src: string,
  i: number
): { tex: string; display: boolean; end: number } | null {
  if (src.startsWith('$$', i)) {
    const close = src.indexOf('$$', i + 2)
    if (close < 0) return null
    return { tex: src.slice(i + 2, close), display: true, end: close + 2 }
  }
  if (src[i] === '$') {
    const close = src.indexOf('$', i + 1)
    if (close < 0) return null
    const tex = src.slice(i + 1, close)
    if (tex.includes('\n') || !looksLikeLatex(tex)) return null
    return { tex, display: false, end: close + 1 }
  }
  if (src.startsWith('\\(', i)) {
    const close = src.indexOf('\\)', i + 2)
    if (close < 0) return null
    return { tex: src.slice(i + 2, close), display: false, end: close + 2 }
  }
  if (src.startsWith('\\[', i)) {
    const close = src.indexOf('\\]', i + 2)
    if (close < 0) return null
    return { tex: src.slice(i + 2, close), display: true, end: close + 2 }
  }
  return null
}

export function nextMathIndex(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (matchMathAt(src, i)) return i
  }
  return -1
}

/** 正文里的 &rarr; / &#8594; 收成符号;代码块不走这里 */
export function decodeHtmlEntities(src: string): string {
  return src.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (_, token: string) => {
    if (token[0] === '#') {
      const hex = token[1] === 'x' || token[1] === 'X'
      const n = Number.parseInt(hex ? token.slice(2) : token.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return `&${token};`
      return String.fromCodePoint(n)
    }
    return NAMED_ENTITIES[token] ?? `&${token};`
  })
}
