import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { buildDependencyGraph } from '../src/depgraph/index.ts'
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
  await put('src/utils/format.ts', "import { add } from './math'\nexport function fmt(): string { return String(add(1, 2)) }\n")
  await put('src/utils/math.ts', 'export function add(a: number, b: number): number { return a + b }\n')
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
  await put('pyproject/app/main.py', 'from .helpers import load\nfrom . import base\nfrom ..common import cache\nfrom .missing import gone\nimport os\n\nload()\ncache.save()\n')
  await put('pyproject/app/helpers.py', 'def load():\n    return "data"\n')
  await put('pyproject/app/__init__.py', '')
  await put('pyproject/common/__init__.py', 'def save():\n    pass\n')
  // Go:go.mod 定 module 锚,子包目录里两个 .go(边落字典序第一个),标准库,幽灵包
  await put('go.mod', 'module example.com/greet\n\ngo 1.22\n')
  await put('main.go', 'package main\n\nimport (\n\t"fmt"\n\t"example.com/greet/util"\n\t"example.com/greet/ghost"\n)\n\nfunc main() {\n\tutil.Hi()\n\tfmt.Println("hi")\n}\n')
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
  await put('src/main.rs', 'mod utils;\n\nuse crate::utils::clean;\nuse crate::nope::Thing;\nuse serde::Serialize;\n\nfn main() {\n    let _ = clean();\n    let _ = utils::clean;\n}\n')
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

async function main(): Promise<void> {
  // ── 第一轮:JS/TS + Python 平铺的老场景,行为必须和以前一模一样 ──
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
    assert.deepEqual(sortedEdges(graph), expected.sort((a, b) => a.localeCompare(b)), '连出来的边和预期不一致')

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

  // ── 第二轮:Python 相对导入 + Go + Java + Rust,四种语言各连各的 ──
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
    assert.deepEqual(sortedEdges(graph), polyExpected.sort((a, b) => a.localeCompare(b)), '四语混合项目的边和预期不一致')

    // 2. 外部记账:fmt、java.util.List、os、serde::Serialize,四种语言各一份
    assert.equal(graph.stats.externalCount, 4, '外部包应记 4 次')

    // 3. 项目内却连不上的三条,老实记 unresolved,不许混成外部包
    const polyUnresolved = graph.stats.unresolved.map((u) => `${u.from} ? ${u.spec}`)
    assert.deepEqual(
      polyUnresolved.sort(),
      ['main.go ? example.com/greet/ghost', 'pyproject/app/main.py ? .missing', 'src/main.rs ? crate::nope::Thing'],
      '幽灵包/缺失模块应记为 unresolved'
    )

    // 4. 12 个源码文件全分析,被引用的文件正好 7 个进排行,每条引用各算一票
    assert.equal(graph.stats.analyzed, 12, '应有 12 个源码文件被分析')
    assert.equal(graph.hubs.length, 7, '被引用的文件应有 7 个')
    for (const hub of graph.hubs) assert.equal(hub.inCount, 1, '每个被引用文件入度都应为 1')

    // 5. 路径契约在四种语言下同样成立
    const polyNodes = new Set(graph.nodes.map((n) => n.relPath))
    for (const edge of graph.edges) {
      assert.ok(polyNodes.has(edge.from) && polyNodes.has(edge.to), `边端点必须都在节点表里:${edge.from} => ${edge.to}`)
    }
  } finally {
    await fs.rm(dirname(polyRoot), { recursive: true, force: true })
  }

  console.log('✅ 项目关系分析自测全部通过')
  console.log('   老场景六条边精确命中 · Python 相对导入/Go go.mod/Java Maven/Rust crate 全连上 · 内部断线和外部包分开记账')
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
