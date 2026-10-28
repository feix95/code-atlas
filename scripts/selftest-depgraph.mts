import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { buildDependencyGraph } from '../src/depgraph/index.ts'
import { parseTsPathAliases, resolveTsAlias } from '../src/depgraph/tsPaths.ts'
import {
  classUsageLinks,
  extractCssClasses,
  extractCssImports,
  resolveStylePath
} from '../src/depgraph/styles.ts'
import { extractClassTokens } from '../src/depgraph/classUsage.ts'
import type { DepGraphResult } from '../src/shared/types.ts'

// 造一个迷你项目:TS 默认导入、省后缀相对导入、跨目录 ../、CommonJS require、
// Python 模块导入、外部包、别名路径、css 相对导入 —— 关系分析要样样接得住。
async function makeFixture(): Promise<string> {
  const root = join(tmpdir(), `codeatlas-depgraph-${Date.now()}`, 'demo-project')
  const put = async (rel: string, content: string): Promise<void> => {
    await fs.mkdir(dirname(join(root, rel)), { recursive: true })
    await fs.writeFile(join(root, rel), content, 'utf8')
  }
  await put('src/main.tsx', "import App from './App'\nApp()\n")
  await put(
    'src/App.tsx',
    "import { useState } from 'react'\nimport Button from './components/Button'\nimport '@/weird'\nButton()\n"
  )
  await put(
    'src/components/Button.tsx',
    "import { fmt } from '../utils/format'\nimport './Button.css'\nexport default Button\nfunction Button() {}\n"
  )
  await put(
    'src/utils/format.ts',
    "import { add } from './math'\nexport function fmt(): string { return String(add(1, 2)) }\n"
  )
  await put(
    'src/utils/math.ts',
    'export function add(a: number, b: number): number { return a + b }\n'
  )
  await put('legacy/old.js', "const { fmt } = require('../src/utils/format')\nconsole.log(fmt)\n")
  await put('run.py', 'from tools.calc import add\n\nprint(add(1, 2))\n')
  await put('tools/__init__.py', '')
  await put('tools/calc.py', 'def add(a, b):\n    return a + b\n')
  return root
}

// 造一个四语混合项目:Python 相对导入、Go 的 go.mod module 前缀、Java 的 Maven 布局与
// 静态导入、Rust 的 crate::/super::/mod 声明。go.mod 必须在扫描根,Rust 的 src/ 和
// Java 的 src/main/java/ 也按真实 cargo/Maven 布局摆在根下,让布局探测原样生效。
async function makePolyglotFixture(): Promise<string> {
  const root = join(tmpdir(), `codeatlas-depgraph-poly-${Date.now()}`, 'poly-project')
  const put = async (rel: string, content: string): Promise<void> => {
    await fs.mkdir(dirname(join(root, rel)), { recursive: true })
    await fs.writeFile(join(root, rel), content, 'utf8')
  }
  // Python:同目录相对导入、纯点连包自身、上跳一级、连不上的相对导入、标准库
  await put(
    'pyproject/app/main.py',
    'from .helpers import load\nfrom . import base\nfrom ..common import cache\nfrom .missing import gone\nimport os\n\nload()\ncache.save()\n'
  )
  await put('pyproject/app/helpers.py', 'def load():\n    return "data"\n')
  await put('pyproject/app/__init__.py', '')
  await put('pyproject/common/__init__.py', 'def save():\n    pass\n')
  // Go:go.mod 定 module 锚,子包目录里两个 .go(边落字典序第一个),标准库,幽灵包
  await put('go.mod', 'module example.com/greet\n\ngo 1.22\n')
  await put(
    'main.go',
    'package main\n\nimport (\n\t"fmt"\n\t"example.com/greet/util"\n\t"example.com/greet/ghost"\n)\n\nfunc main() {\n\tutil.Hi()\n\tfmt.Println("hi")\n}\n'
  )
  await put('util/extra.go', 'package util\n\nfunc Extra() {}\n')
  await put('util/helper.go', 'package util\n\nfunc Hi() {}\n')
  // Java:Maven 标准布局、静态导入砍段连类、JDK 包算外部
  await put(
    'src/main/java/com/acme/App.java',
    'package com.acme;\n\nimport com.acme.core.Service;\nimport static com.acme.core.Service.run;\nimport java.util.List;\n\npublic class App {\n    void go() {\n        run();\n        Service.describe();\n        List.of();\n    }\n}\n'
  )
  await put(
    'src/main/java/com/acme/core/Service.java',
    'package com.acme.core;\n\npublic class Service {\n    static void run() {}\n    static String describe() { return "svc"; }\n}\n'
  )
  // Rust:mod 声明与 crate:: 连同一文件(去重)、super:: 上跳、crate 里不存在的模块、外部 crate
  await put(
    'src/main.rs',
    'mod utils;\n\nuse crate::utils::clean;\nuse crate::nope::Thing;\nuse serde::Serialize;\n\nfn main() {\n    let _ = clean();\n    let _ = utils::clean;\n}\n'
  )
  await put('src/utils.rs', 'use super::config::Port;\n\npub fn clean() -> bool {\n    true\n}\n')
  await put('src/config.rs', 'pub struct Port;\n')
  return root
}

function edgeKeys(graph: DepGraphResult): Set<string> {
  return new Set(graph.edges.map((edge) => `${edge.from} => ${edge.to}`))
}

// 和 depgraph 内部同一个排序基准(localeCompare),断言只对集合内容,不赌两种排序的次序差异
function sortedEdges(graph: DepGraphResult): string[] {
  return [...edgeKeys(graph)].sort((a, b) => a.localeCompare(b))
}

/** 按 { relPath: 内容 } 造一个临时项目,返回项目根 */
async function makeProject(name: string, files: Record<string, string>): Promise<string> {
  const root = join(tmpdir(), `codeatlas-depgraph-${name}-${Date.now()}`, name)
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(root, rel)), { recursive: true })
    await fs.writeFile(join(root, rel), content, 'utf8')
  }
  return root
}

function makeAliasFixture(): Promise<string> {
  return makeProject('alias-project', {
    'tsconfig.json': [
      '{',
      '  // 行注释: "@fake/*": ["./nowhere/*"]',
      '  "compilerOptions": {',
      '    /* 块注释, 里面的 } 不算 */',
      '    "paths": {',
      '      "@shared/*": ["./src/shared/*", "./fallback/*"],',
      '      "@cfg": ["src\\\\config\\\\index.ts"],',
      '    },',
      '  },',
      '}',
      ''
    ].join('\n'),
    'src/app.ts': [
      "import { x } from '@shared/x'",
      "import { x as x2 } from '@shared/x.ts'",
      "import { u } from '@shared/util'",
      "import { m } from '@shared/missing'",
      "import { o } from '@shared/only'",
      "import { e } from '@shared/../../../outside'",
      "import all from '@shared'",
      "import { z } from '@sharedx/y'",
      "import { cfg } from '@cfg'",
      "import React from 'react'",
      'export const v = [x, x2, u, m, o, e, all, z, cfg, React]',
      ''
    ].join('\n'),
    'src/shared/x.ts': 'export const x = 1\n',
    'src/shared/util/index.ts': 'export const u = 1\n',
    'src/config/index.ts': 'export const cfg = 1\n',
    'fallback/only.ts': 'export const o = 1\n'
  })
}

function makeBaseUrlFixture(): Promise<string> {
  return makeProject('baseurl-project', {
    'tsconfig.json':
      '{ "compilerOptions": { "baseUrl": "./src", "paths": { "~lib/*": ["lib/*"] } } }\n',
    'src/main.ts': [
      "import { a } from '~lib/a'",
      "import { n } from '~lib/none'",
      "import { b } from 'feature/b'",
      "import _ from 'lodash'",
      'export const v = [a, n, b, _]',
      ''
    ].join('\n'),
    'src/lib/a.ts': 'export const a = 1\n',
    'src/feature/b.ts': 'export const b = 1\n'
  })
}

/**
 * electron-vite 模板布局:根 tsconfig 只有 references,别名写在 tsconfig.web.json / tsconfig.node.json,
 * 还有相对 extends 链(含环)、无法安全解析的包名 extends,以及指向子目录的 reference。
 */
function makeReferencesFixture(): Promise<string> {
  return makeProject('refs-project', {
    'tsconfig.json':
      '{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }, { "path": "./packages/lib" }, { "path": "./missing.json" }] }\n',
    'tsconfig.web.json':
      '{ "extends": "@electron-toolkit/tsconfig/tsconfig.web.json", "compilerOptions": { "baseUrl": ".", "paths": { "@renderer/*": ["src/renderer/src/*"] } } }\n',
    'tsconfig.node.json': '{ "extends": "./config/tsconfig.base", "include": ["src/main/**/*"] }\n',
    'config/tsconfig.base.json':
      '{ "extends": ["../tsconfig.node.json"], "compilerOptions": { "paths": { "@main/*": ["../src/main/*"] } } }\n',
    'packages/lib/tsconfig.json': '{ "compilerOptions": { "paths": { "@lib/*": ["./src/*"] } } }\n',
    'src/renderer/src/App.tsx': [
      "import { r } from '@renderer/r'",
      "import { m } from '@main/m'",
      "import { l } from '@lib/l'",
      "import React from 'react'",
      'export const v = [r, m, l, React]',
      ''
    ].join('\n'),
    'src/renderer/src/r.ts': 'export const r = 1\n',
    'src/main/m.ts': 'export const m = 1\n',
    'packages/lib/src/l.ts': 'export const l = 1\n'
  })
}

/** tsPaths 纯函数的边界用例:不走文件系统,直接喂字符串 */
function runTsPathUnitCases(): void {
  const files = new Set(['src/shared/x.ts', 'src/x.ts', 'lib/y.ts'])
  const match = (base: string): string | null =>
    files.has(base) ? base : files.has(`${base}.ts`) ? `${base}.ts` : null

  assert.equal(parseTsPathAliases('not json'), null, '非 JSON 返回 null')
  assert.equal(parseTsPathAliases('[]'), null, '顶层不是对象返回 null')
  assert.equal(parseTsPathAliases('{}'), null, '没有 paths 与 baseUrl 返回 null')
  const bom = parseTsPathAliases('\uFEFF{"compilerOptions":{"paths":{"@s/*":["src/shared/*"]}}}')
  assert.equal(resolveTsAlias('@s/x', bom, match)?.to, 'src/shared/x.ts', 'BOM 开头也能解析')
  const strings = parseTsPathAliases(
    '{"compilerOptions":{"paths":{"@a/*":["src/*"],"//x":["/*not-a-comment*/"]},}}'
  )
  assert.equal(
    resolveTsAlias('@a/x', strings, match)?.to,
    'src/x.ts',
    '字符串里的 // 与 /* 不当注释'
  )
  const longest = parseTsPathAliases(
    '{"compilerOptions":{"paths":{"@/*":["lib/*"],"@/shared/*":["src/shared/*"]}}}'
  )
  assert.equal(resolveTsAlias('@/shared/x', longest, match)?.to, 'src/shared/x.ts', '最长前缀优先')
  assert.equal(resolveTsAlias('@/y', longest, match)?.to, 'lib/y.ts', '短前缀兜底')
  const abs = parseTsPathAliases('{"compilerOptions":{"baseUrl":"C:/elsewhere"}}')
  assert.equal(resolveTsAlias('x', abs, match), null, '绝对路径 baseUrl 不采用')
  const up = parseTsPathAliases('{"compilerOptions":{"baseUrl":"../outside"}}')
  assert.equal(resolveTsAlias('x', up, match), null, '上跳出根的 baseUrl 不采用')
  const root = parseTsPathAliases('{"compilerOptions":{"baseUrl":"."}}')
  assert.equal(resolveTsAlias('lib/y', root, match)?.to, 'lib/y.ts', 'baseUrl 为根时裸路径可连')
  assert.equal(resolveTsAlias('react', root, match), null, 'baseUrl 下找不到交回外部包判定')
  assert.equal(resolveTsAlias('/lib/y', root, match), null, '绝对说明符不走别名')
  const catchAll = parseTsPathAliases('{"compilerOptions":{"paths":{"*":["lib/*"]}}}')
  assert.equal(resolveTsAlias('y', catchAll, match)?.to, 'lib/y.ts', "纯 '*' 规则能连上时照连")
  assert.equal(resolveTsAlias('react', catchAll, match), null, "纯 '*' 规则连不上时交回外部包判定")
  assert.equal(
    parseTsPathAliases('{"extends":"./tsconfig.base.json"}'),
    null,
    '单份文本解析不跟 extends(跟链由 loadTsPathAliases 读文件时负责)'
  )
  const multi = parseTsPathAliases(
    '{"compilerOptions":{"paths":{"@s/*":["nowhere/*","../outside/*","src/shared/*"]}}}'
  )
  assert.equal(
    resolveTsAlias('@s/x', multi, match)?.to,
    'src/shared/x.ts',
    '多个候选按顺序试,跳过连不上与越界的'
  )
  assert.equal(resolveTsAlias('@s/x', null, match), null, '没有 tsconfig 时不介入')
}
/** 规模基准:400 份样式 × 每份 50 个类名 × 4000 个源码文件,类名使用量统计要远低于 1 秒 */
function checkClassUsageScale(): void {
  const classesByStyle = new Map<string, string[]>()
  for (let s = 0; s < 400; s++) {
    classesByStyle.set(
      `styles/s${s}.css`,
      Array.from({ length: 50 }, (_, c) => `s${s}-c${c}`)
    )
  }
  const files = Array.from({ length: 4000 }, (_, f) => ({
    relPath: `src/f${f}.tsx`,
    tokens: new Set(Array.from({ length: 8 }, (_, k) => `s${(f + k) % 400}-c${(f * 7 + k) % 50}`))
  }))
  const startedAt = performance.now()
  const links = classUsageLinks(classesByStyle, files)
  const elapsed = performance.now() - startedAt
  console.log(`  类名使用量 400 样式 × 50 类名 × 4000 文件:${elapsed.toFixed(1)} ms`)
  assert.ok(links.length > 0, '规模基准应产出链接')
  assert.ok(elapsed < 1000, `类名使用量统计应远低于 1 秒,实际 ${elapsed.toFixed(0)} ms`)
}

/** 样式文件的纯函数:@import 抽取、类名抽取、类名使用量、样式导入路径解析 */
function runStyleUnitCases(): void {
  assert.deepEqual(
    extractCssImports(
      "/* @import './commented.css'; */\n@import './a.css';\n@import url(\"../b.css\") screen;\n@import url(c.css);\n.x { background: url('./img.png') }\n"
    ),
    ['./a.css', '../b.css', 'c.css'],
    '@import 三种写法都抽出,注释里的与 url() 背景图不算'
  )
  assert.deepEqual(
    extractCssClasses(
      "/* .ghost {} */\n.panel-card, .panel-card:hover > .title { margin: 0.5rem; background: url('a.png') }\n@media (min-width: 40rem) { .wide { padding: 1.5em } }\n:root { --gap: 0.25rem }\n"
    ),
    ['panel-card', 'title', 'wide'],
    '只抽选择器里的类名,去重排序;数值小数、url 后缀、注释不算'
  )
  assert.deepEqual(
    extractCssClasses(
      'a[href$=".pdf"] .doc-link, .btn::after, .row:nth-child(2n+1.5), [data-x=\'.fake\'] { margin: 0 }\n:is(.alpha, .beta):hover { margin: 0 }\n'
    ),
    ['alpha', 'beta', 'btn', 'doc-link', 'row'],
    '属性选择器与伪类参数里的 .xxx 不算类名;:is() 这类选择器参数里的照算'
  )
  const tokens = (code: string): string[] => [...extractClassTokens(code)].sort()
  assert.deepEqual(tokens('export const P = () => <div className="panel-card shared" />'), [
    'panel-card',
    'shared'
  ])
  assert.deepEqual(
    tokens("<i className={open ? 'is-open' : \"closed\"} class='plain' />"),
    ['closed', 'is-open', 'plain'],
    'className / class 的表达式里的字符串都算'
  )
  assert.deepEqual(
    tokens("<b className={`tab ${active ? 'tab-active' : ''} tab-${kind}`} />"),
    ['tab', 'tab-active'],
    '模板字符串的静态部分算,紧贴插值的半截词不算'
  )
  assert.deepEqual(
    tokens(
      "clsx('a-1', { 'b-2': x }, cond && \"c-3\"); cn('d-4'); classnames('e-5'); classNames(`f-6`)"
    ),
    ['a-1', 'b-2', 'c-3', 'd-4', 'e-5', 'f-6'],
    'clsx / cn / classnames 的参数里的字符串都算'
  )
  assert.deepEqual(
    tokens("el.classList.add('g-7', 'h-8'); el.classList.toggle('i-9', on); el.className = 'k-10'"),
    ['g-7', 'h-8', 'i-9', 'k-10'],
    'classList 增删切换与 className 赋值都算'
  )
  assert.deepEqual(tokens('host.innerHTML = `<span class="m-11">${x}</span>`'), ['m-11'])
  assert.deepEqual(
    tokens("const label = 'open'\nthrow new Error('error')\nconst panelCard = 1 // other-box"),
    [],
    '普通字符串、标识符与注释不算类名'
  )
  const links = classUsageLinks(
    new Map([
      ['s/panel.css', ['panel-card', 'shared']],
      ['s/other.css', ['other-box']]
    ]),
    [
      { relPath: 'ui/Panel.tsx', tokens: new Set(['panel-card', 'shared']) },
      { relPath: 'ui/List.tsx', tokens: new Set(['shared']) },
      { relPath: 'ui/None.ts', tokens: new Set() }
    ]
  )
  assert.deepEqual(
    links,
    [
      { from: 'ui/List.tsx', to: 's/panel.css', kind: 'usage', weight: 0.5 },
      { from: 'ui/Panel.tsx', to: 's/panel.css', kind: 'usage', weight: 1.5 }
    ],
    '多个文件共用的类名按使用文件数均分权重'
  )
  checkClassUsageScale()
  const styleFiles = new Set(['src/assets/main.css', 'src/assets/css/a.css'])
  assert.equal(
    resolveStylePath('src/main.tsx', './assets/main.css', styleFiles, null),
    'src/assets/main.css'
  )
  assert.equal(
    resolveStylePath('src/assets/main.css', './css/a.css?inline', styleFiles, null),
    'src/assets/css/a.css'
  )
  assert.equal(resolveStylePath('src/main.tsx', './assets/none.css', styleFiles, null), null)
  assert.equal(resolveStylePath('src/main.tsx', '../../outside.css', styleFiles, null), null)
  const aliases = parseTsPathAliases('{"compilerOptions":{"paths":{"@a/*":["src/assets/*"]}}}')
  assert.equal(
    resolveStylePath('src/x/y.tsx', '@a/main.css', styleFiles, aliases),
    'src/assets/main.css',
    '样式导入也认别名'
  )
  assert.equal(
    resolveStylePath('src/x/y.tsx', 'pkg/dist/style.css', styleFiles, aliases),
    null,
    '依赖包的样式不连'
  )
}

async function main(): Promise<void> {
  // 第一轮:JS/TS + Python 平铺的老场景,行为必须和以前一模一样
  const root = await makeFixture()
  try {
    const graph = await buildDependencyGraph(root)

    // 1. 六条边,一条不多一条不少(去重、排序后精确比对)
    const expected = [
      'legacy/old.js => src/utils/format.ts', // CommonJS require 也要认
      'run.py => tools/calc.py', // Python 模块导入
      'src/App.tsx => src/components/Button.tsx', // 省后缀 ./ 相对导入
      'src/components/Button.tsx => src/utils/format.ts', // ../ 上跳
      'src/main.tsx => src/App.tsx', // 默认导入
      'src/utils/format.ts => src/utils/math.ts' // 同目录 ./math
    ]
    assert.deepEqual(
      sortedEdges(graph),
      expected.sort((a, b) => a.localeCompare(b)),
      '连出来的边和预期不一致'
    )

    // 2. 影响范围排行:format.ts 被 old.js 和 Button.tsx 引用,入度 2 应排第一
    assert.equal(graph.hubs[0]?.relPath, 'src/utils/format.ts', '入度最高的应是 format.ts')
    assert.equal(graph.hubs[0]?.inCount, 2, 'format.ts 入度应为 2')

    // 3. 出度:App.tsx 引了 Button;math.ts 谁也不引
    const app = graph.nodes.find((n) => n.relPath === 'src/App.tsx')
    assert.equal(app?.outCount, 1, 'App.tsx 出度应为 1')
    const math = graph.nodes.find((n) => n.relPath === 'src/utils/math.ts')
    assert.equal(math?.inCount, 1, 'math.ts 入度应为 1')

    // 4. 外部包与没连上的,分开记账,不许混进边里
    assert.equal(graph.stats.externalCount, 1, '外部包只有 react,应记 1 次')
    const unresolvedKeys = graph.stats.unresolved.map((u) => `${u.from} ? ${u.spec}`)
    assert.deepEqual(
      unresolvedKeys.sort(),
      ['src/App.tsx ? @/weird', 'src/components/Button.tsx ? ./Button.css'],
      '别名与 css 导入应记为 unresolved'
    )

    // 5. 统计:9 个源码文件全分析了,0 个跳过
    assert.equal(graph.stats.analyzed, 9, '应有 9 个源码文件被分析')
    assert.equal(graph.stats.skipped, 0, '不应有文件被跳过')

    // 6. 路径契约:所有边端点和节点 relPath 必须长一个样——'/' 分隔、不带根名、能在节点表里查到
    const nodePaths = new Set(graph.nodes.map((n) => n.relPath))
    for (const edge of graph.edges) {
      assert.ok(nodePaths.has(edge.from), `边的 from 不在节点表里:${edge.from}`)
      assert.ok(nodePaths.has(edge.to), `边的 to 不在节点表里:${edge.to}`)
    }
    for (const relPath of nodePaths) {
      assert.ok(!relPath.includes('\\'), `relPath 分隔符必须是 '/':${relPath}`)
      assert.ok(!relPath.startsWith(`${graph.rootPath}/`), `relPath 混入了绝对路径:${relPath}`)
    }
  } finally {
    await fs.rm(dirname(root), { recursive: true, force: true })
  }

  // 第二轮:Python 相对导入 + Go + Java + Rust,四种语言各连各的
  const polyRoot = await makePolyglotFixture()
  try {
    const graph = await buildDependencyGraph(polyRoot)

    // 1. 七条边精确命中:Python 相对导入三条、Go 包目录一条、Java 静态导入去重一条、Rust mod+use 去重一条加 super 一条
    const polyExpected = [
      'main.go => util/extra.go', // Go:module 前缀砍掉,包目录里字典序第一个 .go(extra < helper)当代表
      'pyproject/app/main.py => pyproject/app/__init__.py', // 纯 '.' 连当前包自身
      'pyproject/app/main.py => pyproject/app/helpers.py', // '.helpers' 同目录
      'pyproject/app/main.py => pyproject/common/__init__.py', // '..common' 上跳一级
      'src/main/java/com/acme/App.java => src/main/java/com/acme/core/Service.java', // 静态导入砍段连到类,与普通导入去重
      'src/main.rs => src/utils.rs', // mod utils 和 use crate::utils::clean 连同一处,去重成一条
      'src/utils.rs => src/config.rs' // super:: 从 src/ 上跳到 crate 根再找 config
    ]
    assert.deepEqual(
      sortedEdges(graph),
      polyExpected.sort((a, b) => a.localeCompare(b)),
      '四语混合项目的边和预期不一致'
    )

    // 2. 外部记账:fmt、java.util.List、os、serde::Serialize,四种语言各一份
    assert.equal(graph.stats.externalCount, 4, '外部包应记 4 次')

    // 3. 项目内却连不上的三条,老实记 unresolved,不许混成外部包
    const polyUnresolved = graph.stats.unresolved.map((u) => `${u.from} ? ${u.spec}`)
    assert.deepEqual(
      polyUnresolved.sort(),
      [
        'main.go ? example.com/greet/ghost',
        'pyproject/app/main.py ? .missing',
        'src/main.rs ? crate::nope::Thing'
      ],
      '幽灵包/缺失模块应记为 unresolved'
    )

    // 4. 12 个源码文件全分析,被引用的文件正好 7 个进排行,每条引用各算一票
    assert.equal(graph.stats.analyzed, 12, '应有 12 个源码文件被分析')
    assert.equal(graph.hubs.length, 7, '被引用的文件应有 7 个')
    for (const hub of graph.hubs) assert.equal(hub.inCount, 1, '每个被引用文件入度都应为 1')

    // 5. 路径契约在四种语言下同样成立
    const polyNodes = new Set(graph.nodes.map((n) => n.relPath))
    for (const edge of graph.edges) {
      assert.ok(
        polyNodes.has(edge.from) && polyNodes.has(edge.to),
        `边端点必须都在节点表里:${edge.from} => ${edge.to}`
      )
    }
  } finally {
    await fs.rm(dirname(polyRoot), { recursive: true, force: true })
  }

  // 第三轮:tsconfig paths 别名(带注释与尾逗号的 JSONC),多候选按顺序逐个试,越界与缺失记 unresolved
  const aliasRoot = await makeAliasFixture()
  try {
    const graph = await buildDependencyGraph(aliasRoot)
    assert.deepEqual(
      sortedEdges(graph),
      [
        'src/app.ts => fallback/only.ts', // '@shared/only' 第一候选没有,第二候选连上
        'src/app.ts => src/config/index.ts', // '@cfg' 精确规则
        'src/app.ts => src/shared/util/index.ts', // '@shared/util' 补 /index
        'src/app.ts => src/shared/x.ts' // '@shared/x' 与 '@shared/x.ts' 去重成一条
      ],
      '别名导入应连到 src/shared 与 src/config'
    )
    // '@shared'(不带斜杠,不匹配 '@shared/*')、'@sharedx/y'、react 仍是外部包
    assert.equal(graph.stats.externalCount, 3, '别名之外的外部包应记 3 次')
    assert.deepEqual(
      graph.stats.unresolved.map((u) => u.spec).sort(),
      ['@shared/../../../outside', '@shared/missing'],
      '别名命中但所有候选都连不上(缺文件、上跳出根)应记 unresolved'
    )
  } finally {
    await fs.rm(dirname(aliasRoot), { recursive: true, force: true })
  }

  // 第四轮:baseUrl 变体 —— paths 相对 baseUrl 解析;只有 baseUrl 时裸说明符先试 baseUrl 下的文件
  const baseRoot = await makeBaseUrlFixture()
  try {
    const graph = await buildDependencyGraph(baseRoot)
    assert.deepEqual(
      sortedEdges(graph),
      ['src/main.ts => src/feature/b.ts', 'src/main.ts => src/lib/a.ts'],
      'baseUrl 下的 paths 与裸路径都应连上'
    )
    assert.equal(graph.stats.externalCount, 1, 'baseUrl 下找不到的 lodash 仍是外部包')
    assert.deepEqual(
      graph.stats.unresolved.map((u) => u.spec),
      ['~lib/none'],
      'paths 命中但缺文件应记 unresolved'
    )
  } finally {
    await fs.rm(dirname(baseRoot), { recursive: true, force: true })
  }

  // 第五轮:根 tsconfig 只有 references(electron-vite 模板),别名藏在被引用的配置与 extends 链里
  const refsRoot = await makeReferencesFixture()
  try {
    const graph = await buildDependencyGraph(refsRoot)
    assert.deepEqual(
      sortedEdges(graph),
      [
        'src/renderer/src/App.tsx => packages/lib/src/l.ts', // 子目录 reference 的 paths 相对它自己的目录
        'src/renderer/src/App.tsx => src/main/m.ts', // reference → 相对 extends(省 .json)→ paths;extends 成环不卡死
        'src/renderer/src/App.tsx => src/renderer/src/r.ts' // reference 里的 baseUrl + paths;包名 extends 跳过
      ],
      'references 与 extends 链里的别名都应连上'
    )
    assert.equal(graph.stats.externalCount, 1, '只有 react 记外部包')
    assert.deepEqual(graph.stats.unresolved, [], '不应有断线')
  } finally {
    await fs.rm(dirname(refsRoot), { recursive: true, force: true })
  }

  // 第六轮:存在的样式文件被导入时连得上,不再记 unresolved;不存在的仍记
  const styleRoot = await makeProject('style-project', {
    'src/main.tsx': "import './assets/main.css'\nimport './assets/ghost.css'\nexport const v = 1\n",
    'src/assets/main.css': "@import './css/a.css';\n.app-shell { margin: 0 }\n",
    'src/assets/css/a.css': '.panel { margin: 0 }\n'
  })
  try {
    const graph = await buildDependencyGraph(styleRoot)
    assert.deepEqual(
      graph.stats.unresolved.map((u) => u.spec),
      ['./assets/ghost.css'],
      '存在的 css 连上,只有不存在的记 unresolved'
    )
    assert.deepEqual(graph.edges, [], '样式导入不进文件导入边(边两端必须都是可分析文件)')
  } finally {
    await fs.rm(dirname(styleRoot), { recursive: true, force: true })
  }

  // 第七轮:tsconfig 坏掉(不是合法 JSONC)时行为与没有 tsconfig 一致
  const brokenRoot = await makeProject('broken-tsconfig', {
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@shared/*": ["./src/shared/*"] ',
    'src/a.ts': "import { x } from '@shared/x'\nexport const y = x\n",
    'src/shared/x.ts': 'export const x = 1\n'
  })
  try {
    const graph = await buildDependencyGraph(brokenRoot)
    assert.equal(graph.edges.length, 0, '坏 tsconfig 不应连出别名边')
    assert.equal(graph.stats.externalCount, 1, '坏 tsconfig 时 @shared/x 按改前口径记外部包')
  } finally {
    await fs.rm(dirname(brokenRoot), { recursive: true, force: true })
  }

  runTsPathUnitCases()
  runStyleUnitCases()

  console.log('✅ 项目关系分析自测全部通过')
  console.log(
    '   老场景六条边精确命中 · Python 相对导入/Go go.mod/Java Maven/Rust crate 全连上 · 内部断线和外部包分开记账'
  )
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
