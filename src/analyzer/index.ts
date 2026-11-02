import { join } from 'node:path'
import Parser from 'web-tree-sitter'
import type { FileStructure, SymbolRange } from '../shared/types.ts'
import { GRAMMAR_WASM, LANG_TO_GRAMMAR } from '../shared/grammarWasm.ts'
import { currentWasmOpts, engineWasmPath, grammarWasmDir } from '../native/wasmPaths.ts'

type TSLanguage = InstanceType<typeof Parser.Language>
type TSQuery = ReturnType<TSLanguage['query']>

// wasm 寻路收口到 native/wasmPaths.ts:开发/自测走 node_modules,打包后走 resources/wasm/。
const WASM_OPTS = currentWasmOpts

function grammarWasmPath(file: string): string {
  return join(grammarWasmDir(WASM_OPTS()), file)
}

let enginePromise: Promise<void> | null = null
function ensureEngine(): Promise<void> {
  enginePromise ??= Parser.init({ locateFile: () => engineWasmPath(WASM_OPTS()) })
  return enginePromise
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
    queryCache.set(languageId, lang.query(QUERIES[languageId]!))
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

/** Python 的提取规则:函数、类、导入(相对导入 module_name 是 relative_import 节点,单独一条抓) */
const PY_QUERY = `
  (function_definition name: (identifier) @fn)
  (class_definition name: (identifier) @cls)
  (import_statement name: (dotted_name) @imp)
  (import_from_statement module_name: (dotted_name) @imp)
  (import_from_statement module_name: (relative_import) @imp)
`

/** Java:方法/构造器、类/枚举、接口、导入 */
const JAVA_QUERY = `
  (method_declaration name: (identifier) @fn)
  (constructor_declaration name: (identifier) @fn)
  (class_declaration name: (identifier) @cls)
  (enum_declaration name: (identifier) @cls)
  (interface_declaration name: (identifier) @iface)
  (import_declaration (scoped_identifier) @imp)
  (import_declaration (identifier) @imp)
`

/** Go:函数/方法、struct 与 interface、导入(路径是字符串字面量) */
const GO_QUERY = `
  (function_declaration name: (identifier) @fn)
  (method_declaration name: (field_identifier) @fn)
  (type_spec name: (type_identifier) @cls type: (struct_type))
  (type_spec name: (type_identifier) @iface type: (interface_type))
  (import_spec path: (interpreted_string_literal) @imp)
  (import_spec path: (raw_string_literal) @imp)
`

/** C:函数定义(含指针返回)、struct、#include(系统头 <> 是 system_lib_string 节点) */
const C_QUERY = `
  (function_definition declarator: (function_declarator declarator: (identifier) @fn))
  (function_definition declarator: (pointer_declarator (function_declarator declarator: (identifier) @fn)))
  (struct_specifier name: (type_identifier) @cls)
  (preproc_include path: (string_literal) @imp)
  (preproc_include path: (system_lib_string) @imp)
`

/** C++:类内/类外方法(含 Foo::bar 限定名)、class 与 struct、#include */
const CPP_QUERY = `
  (function_definition declarator: (function_declarator declarator: (identifier) @fn))
  (function_definition declarator: (function_declarator declarator: (field_identifier) @fn))
  (function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @fn)))
  (function_definition declarator: (pointer_declarator (function_declarator declarator: [(identifier) (field_identifier)] @fn)))
  (class_specifier name: (type_identifier) @cls)
  (struct_specifier name: (type_identifier) @cls)
  (preproc_include path: (string_literal) @imp)
  (preproc_include path: (system_lib_string) @imp)
`

/** C#:方法/构造器、类、接口、using 导入 */
const CS_QUERY = `
  (method_declaration name: (identifier) @fn)
  (constructor_declaration name: (identifier) @fn)
  (class_declaration name: (identifier) @cls)
  (interface_declaration name: (identifier) @iface)
  (using_directive (qualified_name) @imp)
  (using_directive (identifier) @imp)
`

/** Rust:函数(trait 里的签名也算)、struct/enum、trait、use 导入、mod 声明(mod x; 是 Rust 引隔壁文件的方式) */
const RUST_QUERY = `
  (function_item name: (identifier) @fn)
  (function_signature_item name: (identifier) @fn)
  (struct_item name: (type_identifier) @cls)
  (enum_item name: (type_identifier) @cls)
  (trait_item name: (type_identifier) @iface)
  (use_declaration (scoped_identifier) @imp)
  (use_declaration (identifier) @imp)
  (mod_item name: (identifier) @imp)
`

/** 每种语言自己的提取规则 */
const QUERIES: Record<string, string> = {
  typescript: JS_QUERY,
  'typescript-react': JS_QUERY,
  javascript: JS_QUERY,
  'javascript-react': JS_QUERY,
  python: PY_QUERY,
  java: JAVA_QUERY,
  go: GO_QUERY,
  c: C_QUERY,
  cpp: CPP_QUERY,
  csharp: CS_QUERY,
  rust: RUST_QUERY
}

/**
 * 本模块支持的 AST 分析语言 → 语法 wasm 文件(export 给打包清单自测对账用)。
 * 不养自己的名单:有提取规则的语言,经 LANG_TO_GRAMMAR 过桥去语法账 GRAMMAR_WASM 取件
 * (QUERIES 里哪门语言在 LANG_TO_GRAMMAR 没登记,取件当场是 undefined,自测立刻报警)。
 */
export const GRAMMAR_FILES: Record<string, string> = Object.fromEntries(
  Object.keys(QUERIES).map((id) => [id, GRAMMAR_WASM[LANG_TO_GRAMMAR[id]!]!])
)

export function isAnalysisSupported(languageId: string): boolean {
  return GRAMMAR_FILES[languageId] !== undefined
}

/**
 * 各语言中「一个符号的完整声明」对应的语法节点类型(全部提取规则共用一张表:
 * 同名类型在不同语法里都是声明节点,不会误认)。名字节点向上找到的第一层声明节点即该符号的范围。
 */
const DECLARATION_TYPES = new Set([
  'function_declaration',
  'function_definition',
  'function_item',
  'function_signature_item',
  'method_definition',
  'method_declaration',
  'constructor_declaration',
  'variable_declarator',
  'class_declaration',
  'class_definition',
  'class_specifier',
  'struct_specifier',
  'struct_item',
  'enum_declaration',
  'enum_item',
  'interface_declaration',
  'type_alias_declaration',
  'type_spec',
  'trait_item'
])

/** 声明外面的包裹层:范围要把它们算进去,切段时才不会把导出与装饰器切丢 */
const WRAPPER_TYPES = new Set([
  'export_statement',
  'lexical_declaration',
  'variable_declaration',
  'decorated_definition'
])

type TSNode = NonNullable<ReturnType<Parser['parse']>>['rootNode']

/** 从符号的名字节点向上找声明整体,返回 1 起的起止行;找不到声明节点时退回名字节点自身的行 */
function declarationRangeOf(nameNode: TSNode): { startLine: number; endLine: number } | null {
  let declaration: TSNode | null = null
  let cursor: TSNode | null = nameNode.parent
  while (cursor) {
    if (DECLARATION_TYPES.has(cursor.type)) {
      declaration = cursor
      break
    }
    cursor = cursor.parent
  }
  // C/C++ 的 struct/class 说明符在「struct Point p」这类引用处也会被抓到:没有类体就不是声明,不给行号
  if (
    declaration &&
    (declaration.type === 'struct_specifier' || declaration.type === 'class_specifier') &&
    !declaration.namedChildren.some(
      (child) => child.type === 'field_declaration_list' || child.type === 'declaration_list'
    )
  ) {
    return null
  }
  let outer: TSNode = declaration ?? nameNode
  while (outer.parent && WRAPPER_TYPES.has(outer.parent.type)) {
    outer = outer.parent
  }
  return { startLine: outer.startPosition.row + 1, endLine: outer.endPosition.row + 1 }
}

/** 把一个符号的名字与行号范围记进结果;范围取不到(引用而非声明)时只记名字,不记范围 */
function pushSymbolRange(
  result: FileStructure,
  nameNode: TSNode,
  name: string,
  kind: SymbolRange['kind']
): void {
  const range = declarationRangeOf(nameNode)
  if (range) result.symbolRanges.push({ name, kind, ...range })
}

/** 剥掉字符串/系统头的包装:C 的 #include <x> 和各种引号,只留里面的名字 */
function stripQuotes(text: string): string {
  const trimmed = text.trim()
  return trimmed.replace(/^['"`<]/, '').replace(/['"`>]$/, '')
}

function dedupeSorted(items: Iterable<string>): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b))
}

/**
 * 解析源码,提取结构。只结构化,不解释——解释是 AI 模块的事。
 * 返回 null = 该语言暂不支持 AST 分析(不是出错,是诚实的能力边界)。
 */
export async function analyzeSource(
  code: string,
  languageId: string
): Promise<FileStructure | null> {
  if (!isAnalysisSupported(languageId)) return null

  const parser = await prepare(languageId)
  const query = queryCache.get(languageId)!
  const tree = parser.parse(code)
  if (!tree) return null

  // 解析树占的是 WASM 内存,用完必须 delete:try/finally 保证异常路径也不漏
  try {
    const result: FileStructure = {
      languageId,
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      interfaces: [],
      reactComponents: [],
      symbolRanges: []
    }

    for (const match of query.matches(tree.rootNode)) {
      for (const capture of match.captures) {
        const text = capture.node.text
        switch (capture.name) {
          case 'fn':
            result.functions.push(text)
            pushSymbolRange(result, capture.node, text, 'function')
            break
          case 'cls':
            result.classes.push(text)
            pushSymbolRange(result, capture.node, text, 'class')
            break
          case 'iface':
            result.interfaces.push(text)
            pushSymbolRange(result, capture.node, text, 'interface')
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
    if (
      languageId.endsWith('-react') &&
      tree.rootNode.descendantsOfType('jsx_element').length > 0
    ) {
      result.reactComponents = [...result.functions, ...result.classes].filter((name) =>
        /^[A-Z]/.test(name)
      )
    }

    result.imports = dedupeSorted(result.imports)
    result.exports = dedupeSorted(result.exports)
    result.functions = dedupeSorted(result.functions)
    result.classes = dedupeSorted(result.classes)
    result.interfaces = dedupeSorted(result.interfaces)
    result.reactComponents = dedupeSorted(result.reactComponents)
    // 行号范围不按名去重(同名方法各占一条),只去掉同一声明被多条规则重复抓出的完全相同条目;按起始行排序
    const seenRanges = new Set<string>()
    result.symbolRanges = result.symbolRanges
      .filter((range) => {
        const key = `${range.kind}:${range.name}:${range.startLine}:${range.endLine}`
        if (seenRanges.has(key)) return false
        seenRanges.add(key)
        return true
      })
      .sort(
        (a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.name.localeCompare(b.name)
      )
    return result
  } finally {
    tree.delete()
  }
}
