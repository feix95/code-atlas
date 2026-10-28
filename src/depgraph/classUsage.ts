// 源码里「当类名用」的词:只认 className / class 属性与赋值、clsx / cn / classnames / classNames 的参数、
// classList.add / remove / toggle / replace 的参数。普通字符串('open'、'error' 这类通用词)不算,
// 否则一份样式会被随便哪个出现同名字符串的文件拉走。
// 只做词法扫描、不建语法树:扫描关系图时每个文件都要过一遍,得快;认错的代价只是样式附挂偏一点。

const CLASS_CONTEXT =
  /\b(?:className|class)\s*\+?=\s*|\b(?:clsx|cn|classnames|classNames)\s*\(|\bclassList\s*\.\s*(?:add|remove|toggle|replace)\s*\(/g

const CLASS_NAME = /^-?[_a-zA-Z][\w-]*$/

const CLOSER: Record<string, string> = { '(': ')', '{': '}', '[': ']' }

/** 模板字符串里的一段静态文本;touchesStart / touchesEnd 表示它两端紧贴 ${} 插值 */
interface TemplateVisitor {
  part: (text: string, touchesStart: boolean, touchesEnd: boolean) => void
  expr: (from: number, to: number) => void
}

const IGNORE_TEMPLATE: TemplateVisitor = { part: () => undefined, expr: () => undefined }

/** 跳过 i 处开始的注释;不是注释原样返回 i */
function skipComment(code: string, i: number): number {
  if (code[i] !== '/') return i
  if (code[i + 1] === '/') {
    const end = code.indexOf('\n', i)
    return end < 0 ? code.length : end
  }
  if (code[i + 1] === '*') {
    const end = code.indexOf('*/', i + 2)
    return end < 0 ? code.length : end + 2
  }
  return i
}

/** i 处是 ` 时扫完整个模板字符串,返回结束后的下标;静态文本与插值区间交给 visitor */
function scanTemplate(code: string, i: number, visitor: TemplateVisitor): number {
  let partStart = i + 1
  let touchesStart = false
  let j = i + 1
  while (j < code.length && code[j] !== '`') {
    if (code[j] === '\\') {
      j += 2
      continue
    }
    if (code[j] !== '$' || code[j + 1] !== '{') {
      j++
      continue
    }
    visitor.part(code.slice(partStart, j), touchesStart, true)
    const end = skipBalanced(code, j + 1)
    visitor.expr(j + 2, end - 1)
    partStart = end
    touchesStart = true
    j = end
  }
  visitor.part(code.slice(partStart, j), touchesStart, false)
  return j + 1
}

/** i 处是引号时返回字符串结束后的下标;否则原样返回 i */
function skipString(code: string, i: number): number {
  const quote = code[i]
  if (quote === '`') return scanTemplate(code, i, IGNORE_TEMPLATE)
  if (quote !== '"' && quote !== "'") return i
  let j = i + 1
  while (j < code.length && code[j] !== quote && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
  return j + 1
}

/** open 处的括号到配平的闭括号之后的下标;字符串与注释里的括号不算。不配平时到文件尾 */
function skipBalanced(code: string, open: number): number {
  const stack = [CLOSER[code[open]]]
  let i = open + 1
  while (i < code.length && stack.length > 0) {
    const next = Math.max(skipString(code, i), skipComment(code, i))
    if (next !== i) {
      i = next
      continue
    }
    const ch = code[i]
    if (CLOSER[ch] !== undefined) stack.push(CLOSER[ch])
    else if (ch === stack[stack.length - 1]) stack.pop()
    i++
  }
  return i
}

/** 一段字符串文本按空白切词;紧贴插值的首尾半截词(如 `tab-${kind}` 的 tab-)丢掉 */
function addWords(text: string, cutFirst: boolean, cutLast: boolean, into: Set<string>): void {
  const words = text.split(/\s+/)
  const from = cutFirst && !/^\s/.test(text) ? 1 : 0
  const to = cutLast && !/\s$/.test(text) ? words.length - 1 : words.length
  for (const word of words.slice(from, to)) if (CLASS_NAME.test(word)) into.add(word)
}

/** [from, to) 区间里所有字符串字面量的词(模板字符串的插值里递归找) */
function collectStrings(code: string, from: number, to: number, into: Set<string>): void {
  let i = from
  while (i < to) {
    const ch = code[i]
    if (ch === '`') {
      i = scanTemplate(code, i, {
        part: (text, touchesStart, touchesEnd) => addWords(text, touchesStart, touchesEnd, into),
        expr: (a, b) => collectStrings(code, a, b, into)
      })
    } else if (ch === '"' || ch === "'") {
      const end = skipString(code, i)
      addWords(code.slice(i + 1, end - 1), false, false, into)
      i = end
    } else {
      i = Math.max(i + 1, skipComment(code, i))
    }
  }
}

/** 源码里当类名用的词(去重) */
export function extractClassTokens(code: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of code.matchAll(CLASS_CONTEXT)) {
    const at = match.index + match[0].length
    const isCall = match[0].endsWith('(')
    const start = isCall ? at - 1 : at
    const opener = code[start]
    if (opener === '(' || opener === '{')
      collectStrings(code, start + 1, skipBalanced(code, start) - 1, tokens)
    else collectStrings(code, start, skipString(code, start), tokens)
  }
  return tokens
}
