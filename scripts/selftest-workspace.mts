import assert from 'node:assert/strict'
import { createRequestScope } from '../src/renderer/src/requestScope.ts'

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

console.log('工作区请求生命周期自测全部通过')
