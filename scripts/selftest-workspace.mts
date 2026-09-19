import assert from 'node:assert/strict'
import { createRequestScope } from '../src/renderer/src/requestScope.ts'
import { guideEntries, isTreePartial } from '../src/shared/scanCoverage.ts'
import type { ScanDirNode, ScanFileNode, ScanTreeNode } from '../src/shared/types.ts'

{
  const scope = createRequestScope()
  const isCurrent = scope.begin('scan')
  assert.equal(isCurrent(), true)
}

{
  const scope = createRequestScope()
  const oldTicket = scope.begin('scan')
  const newTicket = scope.begin('scan')
  assert.equal(oldTicket(), false)
  assert.equal(newTicket(), true)
}

{
  const scope = createRequestScope()
  const scanTicket = scope.begin('scan')
  const graphTicket = scope.begin('graph')
  scope.begin('scan')
  assert.equal(scanTicket(), false)
  assert.equal(graphTicket(), true)
}

{
  const scope = createRequestScope()
  const a = scope.begin('scan')
  const b = scope.begin('graph')
  const c = scope.begin('expand')
  scope.reset()
  assert.equal(a(), false)
  assert.equal(b(), false)
  assert.equal(c(), false)
}

{
  const scope = createRequestScope()
  const oldTicket = scope.begin('scan')
  scope.reset()
  const newTicket = scope.begin('scan')
  assert.equal(newTicket(), true)
  assert.equal(oldTicket(), false)
}

{
  const scope = createRequestScope()
  let committed: string | null = null
  let loading = false
  let releaseOld!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseOld = resolve
  })
  const run = async (tag: string, wait: Promise<void> | null): Promise<void> => {
    const isCurrent = scope.begin('scan')
    loading = true
    try {
      if (wait) await wait
      if (!isCurrent()) return
      committed = tag
    } finally {
      if (isCurrent()) loading = false
    }
  }
  const oldRun = run('旧项目', gate)
  const newRun = run('新项目', null)
  await newRun
  assert.equal(committed, '新项目')
  assert.equal(loading, false)
  loading = true
  releaseOld()
  await oldRun
  assert.equal(committed, '新项目')
  assert.equal(loading, true)
}

function file(name: string, relPath: string): ScanFileNode {
  return { type: 'file', name, relPath, ext: '' }
}

function dir(name: string, relPath: string, children: ScanTreeNode[], extra: Partial<ScanDirNode> = {}): ScanDirNode {
  return { type: 'directory', name, relPath, children, ...extra }
}

{
  assert.equal(isTreePartial(dir('root', '', [])), false)
  assert.equal(isTreePartial(file('a.ts', 'a.ts')), false)
}

{
  const tree = dir('root', '', [dir('src', 'src', [], { lazy: true })])
  assert.equal(isTreePartial(tree), true)
}

{
  assert.equal(isTreePartial(dir('root', '', [], { truncated: true })), true)
}

{
  const tree = dir('root', '', [dir('a', 'a', [dir('b', 'a/b', [file('x.ts', 'a/b/x.ts')], { truncated: true })])])
  assert.equal(isTreePartial(tree), true)
}

{
  const tree = dir('root', '', [
    dir('src', 'src', [file('main.ts', 'src/main.ts')]),
    file('README.md', 'README.md')
  ])
  assert.equal(isTreePartial(tree), false)
}

{
  const children: ScanTreeNode[] = [
    file('b.ts', 'b.ts'),
    dir('z-dir', 'z-dir', []),
    file('a.ts', 'a.ts'),
    dir('a-dir', 'a-dir', [])
  ]
  const tree = dir('root', '', children)
  const sorted = guideEntries(tree)
  assert.deepEqual(
    sorted.map((n) => n.name),
    ['a-dir', 'z-dir', 'a.ts', 'b.ts']
  )
  assert.deepEqual(
    children.map((n) => n.name),
    ['b.ts', 'z-dir', 'a.ts', 'a-dir'],
    '原数组不许被排序动过'
  )
  assert.deepEqual(
    sorted.map((n) => n.relPath),
    ['a-dir', 'z-dir', 'a.ts', 'b.ts'],
    '排序只换顺序,relPath 原样'
  )
}

console.log('工作区请求生命周期自测全部通过')
