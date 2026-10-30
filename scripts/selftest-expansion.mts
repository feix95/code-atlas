import assert from 'node:assert/strict'
import { folderTree } from '../src/shared/hierarchy.ts'
import { buildVisibleGraph, isVisibleGraphRejection } from '../src/shared/visibleGraph.ts'
import {
  collapseSubtree,
  expandCandidates,
  expandFolder,
  expandIds,
  trimExpansion,
  tryExpand
} from '../src/shared/expansion.ts'
import type { DepEdge, ScanDirNode, ScanFileNode, ScanTreeNode } from '../src/shared/types.ts'

// 展开状态的纯逻辑自测:候选挑选、逐个试展开、超限收回、级联收起、lazy 目录先扫描。

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

const group = folderTree(tree)
const NONE: ReadonlySet<string> = new Set()

function level(expanded: ReadonlySet<string>, focus = ''): ReturnType<typeof buildVisibleGraph> {
  return buildVisibleGraph(group, edges, focus, expanded)
}

// 候选:只挑浅层、未展开、已扫描的文件夹;容器自身与文件不入选
{
  const base = level(NONE, 'src')
  assert.ok(base && !isVisibleGraphRejection(base))
  assert.deepEqual(expandCandidates(base.nodes, NONE, 2), ['src/utils', 'src/shared'])
  const utils = new Set(['src/utils'])
  const expanded = level(utils, 'src')
  assert.ok(expanded && !isVisibleGraphRejection(expanded))
  assert.deepEqual(
    expandCandidates(expanded.nodes, utils, 2),
    ['src/shared'],
    '已展开的容器不再入选'
  )
  assert.deepEqual(expandCandidates(base.nodes, NONE, 1), [], '深度不到时不自动展开')
}

// 逐个试展开:放得下的留下,放不下的跳过并记原因
{
  const capped = expandIds(group, edges, 'src', NONE, ['src/shared', 'src/utils'], 6)
  assert.deepEqual([...capped.ids], ['src/shared'], 'shared 放得下,utils 放不下被跳过')
  assert.equal(capped.rejected, 'total', '多个展开叠加超限归为 total')
  const graph = buildVisibleGraph(group, edges, 'src', capped.ids, 6)
  assert.ok(graph && !isVisibleGraphRejection(graph))
  assert.equal(graph.nodes.filter((n) => n.kind !== 'external').length, 6)
}

// 单个文件夹自己就超限:原因归为 folder
{
  const bigTree = dir('', [
    dir(
      'big',
      Array.from({ length: 6 }, (_, i) => file(`big/${i}.ts`))
    )
  ])
  const big = folderTree(bigTree)
  const outcome = tryExpand(big, [], '', NONE, 'big', 3)
  assert.equal(outcome.kind, 'rejected')
  assert.equal(outcome.kind === 'rejected' ? outcome.reason : null, 'folder')
}

// 非法目标:文件、不存在的 id、已展开的 id 都是 ignored
{
  assert.equal(tryExpand(group, edges, 'src', NONE, 'src/main.ts').kind, 'ignored')
  assert.equal(tryExpand(group, edges, 'src', NONE, 'nope').kind, 'ignored')
  const utils = new Set(['src/utils'])
  assert.equal(tryExpand(group, edges, 'src', utils, 'src/utils').kind, 'ignored')
  assert.equal(
    expandIds(group, edges, 'src', NONE, ['nope']).ids,
    NONE,
    '一个都没展开时集合引用不变'
  )
}

// 收起文件夹连带收掉内部的展开
{
  const expanded = new Set(['src', 'src/utils', 'assets'])
  assert.deepEqual([...collapseSubtree(group, expanded, 'src')], ['assets'])
}

// 树更新后超限:从最新展开的开始收回
{
  const growTree = dir('', [
    dir('a', [file('a/1.ts'), file('a/2.ts')]),
    dir(
      'b',
      Array.from({ length: 8 }, (_, i) => file(`b/${i}.ts`))
    )
  ])
  const grow = folderTree(growTree)
  const both = new Set(['a', 'b'])
  const rejected = buildVisibleGraph(grow, [], '', both, 6)
  assert.ok(rejected && isVisibleGraphRejection(rejected), '8 个子项的 b 与 a 同层叠加后超限')
  assert.equal(rejected && isVisibleGraphRejection(rejected) ? rejected.reason : null, 'folder')
  const trimmed = trimExpansion(grow, [], '', both, 6)
  assert.deepEqual([...trimmed.ids], ['a'], '先收回最新的 b')
  assert.equal(trimmed.rejected, 'folder')
  const fit = buildVisibleGraph(grow, [], '', trimmed.ids, 6)
  assert.ok(fit && !isVisibleGraphRejection(fit), '收回后重新放得下')
  const one = new Set(['a'])
  const untouched = trimExpansion(grow, [], '', one, 6)
  assert.equal(untouched.ids, one, '没超限时原样返回')
  assert.equal(untouched.rejected, null)
}

// lazy 目录先扫描:失败不展开,成功才加入;非 lazy 直接展开
{
  const calls: string[] = []
  const failing = async (relPath: string): Promise<ScanDirNode | null> => {
    calls.push(relPath)
    return null
  }
  const failed = await expandFolder(group, edges, 'src', NONE, 'src/vendorish', failing)
  assert.equal(failed.kind, 'scanFailed')
  assert.deepEqual(calls, ['src/vendorish'], '未扫描目录会触发扫描')

  const scanned = async (relPath: string): Promise<ScanDirNode | null> => {
    calls.push(relPath)
    return dir(relPath, [])
  }
  const opened = await expandFolder(group, edges, 'src', NONE, 'src/vendorish', scanned)
  assert.equal(opened.kind, 'expanded')
  assert.deepEqual([...(opened.kind === 'expanded' ? opened.ids : NONE)], ['src/vendorish'])

  const never = async (): Promise<ScanDirNode | null> => {
    throw new Error('已扫描目录不该再扫描')
  }
  const direct = await expandFolder(group, edges, 'src', NONE, 'src/utils', never)
  assert.equal(direct.kind, 'expanded')
}

console.log('selftest-expansion: 全部通过')
