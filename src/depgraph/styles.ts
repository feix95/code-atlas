// 样式文件的关系:谁导入了它(代码 import 与样式 @import)、谁用了它定义的类名。
// 只产出 StyleLink 交给模块切分做附挂;样式不是可分析文件,不进文件导入边。
import { promises as fs } from 'node:fs'
import { joinRoot } from '../shared/paths.ts'
import { SOURCE_PARSE_MAX_BYTES } from '../shared/analysisLimits.ts'
import type { StyleLink } from '../modules/cutModules.ts'
import { normalizeParts } from './relPath.ts'
import { resolveTsAlias, type TsPathAliases } from './tsPaths.ts'

const STYLE_EXT = /\.(css|scss|sass|less)$/i

/** 源码里的一份文本,供类名使用统计 */
export interface SourceText {
  relPath: string
  code: string
}

function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 去掉 '?inline'、'#x' 这类构建工具后缀后,判断是不是样式文件 */
function stripQuery(spec: string): string {
  return spec.replace(/[?#].*$/, '')
}

export function isStylePath(path: string): boolean {
  return STYLE_EXT.test(stripQuery(path))
}

/** @import './a.css' / @import url("b.css") / @import url(c.css) 的路径部分,按出现顺序 */
export function extractCssImports(text: string): string[] {
  const pattern = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?/g
  return [...stripCssComments(text).matchAll(pattern)].map((m) => m[2])
}

/** 选择器里出现的类名(只看每个 '{' 之前的选择器段,数值小数与 url() 不算),去重排序 */
export function extractCssClasses(text: string): string[] {
  const classes = new Set<string>()
  for (const prelude of stripCssComments(text).split('{').slice(0, -1)) {
    const selector = prelude.slice(Math.max(prelude.lastIndexOf('}'), prelude.lastIndexOf(';')) + 1)
    for (const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1])
  }
  return [...classes].sort()
}

/** 源码字符串字面量('…'、"…"、`…`)里出现的词;类名只会写在字符串里,标识符与注释不算 */
function stringTokens(code: string): Set<string> {
  const tokens = new Set<string>()
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    for (const word of m[2].split(/[^\w-]+/)) if (word) tokens.add(word)
  }
  return tokens
}

/**
 * 类名使用量 → usage 链接:一个类名被 n 个源码文件用到,每个文件得 1/n,再按 (文件, 样式) 累加。
 * 均分权重让 'active' 这类到处用的通用类名几乎不起作用,专属类名决定样式归属。
 */
export function classUsageLinks(
  classesByStyle: Map<string, string[]>,
  sources: SourceText[]
): StyleLink[] {
  const ordered = [...sources].sort((x, y) => (x.relPath < y.relPath ? -1 : 1))
  const tokensByFile = ordered.map((s) => ({ relPath: s.relPath, tokens: stringTokens(s.code) }))
  const weights = new Map<string, StyleLink>()
  for (const style of [...classesByStyle.keys()].sort()) {
    for (const cls of classesByStyle.get(style) ?? []) {
      const users = tokensByFile.filter((f) => f.tokens.has(cls))
      for (const user of users) {
        const key = JSON.stringify([user.relPath, style])
        const entry = weights.get(key) ?? {
          from: user.relPath,
          to: style,
          kind: 'usage',
          weight: 0
        }
        entry.weight += 1 / users.length
        weights.set(key, entry)
      }
    }
  }
  return [...weights.values()].sort((x, y) =>
    x.from === y.from ? (x.to < y.to ? -1 : 1) : x.from < y.from ? -1 : 1
  )
}

/** 样式导入说明符 → 项目内样式文件:相对路径按导入方目录拼,非相对的先过 tsconfig 别名;依赖包里的不连 */
export function resolveStylePath(
  fromRel: string,
  spec: string,
  styleFiles: Set<string>,
  aliases: TsPathAliases | null
): string | null {
  const clean = stripQuery(spec)
  const exact = (base: string): string | null => (styleFiles.has(base) ? base : null)
  if (!clean.startsWith('.')) return resolveTsAlias(clean, aliases, exact)?.to ?? null
  const parts = normalizeParts([...fromRel.split('/').slice(0, -1), ...clean.split('/')])
  return parts ? exact(parts.join('/')) : null
}

async function readStyle(rootPath: string, relPath: string): Promise<string | null> {
  const absPath = joinRoot(rootPath, relPath)
  const stat = await fs.stat(absPath).catch(() => null)
  if (!stat || !stat.isFile() || stat.size > SOURCE_PARSE_MAX_BYTES) return null
  return fs.readFile(absPath, 'utf8').catch(() => null)
}

/** 读全部样式文件:@import 链接与类名使用链接;读不了的样式跳过(仍可按目录就近归属) */
export async function collectStyleLinks(
  rootPath: string,
  styleFiles: Set<string>,
  sources: SourceText[]
): Promise<StyleLink[]> {
  const links: StyleLink[] = []
  const classesByStyle = new Map<string, string[]>()
  for (const style of [...styleFiles].sort()) {
    const text = await readStyle(rootPath, style)
    if (text === null) continue
    classesByStyle.set(style, extractCssClasses(text))
    for (const spec of extractCssImports(text)) {
      const to = resolveStylePath(
        style,
        spec.startsWith('.') ? spec : `./${spec}`,
        styleFiles,
        null
      )
      if (to && to !== style) links.push({ from: style, to, kind: 'import', weight: 1 })
    }
  }
  return [...links, ...classUsageLinks(classesByStyle, sources)]
}
