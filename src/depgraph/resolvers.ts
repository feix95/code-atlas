// 各语言的导入翻译器:把 analyzer 抓出的导入说明符翻译成项目内文件的 relPath。
// 只做字符串与已知文件表的比对,不读文件;项目布局线索由 index.ts 开场探测后传入。
import { LANGUAGES } from '../shared/languages.ts'
import { normalizeParts } from './relPath.ts'
import { resolveTsAlias, type TsPathAliases } from './tsPaths.ts'

/** 一条导入的翻译结果:to 连到了哪个项目内文件;连不上时 external 说明这线是不是指向外面的包 */
export interface ImportResolution {
  to: string | null
  external: boolean
}

/** 项目布局线索:主循环开场探测一次,所有 resolver 共用,别每条导入都去翻项目根 */
export interface ImportHints {
  /** go.mod 里 module 声明的名字;没有 go.mod 就是 null,Go 导入一律算外部 */
  goModule: string | null
  /** Go 的包目录 → 该目录下字典序第一个 .go 文件(Go 引用的是"包目录",边得落在具体文件上) */
  goDirs: Map<string, string>
  /** Java 源码根(相对项目根):探测到 Maven 标准布局就把 src/main/java 也算一个 */
  javaRoots: string[]
  /** cargo 布局的 crate 根:有 .rs 文件住在 src/ 下就是 'src',否则 null */
  rustRoot: string | null
  /** 项目根 tsconfig 的 paths / baseUrl 别名;没有或解析不了为 null,非相对导入按改前口径分流 */
  tsPaths: TsPathAliases | null
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

/** TS 原生 ESM(NodeNext)里写的运行时后缀 → 源码后缀:'./x.js' 实指 x.ts 或 x.tsx */
const TS_SOURCE_EXTS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts']
}

/** 相对路径基名 → 项目内文件:原样、运行时后缀换源码后缀、补后缀、补 /index 四轮 */
function matchJsFile(joined: string, known: Set<string>): string | null {
  if (known.has(joined)) return joined
  const dot = joined.lastIndexOf('.')
  const sources = dot > joined.lastIndexOf('/') ? TS_SOURCE_EXTS[joined.slice(dot)] : undefined
  for (const ext of sources ?? []) {
    if (known.has(joined.slice(0, dot) + ext)) return joined.slice(0, dot) + ext
  }
  for (const ext of JS_EXTS) {
    if (known.has(joined + ext)) return joined + ext
  }
  for (const ext of JS_EXTS) {
    if (known.has(`${joined}/index${ext}`)) return `${joined}/index${ext}`
  }
  return null
}

/**
 * JS/TS 导入解析成项目内文件的 relPath。
 * 相对导入('./x'、'../y/z')按当前文件目录拼;非相对的先过 tsconfig 别名(@shared/x 这类),
 * 别名不管的(react、node:path、@scope/pkg)再由 isExternalSpec 分流:外部包还是未知别名。
 * 连不上记 unresolved(css、动态路径这类)。
 */
function resolveJsImport({
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
  if (!spec.startsWith('.')) {
    const aliased = resolveTsAlias(spec, hints.tsPaths, (base) => matchJsFile(base, known))
    return aliased ?? { to: null, external: isExternalSpec(spec) }
  }
  const base = fromRel.split('/').slice(0, -1)
  const normalized = normalizeParts([...base, ...spec.split('/')])
  if (!normalized) return { to: null, external: false }
  return { to: matchJsFile(normalized.join('/'), known), external: false }
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

export const RESOLVERS: Record<string, ImportResolver> = {
  typescript: resolveJsImport,
  'typescript-react': resolveJsImport,
  javascript: resolveJsImport,
  'javascript-react': resolveJsImport,
  python: resolvePyImport,
  go: resolveGoImport,
  java: resolveJavaImport,
  rust: resolveRustImport
}

/** JS/TS 的候选后缀:不养自己的名单 —— 凡走 JS 翻译器的语言,登记表后缀全算(.mts/.cts 不漏) */
const JS_EXTS = LANGUAGES.filter((l) => RESOLVERS[l.id] === resolveJsImport).flatMap(
  (l) => l.extensions ?? []
)
