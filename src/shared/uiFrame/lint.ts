// 规格包体检(§13.7):导出前扫描规格包,输出问题清单。错误级阻止导出,提醒级允许导出。
// 纯函数:输入规格包与页面结构,不读盘、不碰界面。
import { RESET_TAGS } from './documents.ts'
import {
  COMPONENT_CSS,
  DEMO_CLASS_PATTERNS,
  INLINE_TAGS,
  INTERACTIVE_STATES,
  LITERAL_FILES,
  UA_STYLED_TAGS,
  VAGUE_FILES,
  VAGUE_PATTERNS,
  VAGUE_WORDS
} from './lintRules.ts'
import { tagsOf } from './markup.ts'
import { RECIPES } from './recipes.ts'
import { checkConsistency, checkDesignJsonData } from './lintData.ts'
import type { LintIssue, PageNode, SpecPackage } from './types.ts'

type Issues = LintIssue[]

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** CSS 声明块:选择器 → 声明正文 */
export function cssBlocks(css: string): Array<{ sel: string; body: string }> {
  const out: Array<{ sel: string; body: string }> = []
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sel: m[1].trim(), body: m[2] })
  }
  return out
}

function checkVague(pkg: SpecPackage, issues: Issues): void {
  for (const [file, text] of Object.entries(pkg.files)) {
    if (!VAGUE_FILES(file)) continue
    const hits = VAGUE_WORDS.filter((w) => text.includes(w))
    for (const re of VAGUE_PATTERNS) hits.push(...[...text.matchAll(re)].map((m) => `${m[0]}…`))
    for (const word of new Set(hits)) {
      issues.push({
        level: 'error',
        check: '含糊词',
        file,
        message: `出现含糊词「${word}」:只允许「必须 / 禁止」`
      })
    }
  }
}

const LENGTH_RE = /(?<![\w-])-?\d*\.?\d+(px|rem|em|vh|vw|pt|%)/
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch)\(/
const NUMBER_RE = /(?<![\w.-])-?(\d*\.\d+|[1-9]\d*)(?![\w%.])/

function checkLiterals(pkg: SpecPackage, issues: Issues): void {
  for (const [file, text] of Object.entries(pkg.files)) {
    if (!LITERAL_FILES(file)) continue
    for (const { sel, body } of cssBlocks(text)) {
      for (const decl of body.split(';')) {
        const idx = decl.indexOf(':')
        if (idx < 0) continue
        const prop = decl.slice(0, idx).trim()
        const value = decl
          .slice(idx + 1)
          .replace(/var\(--[\w-]+\)/g, '')
          .trim()
        if (LENGTH_RE.test(value) || COLOR_RE.test(value) || NUMBER_RE.test(value)) {
          issues.push({
            level: 'error',
            check: '写死数值',
            file,
            message: `${sel} 的 ${prop} 含写死数值「${value}」:必须改为变量`
          })
        }
      }
    }
  }
}

function walk(nodes: PageNode[], fn: (n: PageNode) => void): void {
  for (const n of nodes) {
    fn(n)
    if (n.children) walk(n.children, fn)
  }
}

function checkStructure(page: PageNode[], file: string, issues: Issues): void {
  walk(page, (n) => {
    const where = `<${n.tag || '?'}${n.cls ? ` class="${n.cls}"` : ''}>`
    if (!n.tag)
      issues.push({ level: 'error', check: '缺标签与属性', file, message: `${where} 缺标签名` })
    if (n.tag === 'a' && !n.attrs?.['href']) {
      issues.push({ level: 'error', check: '缺标签与属性', file, message: `${where} 缺 href` })
    }
    if (n.tag === 'button' && !n.attrs?.['type']) {
      issues.push({ level: 'error', check: '缺标签与属性', file, message: `${where} 缺 type` })
    }
  })
}

function resolveRel(fromFile: string, href: string): string {
  const parts = fromFile.split('/').slice(0, -1)
  for (const seg of href.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

function escapesRoot(fromFile: string, href: string): boolean {
  let depth = fromFile.split('/').length - 1
  for (const seg of href.split('/')) {
    if (seg === '..') depth--
    else if (seg !== '.' && seg !== '') depth++
    if (depth < 0) return true
  }
  return false
}

function checkRefs(pkg: SpecPackage, issues: Issues): void {
  const defined = new Set(
    [...(pkg.files['tokens.css'] ?? '').matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1])
  )
  const fontFiles = new Set(pkg.fonts.flatMap((p) => p.files.map((f) => `fonts/${p.dir}/${f}`)))
  const exists = (path: string): boolean => path in pkg.files || fontFiles.has(path)
  for (const [file, text] of Object.entries(pkg.files)) {
    if (file.endsWith('.css')) {
      for (const m of text.matchAll(/var\(--([\w-]+)\)/g)) {
        if (!defined.has(m[1])) {
          issues.push({
            level: 'error',
            check: '引用失效',
            file,
            message: `引用了不存在的变量 --${m[1]}`
          })
        }
      }
    }
    const linkRe = file.endsWith('.css') ? /url\(([^)]+)\)/g : /(?:href|src)="([^"#][^"]*)"/g
    if (!file.endsWith('.css') && !file.endsWith('.html')) continue
    for (const m of text.matchAll(linkRe)) {
      const href = m[1].replace(/['"]/g, '')
      if (/^[a-z]+:/i.test(href)) continue
      if (escapesRoot(file, href)) {
        issues.push({
          level: 'error',
          check: '引用失效',
          file,
          message: `路径指向规格包外:${href}`
        })
      } else if (!exists(resolveRel(file, href))) {
        issues.push({
          level: 'error',
          check: '引用失效',
          file,
          message: `引用的文件不存在:${href}`
        })
      }
    }
  }
  for (const [file, text] of Object.entries(pkg.files)) {
    if (!file.endsWith('.md')) continue
    for (const m of text.matchAll(/icons\/([\w-]+)\.svg/g)) {
      if (!exists(`icons/${m[1]}.svg`)) {
        issues.push({
          level: 'error',
          check: '引用失效',
          file,
          message: `引用的图标不存在:icons/${m[1]}.svg`
        })
      }
    }
  }
}

function checkDemoLeak(pkg: SpecPackage, issues: Issues): void {
  for (const [file, text] of Object.entries(pkg.files)) {
    if (!COMPONENT_CSS(file)) continue
    for (const { sel } of cssBlocks(text)) {
      if (DEMO_CLASS_PATTERNS.some((re) => re.test(sel))) {
        issues.push({
          level: 'error',
          check: '演示代码泄漏',
          file,
          message: `组件样式里出现演示专用选择器 ${sel}`
        })
      }
    }
  }
}

function checkResetCoverage(page: PageNode[], file: string, issues: Issues): void {
  for (const tag of tagsOf(page)) {
    if (UA_STYLED_TAGS.has(tag) && !RESET_TAGS.includes(tag)) {
      issues.push({
        level: 'warn',
        check: '默认样式依赖',
        file,
        message: `<${tag}> 有浏览器默认样式,但 reset.css 未清零`
      })
    }
  }
}

function checkInlineSpacing(
  pkg: SpecPackage,
  page: PageNode[],
  file: string,
  issues: Issues
): void {
  const layoutClasses = new Set<string>()
  for (const [path, text] of Object.entries(pkg.files)) {
    if (!path.endsWith('.css')) continue
    for (const { sel, body } of cssBlocks(text)) {
      if (!/display\s*:\s*(inline-)?(flex|grid)/.test(body)) continue
      for (const m of sel.matchAll(/\.([\w-]+)\s*(?:,|$)/g)) layoutClasses.add(m[1])
    }
  }
  walk(page, (n) => {
    const kids = n.children ?? []
    const inlineKids = kids.filter((k) => INLINE_TAGS.has(k.tag))
    if (inlineKids.length < 2) return
    const isLayout = (n.cls ?? '').split(/\s+/).some((c) => layoutClasses.has(c))
    if (!isLayout) {
      issues.push({
        level: 'warn',
        check: '行内间距依赖',
        file,
        message: `<${n.tag} class="${n.cls ?? ''}"> 的同级行内元素依赖空白分隔:父级必须为 flex / grid`
      })
    }
  })
}

function checkStates(pkg: SpecPackage, issues: Issues): void {
  for (const recipe of RECIPES) {
    if (recipe.states.length === 0) continue
    const file = `components/${recipe.id}.css`
    const css = pkg.files[file] ?? ''
    for (const s of INTERACTIVE_STATES) {
      if (!css.includes(s)) {
        issues.push({ level: 'warn', check: '状态缺失', file, message: `交互组件缺少 ${s} 状态` })
      }
    }
  }
}

function checkUnreferenced(pkg: SpecPackage, issues: Issues): void {
  const readme = pkg.files['README-给AI.md'] ?? ''
  for (const file of Object.keys(pkg.files)) {
    if (file === 'README-给AI.md') continue
    if (!readme.includes(`\`${file}\``)) {
      issues.push({
        level: 'warn',
        check: '未引用文件',
        file,
        message: 'README 文件索引里没有登记这个文件'
      })
    }
  }
}

/** 体检入口:pages = 每个页面规格文件对应的结构树 */
export function lintPackage(pkg: SpecPackage, pages: Record<string, PageNode[]>): LintIssue[] {
  const issues: Issues = []
  checkVague(pkg, issues)
  checkLiterals(pkg, issues)
  for (const [file, body] of Object.entries(pages)) {
    checkStructure(body, file, issues)
    checkResetCoverage(body, file, issues)
    checkInlineSpacing(pkg, body, file, issues)
  }
  checkRefs(pkg, issues)
  checkDemoLeak(pkg, issues)
  checkDesignJsonData(pkg, issues)
  checkConsistency(pkg, issues)
  checkStates(pkg, issues)
  checkUnreferenced(pkg, issues)
  return issues
}

export function hasErrors(issues: LintIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}
