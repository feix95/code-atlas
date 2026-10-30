// 项目关系分析器:扫全项目,算出"谁引用谁"。
// 路径契约:只认节点上的 relPath,读文件一律走 joinRoot,和扫描/AST 模块同一套约定。
import { promises as fs } from 'node:fs'
import { scanDirectory } from '../scanner/index.ts'
import { analyzeSource, isAnalysisSupported } from '../analyzer/index.ts'
import { joinRoot } from '../shared/paths.ts'
import { SOURCE_PARSE_MAX_BYTES } from '../shared/analysisLimits.ts'
import { RESOLVERS, type ImportHints } from './resolvers.ts'
import { loadTsPathAliases } from './tsPaths.ts'
import { collectStyleLinks, isStylePath, resolveStylePath, type FileClassTokens } from './styles.ts'
import { extractClassTokens } from './classUsage.ts'
import { cutModules, type ModuleCutInput, type StyleLink } from '../modules/cutModules.ts'
import type {
  DepEdge,
  DepGraphResult,
  ModuleMap,
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
  const tsPaths = await loadTsPathAliases(rootPath)
  return { goModule, goDirs, javaRoots, rustRoot, tsPaths }
}

/** 模块切分出错不拖垮关系分析:记日志后返回 null,界面按无划分的原始图显示 */
function cutModulesOrNull(input: ModuleCutInput): ModuleMap | null {
  try {
    return cutModules(input)
  } catch (err) {
    console.error('[depgraph] 模块切分失败,降级为无划分:', err)
    return null
  }
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
  const styleFiles = new Set(files.map((f) => f.relPath).filter(isStylePath))
  const styleImports: StyleLink[] = []
  const classTokens: FileClassTokens[] = []

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
    // 只留当类名用的词,不留源码全文:大项目几千个文件的全文常驻内存会把主进程撑大
    classTokens.push({ relPath: file.relPath, tokens: extractClassTokens(code) })
    // 没配翻译器的语言(C/C++/C# 这类)导入一律按外部包记,和它们过去的行为一致
    const resolve = RESOLVERS[languageId] ?? null

    for (const spec of structure.imports) {
      const style = isStylePath(spec)
        ? resolveStylePath(file.relPath, spec, styleFiles, hints.tsPaths)
        : null
      if (style) {
        // 样式不是可分析文件,不进导入边;记成附挂线索交给模块切分
        styleImports.push({ from: file.relPath, to: style, kind: 'import', weight: 1 })
        continue
      }
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
        // 项目内的引用却连不上(别名、不存在的样式、动态路径、还没建的文件……)——老实记账
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
    modules: cutModulesOrNull({
      files: files.map((f) => f.relPath),
      analyzable: nodes.map((n) => n.relPath),
      edges,
      styleLinks: [
        ...styleImports,
        ...(await collectStyleLinks(scan.rootPath, styleFiles, classTokens, hints.tsPaths))
      ]
    }),
    durationMs: Date.now() - startedAt
  }
}
