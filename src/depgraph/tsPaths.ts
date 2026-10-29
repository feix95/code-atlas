// tsconfig 的 compilerOptions.paths / baseUrl 别名:把 '@shared/x' 这类非相对导入翻译成项目内路径。
// 读根 tsconfig.json 及其 references,各自跟相对 extends 链;一条规则的多个目标按顺序逐个试,
// 全都连不上的交给调用方记 unresolved。
import { promises as fs } from 'node:fs'
import { joinRoot } from '../shared/paths.ts'
import { toProjectRel } from './relPath.ts'
import {
  baseUrlOf,
  isRecord,
  loadTsConfigChain,
  parseTsConfigText,
  type EffectiveTsOptions,
  type ReadProjectFile
} from './tsconfigFile.ts'

/** 一条 paths 规则:pattern 按唯一的 '*' 拆成前后缀;targets 已拼好 baseUrl,'/' 分隔,保持声明顺序 */
interface PathRule {
  prefix: string
  suffix: string
  hasWildcard: boolean
  targets: string[]
}

export interface TsPathAliases {
  rules: PathRule[]
  /** 各配置的 baseUrl(相对项目根,'' 为项目根),去重后按配置出现顺序 */
  baseUrls: string[]
}

/** 别名命中后的结果;结构与 resolvers 的 ImportResolution 一致 */
export interface AliasResolution {
  to: string | null
  external: boolean
}

function parseTargets(targets: unknown, base: string): string[] {
  if (!Array.isArray(targets)) return []
  return targets.flatMap((t) => (typeof t === 'string' ? (toProjectRel(base, t) ?? []) : []))
}

function splitPattern(pattern: string): Omit<PathRule, 'targets'> | null {
  const star = pattern.indexOf('*')
  if (star !== pattern.lastIndexOf('*')) return null
  if (star < 0) return { prefix: pattern, suffix: '', hasWildcard: false }
  return { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1), hasWildcard: true }
}

/** 多份配置的规则合并:同一 pattern 的目标按配置顺序拼接去重,pattern 保持首次出现的顺序 */
function buildAliases(configs: EffectiveTsOptions[]): TsPathAliases | null {
  const byPattern = new Map<string, PathRule>()
  const baseUrls: string[] = []
  for (const config of configs) {
    // baseUrl 越界时 paths 的基准已不可知:与其悄悄改按配置所在目录解析连错文件,不如整份停用、交回外部包判定
    if (config.isBaseUrlOutOfRoot) continue
    if (config.baseUrl !== null && !baseUrls.includes(config.baseUrl)) baseUrls.push(config.baseUrl)
    if (!isRecord(config.paths)) continue
    const base = config.baseUrl ?? config.pathsDir
    for (const [pattern, raw] of Object.entries(config.paths)) {
      const shape = splitPattern(pattern)
      const targets = parseTargets(raw, base)
      if (!shape || targets.length === 0) continue
      const rule = byPattern.get(pattern) ?? { ...shape, targets: [] }
      for (const t of targets) if (!rule.targets.includes(t)) rule.targets.push(t)
      byPattern.set(pattern, rule)
    }
  }
  const rules = [...byPattern.values()]
  return rules.length === 0 && baseUrls.length === 0 ? null : { rules, baseUrls }
}

/**
 * 解析单份 tsconfig 文本(视作项目根下的配置,不跟 extends)。返回 null 表示「没有可用的别名配置」
 * (不是合法 JSONC、没有 paths 与 baseUrl),调用方据此保持改前行为。
 */
export function parseTsPathAliases(text: string): TsPathAliases | null {
  const config = parseTsConfigText(text)
  if (!config) return null
  const options = config.compilerOptions
  const base =
    typeof options.baseUrl === 'string'
      ? baseUrlOf(toProjectRel('', options.baseUrl))
      : { baseUrl: null, isBaseUrlOutOfRoot: false }
  const paths = isRecord(options.paths) ? options.paths : null
  return buildAliases([{ ...base, paths, pathsDir: '' }])
}

/** 读根 tsconfig.json、它的 references 与相对 extends 链;都读不到或没有别名时返回 null */
export async function loadTsPathAliases(rootPath: string): Promise<TsPathAliases | null> {
  const read: ReadProjectFile = (rel) =>
    fs.readFile(joinRoot(rootPath, rel), 'utf8').catch(() => null)
  return buildAliases(await loadTsConfigChain(read))
}

/** paths 命中结果:candidates 为替换后的候选(上跳出根的已剔除);isCatchAll 表示命中的是纯 '*' 兜底规则 */
interface RuleHit {
  candidates: string[]
  isCatchAll: boolean
}

/** 按 TypeScript 的规则挑 paths:精确规则优先,其次前缀最长的通配规则;没有规则命中返回 undefined */
function applyPathRules(spec: string, rules: PathRule[]): RuleHit | undefined {
  const exact = rules.find((r) => !r.hasWildcard && r.prefix === spec)
  if (exact) return { candidates: exact.targets, isCatchAll: false }
  let best: PathRule | null = null
  for (const rule of rules) {
    if (!rule.hasWildcard || spec.length < rule.prefix.length + rule.suffix.length) continue
    if (!spec.startsWith(rule.prefix) || !spec.endsWith(rule.suffix)) continue
    if (!best || rule.prefix.length > best.prefix.length) best = rule
  }
  if (!best) return undefined
  const matched = spec.slice(best.prefix.length, spec.length - best.suffix.length)
  return {
    candidates: best.targets.flatMap((t) => toProjectRel('', t.replace('*', matched)) ?? []),
    isCatchAll: best.prefix === '' && best.suffix === ''
  }
}

function firstMatch(bases: string[], matchFile: (base: string) => string | null): string | null {
  for (const base of bases) {
    const to = matchFile(base)
    if (to) return to
  }
  return null
}

/**
 * 非相对导入先过别名。paths 命中:候选按顺序试,连上算项目内边,都连不上记 unresolved(不再算外部包);
 * 纯 '*' 兜底规则(如 "*": ["types/*"])什么都能命中,连不上时交回外部包判定,不把 react 记成断线;
 * 只有 baseUrl:某个 baseUrl 下真有这个文件才连,否则返回 null 交回外部包判定(TS 同样先试 baseUrl 再找依赖包)。
 */
export function resolveTsAlias(
  spec: string,
  aliases: TsPathAliases | null,
  matchFile: (base: string) => string | null
): AliasResolution | null {
  if (!aliases || spec.startsWith('/')) return null
  const hit = applyPathRules(spec, aliases.rules)
  if (hit !== undefined) {
    const to = firstMatch(hit.candidates, matchFile)
    if (to || !hit.isCatchAll) return { to, external: false }
  }
  const bases = aliases.baseUrls.flatMap((b) => toProjectRel(b, spec) ?? [])
  const to = firstMatch(bases, matchFile)
  return to ? { to, external: false } : null
}
