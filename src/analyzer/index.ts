import { join } from 'node:path'
import Parser from 'web-tree-sitter'
import type { FileStructure } from '../shared/types.ts'

type TSLanguage = InstanceType<typeof Parser.Language>
type TSQuery = ReturnType<TSLanguage['query']>

// 开发与自测都从项目根运行,直接按 node_modules 定位 wasm。
// 打包发布时这些 wasm 要作为资源文件带上,到打包阶段再调整解析方式。
const NODE_MODULES = join(process.cwd(), 'node_modules')

function engineWasmPath(): string {
  return join(NODE_MODULES, 'web-tree-sitter', 'tree-sitter.wasm')
}

function grammarWasmPath(file: string): string {
  return join(NODE_MODULES, 'tree-sitter-wasms', 'out', file)
}

let enginePromise: Promise<void> | null = null
function ensureEngine(): Promise<void> {
  enginePromise ??= Parser.init({ locateFile: () => engineWasmPath() })
  return enginePromise
}

/** 本模块支持的 AST 分析语言 → 语法 wasm 文件 */
const GRAMMAR_FILES: Record<string, string> = {
  typescript: 'tree-sitter-tsx.wasm',
  'typescript-react': 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-tsx.wasm',
  'javascript-react': 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm'
}

export function isAnalysisSupported(languageId: string): boolean {
  return languageId in GRAMMAR_FILES
}

const languageCache = new Map<string, TSLanguage>()
const queryCache = new Map<string, TSQuery>()
let sharedParser: Parser | null = null

async function prepare(languageId: string): Promise<Parser> {
  await ensureEngine()
  if (!sharedParser) sharedParser = new Parser()

  let lang = languageCache.get(languageId)
  if (!lang) {
    lang = await Parser.Language.load(grammarWasmPath(GRAMMAR_FILES[languageId]!))
    languageCache.set(languageId, lang)
  }

  if (!queryCache.has(languageId)) {
    queryCache.set(languageId, lang.query(languageId === 'python' ? PY_QUERY : JS_QUERY))
  }
  sharedParser.setLanguage(lang)
  return sharedParser
}

/**
 * JS/TS 族的提取规则(基于 TSX 语法,它是 TS + JSX 的超集,四种 JS 族语言共用)。
 * 注意 TS 语法的类名/接口名节点是 type_identifier;const/let 导出经 lexical_declaration 中转。
 * 已用探针逐条验证过编译与捕获,改规则前先跑 scripts/query-probe 的思路自测。
 */
const JS_QUERY = `
  (function_declaration name: (identifier) @fn)
  (method_definition name: (property_identifier) @fn)
  (variable_declarator name: (identifier) @fn value: [(arrow_function) (function_expression)])
  (class_declaration name: (type_identifier) @cls)
  (interface_declaration name: (type_identifier) @iface)
  (type_alias_declaration name: (type_identifier) @iface)
  (import_statement source: (string) @imp)
  (call_expression function: (identifier) @reqfn arguments: (arguments (string) @reqmod))
  (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @exp)))
  (export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @exp)))
  (export_statement declaration: (function_declaration name: (identifier) @exp))
  (export_statement declaration: (class_declaration name: (type_identifier) @exp))
  (export_statement (export_clause (export_specifier name: (identifier) @expspec)))
  (export_statement "default" (identifier) @expdef)
  (export_statement "default" [(function_declaration) (class_declaration) (arrow_function)] @expdefanon)
`

/** Python 的提取规则:函数、类、导入 */
const PY_QUERY = `
  (function_definition name: (identifier) @fn)
  (class_definition name: (identifier) @cls)
  (import_statement name: (dotted_name) @imp)
  (import_from_statement module_name: (dotted_name) @imp)
`

function stripQuotes(text: string): string {
  const trimmed = text.trim()
  return trimmed.replace(/^['"`]/, '').replace(/['"`]$/, '')
}

function dedupeSorted(items: Iterable<string>): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b))
}

/**
 * 解析源码,提取结构。只结构化,不解释——解释是 AI 模块的事。
 * 返回 null = 该语言暂不支持 AST 分析(不是出错,是诚实的能力边界)。
 */
export async function analyzeSource(code: string, languageId: string): Promise<FileStructure | null> {
  if (!isAnalysisSupported(languageId)) return null

  const parser = await prepare(languageId)
  const query = queryCache.get(languageId)!
  const tree = parser.parse(code)
  if (!tree) return null

  const result: FileStructure = {
    languageId,
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    interfaces: [],
    reactComponents: []
  }

  for (const match of query.matches(tree.rootNode)) {
    for (const capture of match.captures) {
      const text = capture.node.text
      switch (capture.name) {
        case 'fn':
          result.functions.push(text)
          break
        case 'cls':
          result.classes.push(text)
          break
        case 'iface':
          result.interfaces.push(text)
          break
        case 'imp':
          result.imports.push(stripQuotes(text))
          break
        case 'reqmod':
          // CommonJS 的 require('x'):确认调用的是 require 本尊才算导入
          if (match.captures.some((c) => c.name === 'reqfn' && c.node.text === 'require')) {
            result.imports.push(stripQuotes(text))
          }
          break
        case 'exp':
        case 'expspec':
          result.exports.push(text)
          break
        case 'expdef':
          result.exports.push(text)
          break
        case 'expdefanon':
          result.exports.push('default')
          break
      }
    }
  }

  // React 组件判定:文件确实用了 JSX,且函数/类名大写开头(行业约定)
  if (languageId.endsWith('-react') && tree.rootNode.descendantsOfType('jsx_element').length > 0) {
    result.reactComponents = [...result.functions, ...result.classes].filter((name) => /^[A-Z]/.test(name))
  }

  result.imports = dedupeSorted(result.imports)
  result.exports = dedupeSorted(result.exports)
  result.functions = dedupeSorted(result.functions)
  result.classes = dedupeSorted(result.classes)
  result.interfaces = dedupeSorted(result.interfaces)
  result.reactComponents = dedupeSorted(result.reactComponents)
  return result
}
