// tsconfig 的 compilerOptions.paths / baseUrl 别名:把 '@shared/x' 这类非相对导入翻译成项目内路径。
// 只认项目根 tsconfig.json;不跟 extends 链,一条规则多个目标只取第一个,取不到的交给调用方记 unresolved。
import { promises as fs } from 'node:fs'
import { joinRoot } from '../shared/paths.ts'
import { normalizeParts } from './relPath.ts'

/** 一条 paths 规则:pattern 按唯一的 '*' 拆成前后缀;target 已拼好 baseUrl,'/' 分隔 */
interface PathRule {
  prefix: string
  suffix: string
  hasWildcard: boolean
  target: string
}

export interface TsPathAliases {
  rules: PathRule[]
  /** baseUrl 相对项目根的路径('' 为项目根);没写或不可用为 null */
  baseUrl: string | null
}

/** 别名命中后的结果;结构与 resolvers 的 ImportResolution 一致 */
export interface AliasResolution {
  to: string | null
  external: boolean
}

/** JSONC → JSON:去掉字符串外的 // 与 块注释,再去掉字符串外 } 或 ] 前的尾逗号 */
function stripJsonc(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 1
      continue
    }
    if (ch === '"') inString = true
    out += ch
  }
  return removeTrailingCommas(out)
}

function removeTrailingCommas(json: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]
    if (inString) {
      out += ch
      if (ch === '\\') out += json[++i] ?? ''
      else if (ch === '"') inString = false
      continue
    }
    if (ch === ',' && /^\s*[}\]]/.test(json.slice(i + 1))) continue
    if (ch === '"') inString = true
    out += ch
  }
  return out
}

/** tsconfig 里写的相对路径 → 项目根相对路径;绝对路径、盘符、上跳出根一律不可用(null) */
function toProjectRel(base: string, path: string): string | null {
  const unified = path.replaceAll('\\', '/')
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) return null
  const parts = normalizeParts([...base.split('/'), ...unified.split('/')])
  return parts ? parts.join('/') : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRule(pattern: string, targets: unknown, base: string): PathRule | null {
  if (!Array.isArray(targets) || typeof targets[0] !== 'string') return null
  const star = pattern.indexOf('*')
  if (star !== pattern.lastIndexOf('*')) return null
  const target = toProjectRel(base, targets[0])
  if (target === null) return null
  if (star < 0) return { prefix: pattern, suffix: '', hasWildcard: false, target }
  return {
    prefix: pattern.slice(0, star),
    suffix: pattern.slice(star + 1),
    hasWildcard: true,
    target
  }
}

/**
 * 解析 tsconfig 文本。返回 null 表示「没有可用的别名配置」(不是合法 JSONC、没有 paths 与 baseUrl),
 * 调用方据此保持改前行为 —— 坏掉的 tsconfig 不该让关系分析整体失败。
 */
export function parseTsPathAliases(text: string): TsPathAliases | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonc(text.replace(/^\uFEFF/, '')))
  } catch {
    return null
  }
  const options = isRecord(parsed) ? parsed.compilerOptions : undefined
  if (!isRecord(options)) return null
  const baseUrl = typeof options.baseUrl === 'string' ? toProjectRel('', options.baseUrl) : null
  const rules: PathRule[] = []
  if (isRecord(options.paths)) {
    for (const [pattern, targets] of Object.entries(options.paths)) {
      const rule = parseRule(pattern, targets, baseUrl ?? '')
      if (rule) rules.push(rule)
    }
  }
  if (rules.length === 0 && baseUrl === null) return null
  return { rules, baseUrl }
}

/** 读项目根 tsconfig.json;不存在或读不了时返回 null(与改前行为一致) */
export async function loadTsPathAliases(rootPath: string): Promise<TsPathAliases | null> {
  const raw = await fs.readFile(joinRoot(rootPath, 'tsconfig.json'), 'utf8').catch(() => null)
  return raw === null ? null : parseTsPathAliases(raw)
}

/** paths 命中结果:target 为 null 表示替换后上跳出根;isCatchAll 表示命中的是纯 '*' 兜底规则 */
interface RuleHit {
  target: string | null
  isCatchAll: boolean
}

/** 按 TypeScript 的规则挑 paths:精确规则优先,其次前缀最长的通配规则;没有规则命中返回 undefined */
function applyPathRules(spec: string, rules: PathRule[]): RuleHit | undefined {
  const exact = rules.find((r) => !r.hasWildcard && r.prefix === spec)
  if (exact) return { target: exact.target, isCatchAll: false }
  let best: PathRule | null = null
  for (const rule of rules) {
    if (!rule.hasWildcard || spec.length < rule.prefix.length + rule.suffix.length) continue
    if (!spec.startsWith(rule.prefix) || !spec.endsWith(rule.suffix)) continue
    if (!best || rule.prefix.length > best.prefix.length) best = rule
  }
  if (!best) return undefined
  const matched = spec.slice(best.prefix.length, spec.length - best.suffix.length)
  return {
    target: toProjectRel('', best.target.replace('*', matched)),
    isCatchAll: best.prefix === '' && best.suffix === ''
  }
}

/**
 * 非相对导入先过别名。paths 命中:连上算项目内边,连不上记 unresolved(不再算外部包);
 * 纯 '*' 兜底规则(如 "*": ["types/*"])什么都能命中,连不上时交回外部包判定,不把 react 记成断线;
 * 只有 baseUrl:baseUrl 下真有这个文件才连,否则返回 null 交回外部包判定(TS 同样先试 baseUrl 再找依赖包)。
 */
export function resolveTsAlias(
  spec: string,
  aliases: TsPathAliases | null,
  matchFile: (base: string) => string | null
): AliasResolution | null {
  if (!aliases || spec.startsWith('/')) return null
  const hit = applyPathRules(spec, aliases.rules)
  if (hit !== undefined) {
    const to = hit.target ? matchFile(hit.target) : null
    if (to || !hit.isCatchAll) return { to, external: false }
  }
  if (aliases.baseUrl === null) return null
  const base = toProjectRel(aliases.baseUrl, spec)
  const to = base ? matchFile(base) : null
  return to ? { to, external: false } : null
}
