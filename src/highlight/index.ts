// 预览分色的解析手(主进程):tree-sitter 把代码过一遍,吐出「哪几个字是什么角色」,
// 渲染层按角色上色(main.css 的 tok-*,色号抄 VS Code 官方 Dark+/Light+)。
// 引擎和语法 wasm 跟体检模块(analyzer)同款家底,一个新依赖不加;三条老规矩照抄:
// 引擎初始化一次、每种语言的语法缓存、解析树用完必须 delete(wasm 内存不漏)。
// 高亮是预览的化妆,永远不许拖累预览:超闸、不认识的语言、解析或遍历出错,
// 一律老实返回 null,界面白字照常 —— 分错色事小,预览打不开事大。
import { join } from 'node:path'
import Parser from 'web-tree-sitter'
import { HL_KINDS, hlLanguageFor, HL_MAX_CHARS, type HlKind } from '../shared/highlight.ts'
import { GRAMMAR_WASM } from '../shared/grammarWasm.ts'
import { currentWasmOpts, engineWasmPath, grammarWasmDir } from '../native/wasmPaths.ts'

type TSTree = NonNullable<ReturnType<Parser['parse']>>
type TSNode = TSTree['rootNode']
type TSLanguage = InstanceType<typeof Parser.Language>

/** 一个带色的片段(全文偏移,左闭右开) */
export interface HlToken {
  start: number
  end: number
  kind: HlKind
}

// wasm 寻路收口到 native/wasmPaths.ts(和 analyzer 同款):开发/自测走 node_modules,
// 打包后 electron-builder 把字典放 resources/wasm/,运行时认文件自动切。
const WASM_OPTS = currentWasmOpts

let enginePromise: Promise<void> | null = null
function ensureEngine(): Promise<void> {
  enginePromise ??= Parser.init({ locateFile: () => engineWasmPath(WASM_OPTS()) })
  return enginePromise
}

/** 本模块支持的语法 = 语法账全表(语法 id 直接当本模块的语言 id 用;export 给打包清单自测对账用) */
export const GRAMMAR_FILES = GRAMMAR_WASM

const languageCache = new Map<string, TSLanguage>()
let sharedParser: Parser | null = null

async function prepare(languageId: string): Promise<Parser> {
  await ensureEngine()
  if (!sharedParser) sharedParser = new Parser()

  let lang = languageCache.get(languageId)
  if (!lang) {
    lang = await Parser.Language.load(join(grammarWasmDir(WASM_OPTS()), GRAMMAR_FILES[languageId]!))
    languageCache.set(languageId, lang)
  }
  sharedParser.setLanguage(lang)
  return sharedParser
}

// ── 控制流关键字(紫):VS Code 把「管流程的词」单独上一档色,照办 ──
const CONTROL_WORDS = new Set([
  'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'default',
  'return', 'break', 'continue', 'throw', 'try', 'catch', 'finally',
  'yield', 'await', 'async', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of',
  'goto', 'range', 'select', 'fallthrough', 'match', 'loop', 'until',
  'then', 'fi', 'done', 'esac', 'except', 'raise', 'with', 'defer', 'go'
])

/** 光杆常量词:JSON/Python 这些语法里 true/None 是「具名」节点,不像 JS 是匿名 token,
    通用匿名分支接不住,单独给它们开张词表 */
const BARE_KEYWORDS = new Set(['true', 'false', 'null', 'None', 'True', 'False', 'nil', 'undefined', 'NaN'])

/** 整段当注释的节点(各家语法对注释的叫法不一样,收齐) */
const COMMENT_NODES = new Set(['comment', 'line_comment', 'block_comment', 'html_comment'])

/** 整段当字符串的节点(进来就不下钻了:字符串里的字都一个色) */
const STRING_NODES = new Set([
  'string', 'string_literal', 'interpreted_string_literal', 'raw_string_literal',
  'system_lib_string', 'string_fragment', 'f_string_content', 'character_literal',
  'byte_string', 'verbatim_string_literal', 'string_value',
  'quoted_attribute_value', 'attribute_value'
])

/** 整段当数字的节点(各家叫法收齐;css 的色值 #336699 也按数字算) */
const NUMBER_NODES = new Set([
  'number', 'number_literal', 'integer', 'integer_literal', 'decimal_integer_literal',
  'hex_integer_literal', 'octal_integer_literal', 'binary_integer_literal',
  'decimal_floating_point_literal', 'hex_floating_point_literal', 'float', 'float_literal',
  'decimal_float', 'decimal_number', 'octal_number', 'binary_number',
  'int_literal', 'imaginary_literal', 'integer_value', 'float_value', 'percentage_value', 'color_value'
])

/** 整段当正则的节点(TS 的 /…/ 和 bash 的 [[ =~ ]] 都对上) */
const REGEX_NODES = new Set(['regex'])

/** 一看名字就是类型的节点(类型名、内置类型 int/number 这些,青色) */
const TYPE_NODES = new Set(['type_identifier', 'predefined_type', 'primitive_type'])

/** 普通名字类节点:变量、属性、字段 —— 大概率浅蓝,例外靠父节点修正 */
const IDENT_NODES = new Set([
  'identifier', 'property_identifier', 'shorthand_property_identifier', 'field_identifier'
])

/**
 * 每种语言专属的节点直映射(通用表对不上时才查这)。
 * 只挑「通用规则真分不对」的:JSX 的标签在 VS Code 里跟类型一个青色,
 * HTML 的标签是关键字蓝;CSS 的选择器是金色 —— 各有各的脾气。
 */
const LANG_NODES: Record<string, Record<string, HlKind>> = {
  tsx: { tag_name: 'type', attribute_name: 'var', jsx_attribute_name: 'var' },
  html: { tag_name: 'kw', attribute_name: 'var', doctype: 'kw' },
  css: {
    tag_name: 'symbol', class_name: 'symbol', id_name: 'symbol',
    property_name: 'var', plain_value: 'str', at_keyword: 'kw'
  },
  bash: { variable_name: 'var', command_name: 'var' },
  yaml: { string_scalar: 'str', block_scalar: 'str' },
  toml: { bare_key: 'var', quoted_key: 'var', boolean: 'kw' },
  go: { label_name: 'var' },
  rust: { lifetime: 'kw' }
}

/**
 * 普通名字该上什么色:光看名字分不出来,得看它在爹妈跟前是什么身份 ——
 * 函数/方法定义的名字是黄,类型定义的名字是青,调用处是黄,
 * new 出来的名字是青,装饰器是黄;剩下的统统按变量算(浅蓝)。
 * 修不了的(比如 a.b() 里的 b 该黄但爹是成员访问)就老实浅蓝,八九成像。
 */
function identKind(parentType: string | null, field: string | null): HlKind {
  if (parentType !== null) {
    if (field === 'name') {
      if (parentType.includes('function') || parentType.includes('method') || parentType.includes('constructor')) return 'fn'
      if (
        parentType.includes('class') || parentType.includes('interface') || parentType.includes('struct') ||
        parentType.includes('enum') || parentType.includes('trait') || parentType === 'type_alias_declaration'
      ) return 'type'
    }
    if (field === 'function' || field === 'callee') {
      return parentType === 'new_expression' || parentType === 'object_creation_expression' ? 'type' : 'fn'
    }
    if (parentType === 'decorator' || parentType.includes('invocation')) return 'fn'
  }
  return 'var'
}

/**
 * 一个节点该上什么色。三种下场:
 * 返回角色 → 整段上色,不再往里钻;返回 undefined → 不上色,继续往里钻。
 * 顺序有讲究:json 的键(字符串当键使)要在通用字符串表之前特判,不然永远判成字符串。
 */
function classify(lang: string, node: TSNode, parentType: string | null, field: string | null): HlKind | undefined {
  const t = node.type
  // 匿名叶子:就是语法里的字面 token。是符号(括号分号箭头)不上色;
  // 是纯字母的词,流程词给紫,其余给关键字蓝(true/false/null/this 也在这儿对号)
  if (!node.isNamed()) {
    if (!/^[A-Za-z_]/.test(t)) return undefined
    return CONTROL_WORDS.has(t) ? 'ctl' : 'kw'
  }
  if (lang === 'json' && t === 'string' && field === 'key') return 'var'
  if (lang === 'yaml' && t === 'plain_scalar' && field === 'key') return 'var'
  if (COMMENT_NODES.has(t)) return 'com'
  if (STRING_NODES.has(t)) return 'str'
  if (NUMBER_NODES.has(t)) return 'num'
  if (REGEX_NODES.has(t)) return 'regex'
  if (TYPE_NODES.has(t)) return 'type'
  if (IDENT_NODES.has(t)) return identKind(parentType, field)
  const perLang = LANG_NODES[lang]?.[t]
  if (perLang) return perLang
  // 光杆词节点(JSON/Python 的 true/None 这类是具名叶子,通用匿名分支接不住):
  // 没孩子的整词按词表对号,控制流词也给紫
  if (node.childCount === 0) {
    const word = node.text
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) {
      if (CONTROL_WORDS.has(word)) return 'ctl'
      if (BARE_KEYWORDS.has(word)) return 'kw'
    }
  }
  // 模板串/插值这类「壳」:不上色继续往里钻,钻到的片段按字符串算
  if (t === 'string_fragment' || t === 'f_string_content') return 'str'
  return undefined
}

/** 把整棵树走一遍,收齐带色的片段(TreeCursor 先序遍历,片段天然按位置排好)。
    0.20 的 web-tree-sitter 里 TreeCursor 的 currentNode/currentFieldName 都是方法 ——
    带不带括号取到的不是一回事,这儿按方法调。 */
function walk(lang: string, tree: TSTree, out: HlToken[]): void {
  const cursor = tree.walk()
  try {
    while (true) {
      const node = cursor.currentNode()
      const kind = classify(lang, node, node.parent?.type ?? null, cursor.currentFieldName() ?? null)
      if (kind === undefined) {
        // 这段没角色:钻进去看它的孩子
        if (cursor.gotoFirstChild()) continue
      } else if (node.startIndex < node.endIndex) {
        out.push({ start: node.startIndex, end: node.endIndex, kind })
      }
      // 到这儿要么上了色(不钻)、要么是没孩子的没角色:走兄弟,走不了就往上爬
      let advanced = false
      while (true) {
        if (cursor.gotoNextSibling()) {
          advanced = true
          break
        }
        if (!cursor.gotoParent()) break
      }
      if (!advanced) break
    }
  } finally {
    cursor.delete()
  }
}

/** 角色编号对账表:IPC 传的是数字,省得每片段都 indexOf */
const KIND_INDEX: Record<HlKind, number> = Object.fromEntries(HL_KINDS.map((k, i) => [k, i])) as Record<HlKind, number>

/**
 * 把「全文偏移的片段」切成「按行的段落账」(纯函数,自测覆盖):
 * 外层是行,中层是行内的段,每段 [起始列, 结束列, 角色编号](列从 0 起,不含换行符)。
 * 跨行的片段(块注释、多行字符串)在每行各记一段;行内挨着的同角色合并成一段。
 */
export function tokensToLineSegments(text: string, tokens: HlToken[]): number[][][] {
  const lineStarts: number[] = []
  let ls = 0
  for (const line of text.split('\n')) {
    lineStarts.push(ls)
    ls += line.length + 1
  }
  const lineCount = lineStarts.length
  // 行内容的结束列:下一行的起点前一位是换行符,不算进本行;最后一行到全文末尾
  const lineEnd = (r: number): number => (r + 1 < lineCount ? lineStarts[r + 1] - 1 : text.length)
  const out: number[][][] = Array.from({ length: lineCount }, () => [] as number[][])
  let row = 0
  for (const tok of tokens) {
    if (tok.end <= tok.start) continue
    while (row + 1 < lineCount && tok.start >= lineStarts[row + 1]) row++
    while (row > 0 && tok.start < lineStarts[row]) row--
    const kindIdx = KIND_INDEX[tok.kind]
    for (let r = row; r < lineCount && lineStarts[r] < tok.end; r++) {
      const colStart = Math.max(tok.start, lineStarts[r]) - lineStarts[r]
      const colEnd = Math.min(tok.end, lineEnd(r)) - lineStarts[r]
      if (colEnd <= colStart) continue
      const segs = out[r]
      const last = segs[segs.length - 1]
      if (last && last[2] === kindIdx && last[1] === colStart) {
        last[1] = colEnd
      } else {
        segs.push([colStart, colEnd, kindIdx])
      }
    }
  }
  return out
}

/**
 * 把一段代码解析成按行的分色账。fileName 用来看后缀认语言;
 * 返回 null = 这份不上色(超闸 / 语言不认识 / 出错),调用方照常白字,绝不是报错。
 */
export async function highlightSource(code: string, fileName: string): Promise<number[][][] | null> {
  const language = hlLanguageFor(fileName)
  if (language === null || code.length > HL_MAX_CHARS) return null
  if (!GRAMMAR_FILES[language]) return null
  if (code === '') return null // 空文件没得涂,连树都省了
  try {
    const parser = await prepare(language)
    const tree = parser.parse(code)
    if (!tree) return null
    // 解析树占的是 WASM 内存,用完必须 delete:try/finally 保证异常路径也不漏
    try {
      const tokens: HlToken[] = []
      walk(language, tree, tokens)
      return tokensToLineSegments(code, tokens)
    } finally {
      tree.delete()
    }
  } catch {
    return null
  }
}
