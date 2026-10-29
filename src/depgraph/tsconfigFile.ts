// 读 tsconfig 系列文件:JSONC 解析、相对 extends 链合并、根配置 references 展开。
// 只认项目内的相对路径;包名形式的 extends(如 '@electron-toolkit/tsconfig/...')要进 node_modules 找,不跟。
import { toProjectRel } from './relPath.ts'

/** 按项目根相对路径读文本;读不到返回 null */
export type ReadProjectFile = (relPath: string) => Promise<string | null>

/** 一份配置合并 extends 链后与别名有关的选项;路径都已换成项目根相对路径 */
export interface EffectiveTsOptions {
  /** 生效的 baseUrl;没有或越出项目根为 null */
  baseUrl: string | null
  /** 生效的 baseUrl 写了但越出项目根(绝对路径、盘符、../ 上跳):这份配置的别名整体停用 */
  isBaseUrlOutOfRoot: boolean
  /** 生效的 paths 原文;没有为 null */
  paths: Record<string, unknown> | null
  /** 声明 paths 的那份配置所在目录:没有 baseUrl 时 paths 相对它解析 */
  pathsDir: string
}

interface RawTsConfig {
  extends: string[]
  references: string[]
  compilerOptions: Record<string, unknown>
}

/** extends 链最多跟几层;正常项目两三层,环由 visited 拦,这里只防病态长链 */
const EXTENDS_MAX_DEPTH = 8

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** 解析一份 tsconfig 文本;不是合法 JSONC 或顶层不是对象返回 null(坏配置不该让关系分析失败) */
export function parseTsConfigText(text: string): RawTsConfig | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonc(text.replace(/^\uFEFF/, '')))
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const references = Array.isArray(parsed.references)
    ? parsed.references.flatMap((r) => (isRecord(r) && typeof r.path === 'string' ? [r.path] : []))
    : []
  return {
    extends: stringList(parsed.extends),
    references,
    compilerOptions: isRecord(parsed.compilerOptions) ? parsed.compilerOptions : {}
  }
}

function dirOfRel(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash < 0 ? '' : relPath.slice(0, slash)
}

/** extends 目标 → 项目根相对的配置文件路径;包名形式与越界路径返回 null */
function resolveExtendsTarget(fromDir: string, target: string): string | null {
  if (!target.startsWith('./') && !target.startsWith('../')) return null
  const rel = toProjectRel(fromDir, target)
  if (rel === null) return null
  return rel.endsWith('.json') ? rel : `${rel}.json`
}

/** references 的 path 可以是文件也可以是目录(目录取其中的 tsconfig.json) */
function resolveReferenceTarget(fromDir: string, target: string): string | null {
  const rel = toProjectRel(fromDir, target)
  if (rel === null) return null
  if (rel.endsWith('.json')) return rel
  return rel === '' ? 'tsconfig.json' : `${rel}/tsconfig.json`
}

/** 写了 baseUrl 时的生效值:换算不成项目内路径即越界 */
export function baseUrlOf(
  rel: string | null
): Pick<EffectiveTsOptions, 'baseUrl' | 'isBaseUrlOutOfRoot'> {
  return { baseUrl: rel, isBaseUrlOutOfRoot: rel === null }
}

/** 子配置的选项覆盖父配置(与 TS 一致:paths 整体替换,不逐条合并) */
function overlayOptions(
  parent: EffectiveTsOptions,
  options: Record<string, unknown>,
  dir: string
): EffectiveTsOptions {
  const base =
    typeof options.baseUrl === 'string'
      ? baseUrlOf(toProjectRel(dir, options.baseUrl))
      : { baseUrl: parent.baseUrl, isBaseUrlOutOfRoot: parent.isBaseUrlOutOfRoot }
  if (!isRecord(options.paths)) return { ...parent, ...base }
  return { ...base, paths: options.paths, pathsDir: dir }
}

interface LoadState {
  read: ReadProjectFile
  visiting: Set<string>
}

/** 读一份配置并合并它的 extends 链;读不到、坏掉、成环或超深时返回 null */
async function loadEffective(
  relPath: string,
  state: LoadState,
  depth: number
): Promise<{ options: EffectiveTsOptions; references: string[] } | null> {
  if (depth > EXTENDS_MAX_DEPTH || state.visiting.has(relPath)) return null
  const text = await state.read(relPath)
  const config = text === null ? null : parseTsConfigText(text)
  if (!config) return null
  const dir = dirOfRel(relPath)
  state.visiting.add(relPath)
  let merged: EffectiveTsOptions = {
    baseUrl: null,
    isBaseUrlOutOfRoot: false,
    paths: null,
    pathsDir: dir
  }
  for (const target of config.extends) {
    const parentPath = resolveExtendsTarget(dir, target)
    const parent = parentPath === null ? null : await loadEffective(parentPath, state, depth + 1)
    if (parent) merged = mergeParent(merged, parent.options)
  }
  state.visiting.delete(relPath)
  const references = config.references.flatMap((r) => resolveReferenceTarget(dir, r) ?? [])
  return { options: overlayOptions(merged, config.compilerOptions, dir), references }
}

/** 多个 extends 时后者覆盖前者 */
function mergeParent(base: EffectiveTsOptions, next: EffectiveTsOptions): EffectiveTsOptions {
  const hasNextBase = next.baseUrl !== null || next.isBaseUrlOutOfRoot
  return {
    baseUrl: hasNextBase ? next.baseUrl : base.baseUrl,
    isBaseUrlOutOfRoot: hasNextBase ? next.isBaseUrlOutOfRoot : base.isBaseUrlOutOfRoot,
    paths: next.paths ?? base.paths,
    pathsDir: next.paths ? next.pathsDir : base.pathsDir
  }
}

/**
 * 根 tsconfig.json 与它 references 里的每份配置(只展开一层),各自合并 extends 链后按出现顺序返回。
 * 根配置读不到时返回空数组。
 */
export async function loadTsConfigChain(read: ReadProjectFile): Promise<EffectiveTsOptions[]> {
  const root = await loadEffective('tsconfig.json', { read, visiting: new Set() }, 0)
  if (!root) return []
  const out = [root.options]
  const seen = new Set(['tsconfig.json'])
  for (const ref of root.references) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const loaded = await loadEffective(ref, { read, visiting: new Set() }, 0)
    if (loaded) out.push(loaded.options)
  }
  return out
}
