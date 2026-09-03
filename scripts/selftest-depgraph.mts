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

function edgeKeys(graph: DepGraphResult): Set<string> {
  return new Set(graph.edges.map((edge) => `${edge.from} => ${edge.to}`))
}

async function main(): Promise<void> {
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
    assert.deepEqual([...edgeKeys(graph)].sort(), expected, '连出来的边和预期不一致')

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

  console.log('✅ 项目关系分析自测全部通过')
  console.log('   六条边精确命中(TS/JSX/require/Python) · 外部包与别名分开记账 · 路径契约全绿')
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
