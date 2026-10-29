// JS / TS 源码的轻量词法跳读:注释、字符串、模板字符串、正则字面量、配平括号、一段表达式的结尾。
// 只为抽类名服务(classUsage.ts),不建语法树:要快,认错的代价只是样式附挂偏一点。

const CLOSER: Record<string, string> = { '(': ')', '{': '}', '[': ']' }

/** 正则字面量前面可能出现的字符;其余情况(标识符、右括号之后)的 / 是除号 */
const REGEX_PRECEDER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))
const REGEX_PRECEDER_WORDS = /\b(?:return|typeof|case|in|of|delete|void|throw|new|yield|await)$/

/** 模板字符串里的一段静态文本;touchesStart / touchesEnd 表示它两端紧贴 ${} 插值 */
export interface TemplateVisitor {
  part: (text: string, touchesStart: boolean, touchesEnd: boolean) => void
  expr: (from: number, to: number) => void
}

const IGNORE_TEMPLATE: TemplateVisitor = { part: () => undefined, expr: () => undefined }

export const isOpener = (ch: string): boolean => CLOSER[ch] !== undefined

/** i 之前最近的非空白字符下标;没有返回 -1 */
function prevSignificant(code: string, i: number): number {
  let j = i - 1
  while (j >= 0 && /\s/.test(code[j])) j--
  return j
}

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

/** i 处是正则字面量时返回它(连同标志)结束后的下标;否则原样返回 i */
function skipRegex(code: string, i: number): number {
  if (code[i] !== '/' || code[i + 1] === '/' || code[i + 1] === '*') return i
  const before = prevSignificant(code, i)
  const isRegex =
    before < 0 || REGEX_PRECEDER.has(code[before]) || REGEX_PRECEDER_WORDS.test(code.slice(0, i))
  if (!isRegex) return i
  let inClass = false
  let j = i + 1
  for (; j < code.length && code[j] !== '\n'; j++) {
    if (code[j] === '\\') j++
    else if (code[j] === '[') inClass = true
    else if (code[j] === ']') inClass = false
    else if (code[j] === '/' && !inClass) break
  }
  j++
  while (j < code.length && /[a-z]/.test(code[j])) j++
  return j
}

/** i 处是 ` 时扫完整个模板字符串,返回结束后的下标;静态文本与插值区间交给 visitor */
export function scanTemplate(code: string, i: number, visitor: TemplateVisitor): number {
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
export function skipString(code: string, i: number): number {
  const quote = code[i]
  if (quote === '`') return scanTemplate(code, i, IGNORE_TEMPLATE)
  if (quote !== '"' && quote !== "'") return i
  let j = i + 1
  while (j < code.length && code[j] !== quote && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
  return j + 1
}

/** 跳过 i 处的注释、字符串或正则字面量;都不是原样返回 i */
export function skipToken(code: string, i: number): number {
  const afterString = skipString(code, i)
  if (afterString !== i) return afterString
  const afterComment = skipComment(code, i)
  return afterComment !== i ? afterComment : skipRegex(code, i)
}

/** open 处的括号到配平的闭括号之后的下标;字符串、注释、正则里的括号不算。不配平时到文件尾 */
export function skipBalanced(code: string, open: number): number {
  const stack = [CLOSER[code[open]]]
  let i = open + 1
  while (i < code.length && stack.length > 0) {
    const next = skipToken(code, i)
    if (next !== i) {
      i = next
      continue
    }
    const ch = code[i]
    if (isOpener(ch)) stack.push(CLOSER[ch])
    else if (ch === stack[stack.length - 1]) stack.pop()
    i++
  }
  return i
}

/** 换行处表达式是否还没完:行尾停在运算符上,或下一行以 ? : + | & . 开头 */
function continuesAfterNewline(code: string, i: number): boolean {
  const before = prevSignificant(code, i)
  if (before >= 0 && '?:+|&=(,'.includes(code[before])) return true
  let j = i
  while (j < code.length && /\s/.test(code[j])) j++
  return j < code.length && '?:+|&.'.includes(code[j])
}

/** 从 start 起一段表达式的结尾下标(遇到同层的 ; , 未配对的闭括号或语句换行即止) */
export function scanExpression(code: string, start: number): number {
  let i = start
  while (i < code.length) {
    const next = skipToken(code, i)
    if (next !== i) {
      i = next
      continue
    }
    const ch = code[i]
    if (ch === ';' || ch === ',' || ch === ')' || ch === ']' || ch === '}') return i
    if (ch === '\n' && !continuesAfterNewline(code, i)) return i
    i = isOpener(ch) ? skipBalanced(code, i) : i + 1
  }
  return i
}
