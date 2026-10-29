// 源码里「当类名用」的词:只认 className / class 属性与赋值、对象属性 className:、
// clsx / cn / cx / classnames / classNames / twMerge 的参数、classList.add / remove / toggle / replace 的参数。
// 普通字符串('open'、'error' 这类通用词)不算,否则一份样式会被随便哪个出现同名字符串的文件拉走。
// 表达式里再排除两类明显不是类名的字符串: === / !== 比较的一侧,以及嵌套函数调用(如 t('label'))的参数。
// 只做词法扫描、不建语法树:扫描关系图时每个文件都要过一遍,得快;认错的代价只是样式附挂偏一点。
import {
  isOpener,
  scanExpression,
  scanTemplate,
  skipBalanced,
  skipString,
  skipToken
} from './jsLexer.ts'

const CLASS_CALLS = 'clsx|cn|cx|classnames|classNames|twMerge'

const CLASS_CONTEXT = new RegExp(
  String.raw`(?<![-\w$])(?:(?:className|class)\s*\+?=\s*|className\s*:\s*|(?:${CLASS_CALLS})\s*\(|classList\s*\.\s*(?:add|remove|toggle|replace)\s*\()`,
  'g'
)

const CLASS_NAME = /^-?[_a-zA-Z][\w-]*$/
const IDENT = /[\w$.]/
const COMPARE_BEFORE = /[!=]=\s*$/
const COMPARE_AFTER = /^\s*[!=]=/

/** 一段字符串文本按空白切词;紧贴插值的首尾半截词(如 `tab-${kind}` 的 tab-)丢掉 */
function addWords(text: string, cutFirst: boolean, cutLast: boolean, into: Set<string>): void {
  const words = text.split(/\s+/)
  const from = cutFirst && !/^\s/.test(text) ? 1 : 0
  const to = cutLast && !/\s$/.test(text) ? words.length - 1 : words.length
  for (const word of words.slice(from, to)) if (CLASS_NAME.test(word)) into.add(word)
}

/** 字符串 [start, end) 是否站在 === / !== 比较的一侧(那是在比值,不是类名) */
function isCompared(code: string, start: number, end: number): boolean {
  return (
    COMPARE_BEFORE.test(code.slice(Math.max(0, start - 8), start)) ||
    COMPARE_AFTER.test(code.slice(end, end + 8))
  )
}

/** i 处是标识符开头且紧跟 ( 时(函数调用),返回整个调用结束后的下标;否则返回 -1 */
function skipCall(code: string, i: number): number {
  if (i > 0 && IDENT.test(code[i - 1])) return -1
  let j = i
  while (j < code.length && IDENT.test(code[j])) j++
  if (j === i) return -1
  while (j < code.length && /\s/.test(code[j])) j++
  return code[j] === '(' ? skipBalanced(code, j) : -1
}

/**
 * [from, to) 区间里当类名用的字符串的词:模板字符串的插值里递归找;
 * 比较里的字符串与嵌套函数调用的参数跳过;objectKeys 为真时(clsx 一族的参数)对象字面量只取键。
 */
function collectStrings(
  code: string,
  from: number,
  to: number,
  into: Set<string>,
  objectKeys = false
): void {
  let i = from
  while (i < to) {
    const ch = code[i]
    if (ch === '`') {
      i = scanTemplate(code, i, {
        part: (text, touchesStart, touchesEnd) => addWords(text, touchesStart, touchesEnd, into),
        expr: (a, b) => collectStrings(code, a, b, into)
      })
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = skipString(code, i)
      if (!isCompared(code, i, end)) addWords(code.slice(i + 1, end - 1), false, false, into)
      i = end
      continue
    }
    if (objectKeys && ch === '{') {
      i = collectObjectKeys(code, i, into)
      continue
    }
    const afterCall = skipCall(code, i)
    if (afterCall >= 0) {
      i = afterCall
      continue
    }
    i = Math.max(i + 1, skipToken(code, i))
  }
}

/** open 处的对象字面量:键(带引号或不带)当类名,值不看;返回对象结束后的下标 */
function collectObjectKeys(code: string, open: number, into: Set<string>): number {
  const close = skipBalanced(code, open) - 1
  let i = open + 1
  while (i < close) {
    while (i < close && /[\s,]/.test(code[i])) i++
    const keyStart = i
    if (code[i] === '"' || code[i] === "'") {
      i = skipString(code, i)
      addWords(code.slice(keyStart + 1, i - 1), false, false, into)
    } else if (isOpener(code[i])) {
      i = skipBalanced(code, i)
    } else {
      while (i < close && /[\w$-]/.test(code[i])) i++
      if (i > keyStart && CLASS_NAME.test(code.slice(keyStart, i))) {
        into.add(code.slice(keyStart, i))
      }
    }
    const next = scanExpression(code, i)
    i = Math.max(next, i + 1)
  }
  return close + 1
}

/** 源码里当类名用的词(去重) */
export function extractClassTokens(code: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of code.matchAll(CLASS_CONTEXT)) {
    const at = match.index + match[0].length
    if (match[0].endsWith('(')) {
      const isClassCall = !match[0].startsWith('classList')
      collectStrings(code, at, skipBalanced(code, at - 1) - 1, tokens, isClassCall)
      continue
    }
    const opener = code[at]
    if (opener === '{') collectStrings(code, at + 1, skipBalanced(code, at) - 1, tokens)
    else if (opener === '"' || opener === "'" || opener === '`') {
      collectStrings(code, at, skipString(code, at), tokens)
    } else collectStrings(code, at, scanExpression(code, at), tokens)
  }
  return tokens
}
