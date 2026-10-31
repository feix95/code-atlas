import assert from 'node:assert/strict'
import { folderTree } from '../src/shared/hierarchy.ts'
import { buildVisibleGraph } from '../src/shared/visibleGraph.ts'
import {
  collapseSubtree,
  expandCandidates,
  expandFolder,
  expandIds,
  tryExpand
} from '../src/shared/expansion.ts'
import type { DepEdge, ScanDirNode, ScanFileNode, ScanTreeNode } from '../src/shared/types.ts'

// 展开状态的纯逻辑自测:候选挑选、加入展开、批量展开、级联收起、lazy 目录先扫描。
// 原地展开不再按上限拒绝,放不下时由可见图给出结构摘要(见 selftest-graphview)。

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
  assert.ok(base)
  assert.deepEqual(expandCandidates(base.nodes, NONE, 2), ['src/utils', 'src/shared'])
  const utils = new Set(['src/utils'])
  const expanded = level(utils, 'src')
  assert.ok(expanded)
  assert.deepEqual(
    expandCandidates(expanded.nodes, utils, 2),
    ['src/shared'],
    '已展开的容器不再入选'
  )
  assert.deepEqual(expandCandidates(base.nodes, NONE, 1), [], '深度不到时不自动展开')
}

// 单个文件夹展开:合法文件夹一律加入,不再按可见图上限拒绝
{
  const expanded = tryExpand(group, NONE, 'src/utils')
  assert.equal(expanded.kind, 'expanded')
  assert.deepEqual([...(expanded.kind === 'expanded' ? expanded.ids : NONE)], ['src/utils'])
  assert.equal(tryExpand(group, NONE, 'src/main.ts').kind, 'ignored', '文件不能展开')
  assert.equal(tryExpand(group, NONE, 'nope').kind, 'ignored', '不存在的 id 不能展开')
  assert.equal(
    tryExpand(group, new Set(['src/utils']), 'src/utils').kind,
    'ignored',
    '已展开的重复项不动作'
  )
}

// 大文件夹也照常展开:超出预览额度的子项由可见图收进「其余 N 项」
{
  const bigTree = dir('', [
    dir(
      'big',
      Array.from({ length: 200 }, (_, i) => file(`big/${i}.ts`))
    )
  ])
  const big = folderTree(bigTree)
  const outcome = tryExpand(big, NONE, 'big')
  assert.equal(outcome.kind, 'expanded')
  const graph = buildVisibleGraph(big, [], '', outcome.kind === 'expanded' ? outcome.ids : NONE)
  assert.ok(graph)
  const rest = graph.nodes.find((n) => n.kind === 'overflow')
  assert.ok(rest, '超出预览额度的子项收进「其余 N 项」')
  assert.equal(rest.groupId, 'big')
  assert.equal(rest.hiddenCount, 50)
}

// 批量展开:合法文件夹全部加入,整页统一粒度,不做逐个上限试算
{
  const ids = expandIds(group, NONE, ['src/utils', 'src/shared', 'src/main.ts', 'nope'])
  assert.deepEqual([...ids], ['src/utils', 'src/shared'], '只加入合法文件夹,保持传入顺序')
  assert.equal(expandIds(group, ids, ['src/shared']), ids, '没有新增时原样返回同一个集合')
}

// 收起文件夹连带收掉内部的展开
{
  const expanded = new Set(['src', 'src/utils', 'assets'])
  assert.deepEqual([...collapseSubtree(group, expanded, 'src')], ['assets'])
}

// lazy 目录先扫描:失败不展开,成功才加入;非 lazy 直接展开
{
  const calls: string[] = []
  const failing = async (relPath: string): Promise<ScanDirNode | null> => {
    calls.push(relPath)
    return null
  }
  const failed = await expandFolder(group, NONE, 'src/vendorish', failing)
  assert.equal(failed.kind, 'scanFailed')
  assert.deepEqual(calls, ['src/vendorish'], '未扫描目录会触发扫描')

  const scanned = async (relPath: string): Promise<ScanDirNode | null> => {
    calls.push(relPath)
    return dir(relPath, [])
  }
  const opened = await expandFolder(group, NONE, 'src/vendorish', scanned)
  assert.equal(opened.kind, 'expanded')
  assert.deepEqual([...(opened.kind === 'expanded' ? opened.ids : NONE)], ['src/vendorish'])

  const never = async (): Promise<ScanDirNode | null> => {
    throw new Error('已扫描目录不该再扫描')
  }
  const direct = await expandFolder(group, NONE, 'src/utils', never)
  assert.equal(direct.kind, 'expanded')
}

console.log('selftest-expansion: 全部通过')
