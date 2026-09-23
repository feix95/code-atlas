// 项目关系分析器:扫全项目,算出"谁引用谁"。
// 路径契约:只认节点上的 relPath,读文件一律走 joinRoot,和扫描/AST 模块同一套约定。
import { promises as fs } from 'node:fs'
import { scanDirectory } from '../scanner/index.ts'
import { analyzeSource, isAnalysisSupported } from '../analyzer/index.ts'
import { joinRoot } from '../shared/paths.ts'
import { LANGUAGES } from '../shared/languages.ts'
import { SOURCE_PARSE_MAX_BYTES } from '../shared/analysisLimits.ts'
import type {
  DepEdge,
  DepGraphResult,
  LanguageTag,
  ScanFileNode,
  ScanTreeNode,
  UnresolvedImport
} from '../shared/types.ts'

function collectFiles(node: ScanTreeNode, into: ScanFileNode[]): void {
  if (node.type === 'file') {
    into.push(node)
    return
  }
  for (const child of node.children) collectFiles(child, into)
}

/** 把路径段归一化(处理 ./ 和 ../),全用 '/' 分隔;上跳出项目根返回 null */
function normalizeParts(parts: string[]): string[] | null {
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out
}

/** 一条导入的翻译结果:to 连到了哪个项目内文件;连不上时 external 说明这线是不是指向外面的包 */
interface ImportResolution {
  to: string | null
  external: boolean
}

/** 项目布局线索:主循环开场探测一次,所有 resolver 共用,别每条导入都去翻项目根 */
interface ImportHints {
  /** go.mod 里 module 声明的名字;没有 go.mod 就是 null,Go 导入一律算外部 */
  goModule: string | null
  /** Go 的包目录 → 该目录下字典序第一个 .go 文件(Go 引用的是"包目录",边得落在具体文件上) */
  goDirs: Map<string, string>
  /** Java 源码根(相对项目根):探测到 Maven 标准布局就把 src/main/java 也算一个 */
  javaRoots: string[]
  /** cargo 布局的 crate 根:有 .rs 文件住在 src/ 下就是 'src',否则 null */
  rustRoot: string | null
}

/** 每种语言的导入翻译器:把 analyzer 抓出来的导入说明符翻译成项目内的文件 */
type ImportResolver = (req: {
  fromRel: string
  spec: string
  known: Set<string>
  hints: ImportHints
}) => ImportResolution

function firstKnown(candidates: string[], known: Set<string>): string | null {
  for (const candidate of candidates) {
    if (known.has(candidate)) return candidate
  }
  return null
}

/**
 * JS/TS 的相对导入('./x'、'../y/z')解析成项目内文件的 relPath。
 * 尝试原样、补后缀、补 /index 三轮;连不上记 unresolved(别名、css、动态路径这类)。
 * 非相对开头的(react、node:path、@scope/pkg)由 isExternalSpec 分流:外部包还是别名。
 */
function resolveJsImport({
  fromRel,
  spec,
  known
}: {
  fromRel: string
  spec: string
  known: Set<string>
}): ImportResolution {
  if (!spec.startsWith('.')) return { to: null, external: isExternalSpec(spec) }
  const base = fromRel.split('/').slice(0, -1)
  const normalized = normalizeParts([...base, ...spec.split('/')])
  if (!normalized) return { to: null, external: false }
  const joined = normalized.join('/')
  if (known.has(joined)) return { to: joined, external: false }
  for (const ext of JS_EXTS) {
    if (known.has(joined + ext)) return { to: joined + ext, external: false }
  }
  for (const ext of JS_EXTS) {
    if (known.has(`${joined}/index${ext}`)) return { to: `${joined}/index${ext}`, external: false }
  }
  return { to: null, external: false }
}

/**
 * 判断 JS 导入说明符是不是外部包:react、node:path、@scope/pkg 这类非相对、非绝对路径。
 * '@/x'、'~/x' 是常见别名前缀,不算外部包,归到 unresolved。
 */
function isExternalSpec(spec: string): boolean {
  if (spec.startsWith('@/') || spec.startsWith('~/')) return false
  return !spec.startsWith('.') && !spec.startsWith('/')
}

/**
 * Python 导入:'a.b.c' 点分名 → a/b/c.py 或 a/b/c/__init__.py;
 * 相对导入('.x'、'..pkg')按点数从当前文件目录上跳;纯 '.' 连当前包的 __init__.py。
 * 绝对导入只按项目根找(Python 包平铺在根的主流布局);连不上按外部包记,不硬连。
 */
function resolvePyImport({
  fromRel,
  spec,
  known
}: {
  fromRel: string
  spec: string
  known: Set<string>
}): ImportResolution {
  if (spec.startsWith('.')) {
    let up = 0
    while (spec[up] === '.') up++
    const rest = spec.slice(up)
    const base = fromRel.split('/').slice(0, -1)
    const parts = up > 1 ? base.slice(0, Math.max(0, base.length - (up - 1))) : base
    if (!rest) return { to: firstKnown([`${parts.join('/')}/__init__.py`], known), external: false }
    const joined = [...parts, ...rest.split('.')].join('/')
    return { to: firstKnown([`${joined}.py`, `${joined}/__init__.py`], known), external: false }
  }
  const joined = spec.split('.').join('/')
  return { to: firstKnown([`${joined}.py`, `${joined}/__init__.py`], known), external: true }
}

/**
 * Go 导入:'example.com/repo/pkg' 只有对上 go.mod 的 module 前缀才算项目内,
 * 前缀砍掉剩下的就是包目录;边落在该目录字典序第一个 .go 上(同目录同包,一个代表全包)。
 * 对不上前缀的是标准库或第三方,算外部。
 */
function resolveGoImport({ spec, hints }: { spec: string; hints: ImportHints }): ImportResolution {
  if (!hints.goModule || !spec.startsWith(hints.goModule)) return { to: null, external: true }
  const sub = spec.slice(hints.goModule.length)
  const dir = sub.startsWith('/') ? sub.slice(1) : sub
  return { to: hints.goDirs.get(dir) ?? null, external: false }
}

/**
 * Java 导入:'com.acme.Service' → 源码根下的 com/acme/Service.java。
 * 静态导入和内部类会多带一两段(com.acme.Service.run),全名找不到就砍掉最后一段再试,最多砍两段;
 * 都找不到是 JDK 或第三方包,算外部。
 */
function resolveJavaImport({
  spec,
  known,
  hints
}: {
  spec: string
  known: Set<string>
  hints: ImportHints
}): ImportResolution {
  const segs = spec.split('.')
  for (let cut = 0; cut <= 2 && cut < segs.length; cut++) {
    const cls = segs.slice(0, segs.length - cut).join('/')
    for (const root of hints.javaRoots) {
      const candidate = root ? `${root}/${cls}.java` : `${cls}.java`
      if (known.has(candidate)) return { to: candidate, external: false }
    }
  }
  return { to: null, external: true }
}

/** Rust 模块路径 → 候选文件:x 模块要么是 x.rs 要么是 x/mod.rs */
function rustFileCandidates(root: string[], modPath: string[]): string[] {
  const base = [...root, ...modPath].join('/')
  return [`${base}.rs`, `${base}/mod.rs`]
}

/**
 * Rust 导入:'crate::a::b' 从 crate 根(cargo 布局的 src/)出发。
 * 主流写法最后一段是模块里的类型/函数(crate::config::AppConfig 住在 config.rs 里),
 * 所以先试砍掉最后一段的模块文件,不中再试它是子模块文件本身。
 * 'super::x' 从当前目录上跳;裸名('mod x;' 抓出来的)就在当前目录找;
 * 多段裸名(serde::Serialize)和 '::x' 全局路径是外部 crate,不硬连。
 */
function resolveRustImport({
  fromRel,
  spec,
  known,
  hints
}: {
  fromRel: string
  spec: string
  known: Set<string>
  hints: ImportHints
}): ImportResolution {
  const root = hints.rustRoot ? [hints.rustRoot] : []
  const base = fromRel.split('/').slice(0, -1)
  if (spec.startsWith('crate::')) {
    const path = spec.slice('crate::'.length).split('::')
    const to = firstKnown(
      [...rustFileCandidates(root, path.slice(0, -1)), ...rustFileCandidates(root, path)],
      known
    )
    return { to, external: false }
  }
  if (
    spec.startsWith('::') ||
    (spec.includes('::') && !spec.startsWith('super::') && !spec.startsWith('self::'))
  ) {
    return { to: null, external: true }
  }
  let up = 0
  let rest = spec
  while (rest.startsWith('super::')) {
    rest = rest.slice('super::'.length)
    up++
  }
  rest = rest.replace(/^self::/, '')
  // super 上跳的地板是 crate 根(src/):它跳的是"上一级模块",跳到头也只是回到 crate 根,跳不出项目
  const floor = hints.rustRoot ? 1 : 0
  const dir = base.slice(0, Math.max(floor, base.length - up))
  const path = rest.split('::')
  // 多段('super::config::Port')最后一段多半是模块里的类型/函数,先试砍段的模块文件;
  // 裸名('mod x;' 抓出来的)本身就是模块文件,不用砍
  const candidates =
    path.length > 1
      ? [...rustFileCandidates(dir, path.slice(0, -1)), ...rustFileCandidates(dir, path)]
      : rustFileCandidates(dir, path)
  return { to: firstKnown(candidates, known), external: true }
}

const RESOLVERS: Record<string, ImportResolver> = {
  typescript: resolveJsImport,
  'typescript-react': resolveJsImport,
  javascript: resolveJsImport,
  'javascript-react': resolveJsImport,
  python: resolvePyImport,
  go: resolveGoImport,
  java: resolveJavaImport,
  rust: resolveRustImport
}

/** JS/TS 的候选后缀:不养自己的名单 —— 凡走 JS 翻译器的语言,户口本后缀全算(.mts/.cts 不漏) */
const JS_EXTS = LANGUAGES.filter((l) => RESOLVERS[l.id] === resolveJsImport).flatMap(
  (l) => l.extensions ?? []
)

/**
 * 开场探测一次项目布局:go.mod 的 module 名、Java 的 Maven 标准布局、Rust 的 cargo src/ 布局。
 * 全靠 known 前缀和读一个 go.mod,不做多余 IO。
 */
async function detectImportHints(rootPath: string, known: Set<string>): Promise<ImportHints> {
  const raw = await fs.readFile(joinRoot(rootPath, 'go.mod'), 'utf8').catch(() => null)
  const goModule = raw ? (/^module\s+(\S+)/m.exec(raw)?.[1] ?? null) : null
  const goDirs = new Map<string, string>()
  if (goModule) {
    for (const file of known) {
      if (!file.endsWith('.go')) continue
      const dir = file.split('/').slice(0, -1).join('/')
      const best = goDirs.get(dir)
      if (best === undefined || file < best) goDirs.set(dir, file)
    }
  }
  const hasMavenLayout = [...known].some(
    (f) => f.endsWith('.java') && f.startsWith('src/main/java/')
  )
  const javaRoots = hasMavenLayout ? ['src/main/java', ''] : ['']
  const rustRoot = [...known].some((f) => f.endsWith('.rs') && f.startsWith('src/')) ? 'src' : null
  return { goModule, goDirs, javaRoots, rustRoot }
}

/**
 * 全项目关系分析:扫描 → 逐文件 AST → 按语言解析导入 → 连边。
 * 只结构化,不解释;解析不出的导入老实记进 unresolved,不硬连。
 */
export async function buildDependencyGraph(rootPath: string): Promise<DepGraphResult> {
  const startedAt = Date.now()
  const scan = await scanDirectory(rootPath)

  const files: ScanFileNode[] = []
  collectFiles(scan.tree, files)
  const analyzable = files.filter(
    (f): f is ScanFileNode & { language: LanguageTag } =>
      f.language !== undefined && isAnalysisSupported(f.language.id)
  )
  const known = new Set(analyzable.map((f) => f.relPath))
  const hints = await detectImportHints(scan.rootPath, known)

  const edgeSet = new Set<string>()
  const edges: DepEdge[] = []
  const unresolved: UnresolvedImport[] = []
  const inCount = new Map<string, number>()
  const outCount = new Map<string, number>()
  let externalCount = 0
  let analyzed = 0
  let skipped = 0

  for (const file of analyzable) {
    const languageId = file.language.id
    // 路径契约:全项目唯一的绝对路径拼接点就是 joinRoot
    const absPath = joinRoot(scan.rootPath, file.relPath)
    const stat = await fs.stat(absPath).catch(() => null)
    if (!stat || !stat.isFile() || stat.size > SOURCE_PARSE_MAX_BYTES) {
      skipped++
      continue
    }
    const code = await fs.readFile(absPath, 'utf8').catch(() => null)
    if (code === null) {
      skipped++
      continue
    }
    const structure = await analyzeSource(code, languageId)
    if (!structure) {
      skipped++
      continue
    }
    analyzed++
    // 没配翻译器的语言(C/C++/C# 这类)导入一律按外部包记,和它们过去的行为一致
    const resolve = RESOLVERS[languageId] ?? null

    for (const spec of structure.imports) {
      const resolution = resolve
        ? resolve({ fromRel: file.relPath, spec, known, hints })
        : { to: null, external: true }
      if (resolution.to) {
        // 查重 key 用 JSON 数组串:分隔符不会和路径内容撞(以前用 \u0000,连累整个文件被判成二进制)
        const key = JSON.stringify([file.relPath, resolution.to])
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          edges.push({ from: file.relPath, to: resolution.to })
          outCount.set(file.relPath, (outCount.get(file.relPath) ?? 0) + 1)
          inCount.set(resolution.to, (inCount.get(resolution.to) ?? 0) + 1)
        }
      } else if (resolution.external) {
        externalCount++
      } else {
        // 项目内的引用却连不上(别名、css、动态路径、还没建的文件……)——老实记账
        unresolved.push({ from: file.relPath, spec })
      }
    }
  }

  const nodes = analyzable.map((f) => ({
    relPath: f.relPath,
    languageId: f.language.id,
    inCount: inCount.get(f.relPath) ?? 0,
    outCount: outCount.get(f.relPath) ?? 0
  }))
  const hubs = [...nodes]
    .filter((n) => n.inCount > 0)
    .sort((a, b) => b.inCount - a.inCount || a.relPath.localeCompare(b.relPath))
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))

  return {
    rootPath: scan.rootPath,
    nodes,
    edges,
    hubs,
    stats: { analyzed, externalCount, skipped, unresolved },
    durationMs: Date.now() - startedAt
  }
}
