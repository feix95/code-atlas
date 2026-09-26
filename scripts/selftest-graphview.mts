import assert from 'node:assert/strict'
import { buildLevelGraph, type LevelGraph } from '../src/shared/graphView.ts'
import type { DepEdge, ScanDirNode, ScanFileNode, ScanTreeNode } from '../src/shared/types.ts'

// 关系图谱单层视图(drill-down)的纯函数自测:节点只取当前目录的直接子项,
// 引用边按「归并规则」映射到直接子项,层外端点映射为外部节点。

function file(relPath: string): ScanFileNode {
  const name = relPath.split('/').pop() ?? relPath
  const dot = name.lastIndexOf('.')
  return { type: 'file', name, relPath, ext: dot > 0 ? name.slice(dot) : '' }
}

function dir(relPath: string, children: ScanTreeNode[], lazy = false): ScanDirNode {
  const name = relPath === '' ? 'demo' : (relPath.split('/').pop() ?? relPath)
  return { type: 'directory', name, relPath, children, ...(lazy ? { lazy: true } : {}) }
}

const tree = dir('', [
  dir('src', [
    file('src/main.ts'),
    file('src/App.tsx'),
    dir('src/utils', [file('src/utils/format.ts'), file('src/utils/math.ts')]),
    dir('src/shared', [file('src/shared/types.ts')]),
    dir('src/vendorish', [], true)
  ]),
  dir('assets', [file('assets/logo.png')]),
  file('README.md'),
  file('run.ts')
])

const edges: DepEdge[] = [
  { from: 'src/main.ts', to: 'src/App.tsx' },
  { from: 'src/App.tsx', to: 'src/utils/format.ts' },
  { from: 'src/App.tsx', to: 'src/utils/math.ts' },
  { from: 'src/utils/format.ts', to: 'src/utils/math.ts' },
  { from: 'src/utils/format.ts', to: 'src/shared/types.ts' },
  { from: 'run.ts', to: 'src/main.ts' }
]

function node(g: LevelGraph, id: string): LevelGraph['nodes'][number] {
  const n = g.nodes.find((x) => x.id === id)
  assert.ok(n, `缺节点 ${id}`)
  return n
}

function edge(g: LevelGraph, from: string, to: string): LevelGraph['edges'][number] | undefined {
  return g.edges.find((e) => e.from === from && e.to === to)
}

// ── 根目录视角 ──
{
  const g = buildLevelGraph(tree, edges, '')
  assert.ok(g)
  assert.deepEqual(
    g.nodes.map((n) => [n.id, n.kind]),
    [
      ['src', 'folder'],
      ['assets', 'folder'],
      ['README.md', 'file'],
      ['run.ts', 'file']
    ],
    '根视角只列直接子项,文件夹在前'
  )
  // run.ts → src/main.ts 归并成 run.ts → src;src 内部的边全部是目录内部自引用,丢弃
  assert.deepEqual(g.edges, [{ from: 'run.ts', to: 'src', weight: 1 }])
  assert.equal(node(g, 'README.md').degree, 0, 'README 是孤立节点')
  assert.equal(node(g, 'assets').degree, 0, '无引用的文件夹也是孤立节点')
  assert.equal(node(g, 'src').descendantFiles, 5, '文件夹统计全部已扫描的后代文件')
  assert.equal(node(g, 'src').degree, 1)
}

// ── 子目录视角:层内边、归并计数、外部节点 ──
{
  const g = buildLevelGraph(tree, edges, 'src')
  assert.ok(g)
  assert.deepEqual(
    g.nodes.filter((n) => n.kind !== 'external').map((n) => n.id),
    ['src/utils', 'src/shared', 'src/vendorish', 'src/main.ts', 'src/App.tsx'],
    '子项顺序与扫描树一致,文件夹在前'
  )
  assert.equal(edge(g, 'src/main.ts', 'src/App.tsx')?.weight, 1)
  assert.equal(edge(g, 'src/App.tsx', 'src/utils')?.weight, 2, 'App 引用 utils 下两个文件,归并计 2')
  assert.equal(edge(g, 'src/utils', 'src/shared')?.weight, 1, '子目录之间的引用归并到两个文件夹')
  assert.equal(edge(g, 'src/utils', 'src/utils'), undefined, 'utils 内部互引丢弃')
  // run.ts 在 src 外:映射为外部节点
  const ext = node(g, 'run.ts')
  assert.equal(ext.kind, 'external')
  assert.equal(ext.target, 'file', '外部端点就是文件本身时标为文件')
  assert.equal(edge(g, 'run.ts', 'src/main.ts')?.weight, 1)
  assert.equal(node(g, 'src/vendorish').lazy, true, '未扫描目录带 lazy 标记')
  assert.equal(node(g, 'src/App.tsx').degree, 3, '度数按归并后的权重累计')
}

// ── 深层视角:外部节点取与当前目录最近公共祖先的下一级 ──
{
  const g = buildLevelGraph(tree, edges, 'src/utils')
  assert.ok(g)
  const shared = node(g, 'src/shared')
  assert.equal(shared.kind, 'external')
  assert.equal(shared.target, 'folder', '外部端点是目录时标为文件夹,单击可导航')
  assert.equal(shared.label, 'shared', '外部节点标签只取最后一段,完整路径在 id')
  assert.equal(edge(g, 'src/utils/format.ts', 'src/shared')?.weight, 1)
  const app = node(g, 'src/App.tsx')
  assert.equal(app.kind, 'external')
  assert.equal(edge(g, 'src/App.tsx', 'src/utils/format.ts')?.weight, 1)
  assert.equal(edge(g, 'src/utils/format.ts', 'src/utils/math.ts')?.weight, 1)
  assert.ok(!g.nodes.some((n) => n.id === 'run.ts'), '两端都在层外的边(run.ts → src/main.ts)不出现')
}

// ── 目录不存在 → null ──
assert.equal(buildLevelGraph(tree, edges, 'nope'), null)

// ── 空目录、未扫描目录:无节点 ──
{
  const g = buildLevelGraph(tree, edges, 'src/vendorish')
  assert.ok(g)
  assert.equal(g.nodes.length, 0)
  assert.equal(g.lazy, true, '当前目录本身未扫描时带 lazy 标记,界面据此先扫描')
}

// ── 引用端点不在扫描树里(边比树新):不凭空造节点 ──
{
  const g = buildLevelGraph(tree, [{ from: 'src/ghost.ts', to: 'src/main.ts' }], 'src')
  assert.ok(g)
  assert.equal(g.edges.length, 0)
  assert.ok(!g.nodes.some((n) => n.id === 'src/ghost.ts'))
}

// ── 单层节点超限:按度数保留前 N 个,其余归并为「其余」节点,边改挂过去 ──
{
  const many: ScanTreeNode[] = []
  for (let i = 0; i < 10; i++) many.push(file(`big/f${i}.ts`))
  const bigTree = dir('', [dir('big', many)])
  const bigEdges: DepEdge[] = [
    { from: 'big/f0.ts', to: 'big/f1.ts' },
    { from: 'big/f2.ts', to: 'big/f1.ts' },
    { from: 'big/f9.ts', to: 'big/f8.ts' }
  ]
  const g = buildLevelGraph(bigTree, bigEdges, 'big', 4)
  assert.ok(g)
  const kept = g.nodes.filter((n) => n.kind === 'file').map((n) => n.id)
  assert.equal(kept.length, 3, '上限 4 = 保留 3 个 + 1 个「其余」节点')
  assert.ok(kept.includes('big/f1.ts'), '度数最高的优先保留')
  const rest = g.nodes.find((n) => n.kind === 'overflow')
  assert.ok(rest)
  assert.equal(rest.hiddenCount, 7)
  assert.equal(g.nodes.length, 4)
  // 被收进「其余」的节点之间的边变成自引用,丢弃;与保留节点之间的边挂到「其余」节点
  for (const e of g.edges) {
    assert.ok(g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to))
    assert.notEqual(e.from, e.to)
  }
}

console.log('selftest-graphview: 全部通过')
