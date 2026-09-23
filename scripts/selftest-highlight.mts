// 预览分色自测:npm run test:highlight(首次加载语法 wasm 约需几秒)
// 纯函数(认语言 / 字数闸 / 行切分)秒跑;真解析的用例真跑 wasm,
// 重点验三样:角色判得对、中文注释后面的列号不漂移(偏移是按字不是按字节)、
// 跨行的注释每行都有段。高亮是化妆:解析炸了要回 null 白字,绝不能把预览拖死。
import assert from 'node:assert/strict'
import { HL_KINDS, HL_MAX_CHARS, hlEligible, hlLanguageFor } from '../src/shared/highlight.ts'
import { highlightSource, tokensToLineSegments } from '../src/highlight/index.ts'

/** 从分色账里反查:第 line 行第 col 列(0 起)是个什么角色;不在任何段里 = null(正文色) */
function kindAt(colors: number[][][], line: number, col: number): string | null {
  for (const seg of colors[line - 1] ?? []) {
    if (col >= seg[0] && col < seg[1]) return HL_KINDS[seg[2]] ?? null
  }
  return null
}

async function main(): Promise<void> {
  // ── 1. 后缀认语言:认识的老老实实报,不认识的(比如 md)老实说 null ──
  assert.equal(hlLanguageFor('a.ts'), 'tsx')
  assert.equal(hlLanguageFor('a.tsx'), 'tsx')
  assert.equal(hlLanguageFor('a.mjs'), 'tsx')
  assert.equal(hlLanguageFor('a.py'), 'python')
  assert.equal(hlLanguageFor('A.JS'), 'tsx', '后缀大小写不敏感')
  assert.equal(hlLanguageFor('a.go'), 'go')
  assert.equal(hlLanguageFor('a.c'), 'c')
  assert.equal(hlLanguageFor('a.h'), 'c')
  assert.equal(hlLanguageFor('a.cpp'), 'cpp')
  assert.equal(hlLanguageFor('a.hpp'), 'cpp')
  assert.equal(hlLanguageFor('a.cs'), 'c_sharp')
  assert.equal(hlLanguageFor('a.rs'), 'rust')
  assert.equal(hlLanguageFor('a.json'), 'json')
  assert.equal(hlLanguageFor('a.css'), 'css')
  assert.equal(hlLanguageFor('a.html'), 'html')
  assert.equal(hlLanguageFor('a.sh'), 'bash')
  assert.equal(hlLanguageFor('a.yml'), 'yaml')
  assert.equal(hlLanguageFor('a.toml'), 'toml')
  assert.equal(hlLanguageFor('a.md'), null, 'markdown 没映射表,老实白字')
  assert.equal(hlLanguageFor('a.txt'), null)
  assert.equal(hlLanguageFor('a.unknownxyz'), null)
  assert.equal(hlLanguageFor('Makefile'), null, '没后缀认不出')
  assert.equal(hlLanguageFor('.gitignore'), null, '点开头的隐藏文件不算后缀')

  // ── 2. 字数闸:超了不上色(纯函数对账,主进程里也用它把门) ──
  assert.equal(hlEligible('x'.repeat(100), 'tsx'), true)
  assert.equal(hlEligible('x'.repeat(HL_MAX_CHARS + 1), 'tsx'), false, '超过闸的不上色')
  assert.equal(hlEligible('x'.repeat(100), null), false, '不认识的语言不上色')
  assert.ok(HL_MAX_CHARS >= 100_000 && HL_MAX_CHARS <= 10_000_000, '闸是个讲道理的数')

  // ── 3. 行切分(纯函数):同色合并、空行空账、跨行切段、换行符不算列 ──
  const segs = tokensToLineSegments('aa\n\nbb cc', [
    { start: 0, end: 2, kind: 'kw' },
    { start: 4, end: 6, kind: 'kw' },
    { start: 7, end: 9, kind: 'num' }
  ])
  assert.equal(segs.length, 3, '行数跟文本对齐')
  assert.deepEqual(segs[0], [[0, 2, HL_KINDS.indexOf('kw')]], '第一行整段')
  assert.deepEqual(segs[1], [], '空行就是空账')
  assert.deepEqual(
    segs[2],
    [
      [0, 2, HL_KINDS.indexOf('kw')],
      [3, 5, HL_KINDS.indexOf('num')]
    ],
    '同行两段各记各的,段间的空格留给正文色'
  )
  const cross = tokensToLineSegments('aa\n\nbb cc', [{ start: 3, end: 9, kind: 'com' }])
  assert.deepEqual(cross[1], [], '跨行片段压在空行上:空行还是空账(换行符不算列)')
  assert.deepEqual(cross[2], [[0, 5, HL_KINDS.indexOf('com')]], '跨行片段在新行从行首记起')
  const merged = tokensToLineSegments('a b c', [
    { start: 0, end: 1, kind: 'str' },
    { start: 1, end: 2, kind: 'str' },
    { start: 2, end: 3, kind: 'str' }
  ])
  assert.deepEqual(merged[0], [[0, 3, HL_KINDS.indexOf('str')]], '行内挨着的同角色合并成一段')
  assert.deepEqual(tokensToLineSegments('', [])[0], [], '空文本也有(空)第一行的账')

  // ── 4. 真解析(TS):关键字/字符串/数字/注释/函数名/类型名/控制流/模板插值,逐点对号 ──
  const tsCode = [
    "const greeting = '你好,世界' // 打个招呼",
    'function hello(name: string): string {',
    '  return `Hi, ${name}!`',
    '}',
    'export class Greeter {}',
    'if (ready) { return 1 }'
  ].join('\n')
  const tsColors = await highlightSource(tsCode, 'sample.ts')
  assert.ok(tsColors, 'TS 要出分色账')
  // 第一行:中文注释后面的列号不许漂移(这是按字偏移、不是按字节偏移的照妖镜)
  assert.equal(kindAt(tsColors!, 1, 1), 'kw', 'const 是关键字')
  assert.equal(kindAt(tsColors!, 1, 8), 'var', '变量名是变量色')
  assert.equal(kindAt(tsColors!, 1, 19), 'str', '字符串(中文在字符串里)是字符串色')
  assert.equal(kindAt(tsColors!, 1, 28), 'com', '中文注释是注释色')
  assert.equal(kindAt(tsColors!, 2, 2), 'kw', 'function 是关键字')
  assert.equal(kindAt(tsColors!, 2, 11), 'fn', '函数名是函数色')
  assert.equal(kindAt(tsColors!, 2, 16), 'var', '参数名是变量色')
  assert.equal(kindAt(tsColors!, 2, 23), 'type', 'string 内置类型是类型色')
  assert.equal(kindAt(tsColors!, 2, 31), 'type', '返回类型也是类型色')
  assert.equal(kindAt(tsColors!, 3, 4), 'ctl', 'return 是控制流(紫)')
  assert.equal(kindAt(tsColors!, 3, 12), 'str', '模板串的字面部分是字符串色')
  assert.equal(kindAt(tsColors!, 3, 19), 'var', '模板插值里的名字还是变量色(要下钻)')
  assert.equal(kindAt(tsColors!, 5, 15), 'type', '类名是类型色')
  assert.equal(kindAt(tsColors!, 6, 1), 'ctl', 'if 是控制流(紫)')
  assert.equal(kindAt(tsColors!, 6, 14), 'ctl', 'return 在块里也是控制流')
  assert.equal(kindAt(tsColors!, 6, 20), 'num', '数字是数字色')
  assert.equal(tsColors!.length, 6, '账的行数跟文本一致')

  // ── 5. 真解析(其他语言):python / json / css / html / bash 各点一穴 ──
  const pyColors = await highlightSource(
    ['def greet(name):', '    # 问好', '    return name'].join('\n'),
    'tool.py'
  )
  assert.ok(pyColors, 'Python 要出分色账')
  assert.equal(kindAt(pyColors!, 1, 1), 'kw', 'def 是关键字')
  assert.equal(kindAt(pyColors!, 1, 6), 'fn', '函数名是函数色')
  assert.equal(kindAt(pyColors!, 2, 6), 'com', '中文注释是注释色')
  assert.equal(kindAt(pyColors!, 3, 5), 'ctl', 'return 是控制流')

  const jsonColors = await highlightSource('{"name": "小葵", "n": 1, "ok": true}', 'data.json')
  assert.ok(jsonColors, 'JSON 要出分色账')
  assert.equal(kindAt(jsonColors!, 1, 3), 'var', 'JSON 的键是变量色(浅蓝),不是字符串色')
  assert.equal(kindAt(jsonColors!, 1, 10), 'str', 'JSON 的值是字符串色(中文列号再照一次妖)')
  assert.equal(kindAt(jsonColors!, 1, 20), 'num', 'JSON 的数字是数字色')
  assert.equal(kindAt(jsonColors!, 1, 30), 'kw', 'true/false/null 是关键字色')

  const cssColors = await highlightSource('.card { color: red; }', 'style.css')
  assert.ok(cssColors, 'CSS 要出分色账')
  assert.equal(kindAt(cssColors!, 1, 2), 'symbol', 'CSS 选择器是金色')
  assert.equal(kindAt(cssColors!, 1, 10), 'var', 'CSS 属性名是变量色')
  assert.equal(kindAt(cssColors!, 1, 16), 'str', 'CSS 值按字符串色走')

  const htmlColors = await highlightSource('<div class="box">hi</div>', 'page.html')
  assert.ok(htmlColors, 'HTML 要出分色账')
  assert.equal(kindAt(htmlColors!, 1, 2), 'kw', 'HTML 标签是关键字蓝')
  assert.equal(kindAt(htmlColors!, 1, 7), 'var', 'HTML 属性名是变量色')
  assert.equal(kindAt(htmlColors!, 1, 13), 'str', 'HTML 属性值是字符串色')

  const shColors = await highlightSource('# 备份\nls -la', 'run.sh')
  assert.ok(shColors, 'bash 要出分色账')
  assert.equal(kindAt(shColors!, 1, 3), 'com', 'bash 注释是注释色')
  assert.equal(kindAt(shColors!, 2, 1), 'var', '命令名有变量色(分得不完美也比白字强)')

  // ── 6. 跨行块注释:每行都有段;空行的账是空的 ──
  const blockColors = await highlightSource(
    ['/* 第一行', '   第二行 */', 'const ok = 1', '', 'const end = 2'].join('\n'),
    'b.ts'
  )
  assert.ok(blockColors)
  assert.equal(kindAt(blockColors!, 1, 3), 'com', '块注释第一行是注释色')
  assert.equal(kindAt(blockColors!, 2, 5), 'com', '块注释第二行接着是注释色(跨行切段)')
  assert.equal(kindAt(blockColors!, 3, 1), 'kw', '注释结束后恢复正常分色')
  assert.deepEqual(blockColors![3], [], '空行空账')
  assert.equal(blockColors!.length, 5, '行数一致')

  // ── 7. 化妆不越权:不认识的语言、超闸、空文本都回 null(白字照常,绝不报错) ──
  assert.equal(await highlightSource('# 标题\n正文', 'readme.md'), null, 'markdown 不上色')
  assert.equal(await highlightSource('x'.repeat(HL_MAX_CHARS + 1), 'big.ts'), null, '超闸不上色')
  assert.equal(await highlightSource('', 'a.ts'), null, '空文本不上色(没必要)')
  const broken = await highlightSource('function ((( {', 'bad.ts')
  assert.ok(Array.isArray(broken), '语法坏了也照样出账(tree-sitter 容错解析),至少不炸')

  console.log(
    '✅ 预览分色自测:认语言 / 字数闸 / 行切分(跨行/合并/空行)/ TS・Python・JSON・CSS・HTML・bash 真解析 / 中文列号不漂移 / 化妆不越权 全部通过'
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
