// 页签看片状态自测:旧三档(live/reading/source)与两个独立开关(排版显示 × 只读)的换算
import assert from 'node:assert/strict'
import { applyViewFlags, viewFlags } from '../src/renderer/src/viewState.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('viewFlags:md 缺省 = 排版开 + 可编辑(实时预览);代码文件没有排版这一维', () => {
  assert.deepEqual(viewFlags('a.md', {}), { canRender: true, render: true, readOnly: false })
  assert.deepEqual(viewFlags('src/a.ts', {}), { canRender: false, render: false, readOnly: false })
})

check('旧三档换算:live=排版开可编辑,reading=排版开只读,source=排版关可编辑', () => {
  assert.deepEqual(viewFlags('a.md', { viewMode: 'live' }), {
    canRender: true,
    render: true,
    readOnly: false
  })
  assert.deepEqual(viewFlags('a.md', { viewMode: 'reading' }), {
    canRender: true,
    render: true,
    readOnly: true
  })
  assert.deepEqual(viewFlags('a.md', { viewMode: 'source' }), {
    canRender: true,
    render: false,
    readOnly: false
  })
})

check('新组合:排版关 + 只读 = 纯文本只读,存成 source + readOnly', () => {
  const next = applyViewFlags('a.md', { viewMode: 'source' }, { readOnly: true })
  assert.deepEqual(next, { viewMode: 'source', readOnly: true })
  assert.deepEqual(viewFlags('a.md', next), { canRender: true, render: false, readOnly: true })
})

check('md 四个组合从任意起点都能走到,且落账形态唯一', () => {
  const states = [
    {},
    { viewMode: 'live' },
    { viewMode: 'reading' },
    { viewMode: 'source' }
  ] as const
  for (const from of states) {
    const cases = [
      { render: true, readOnly: false, want: { viewMode: 'live' } },
      { render: true, readOnly: true, want: { viewMode: 'reading' } },
      { render: false, readOnly: false, want: { viewMode: 'source' } },
      { render: false, readOnly: true, want: { viewMode: 'source', readOnly: true } }
    ]
    for (const c of cases) {
      assert.deepEqual(
        applyViewFlags('a.md', from, { render: c.render, readOnly: c.readOnly }),
        c.want,
        `从 ${JSON.stringify(from)} 到 排版${c.render}/只读${c.readOnly}`
      )
    }
  }
})

check('单拨一个开关,另一个保持原样', () => {
  // 阅读(排版开+只读)里关排版:只读保留 → 纯文本只读
  assert.deepEqual(applyViewFlags('a.md', { viewMode: 'reading' }, { render: false }), {
    viewMode: 'source',
    readOnly: true
  })
  // 纯文本只读里开排版:只读保留 → 阅读
  assert.deepEqual(
    applyViewFlags('a.md', { viewMode: 'source', readOnly: true }, { render: true }),
    { viewMode: 'reading' }
  )
  // 阅读里关只读 → 实时预览
  assert.deepEqual(applyViewFlags('a.md', { viewMode: 'reading' }, { readOnly: false }), {
    viewMode: 'live'
  })
  // 实时预览里开只读 → 阅读
  assert.deepEqual(applyViewFlags('a.md', { viewMode: 'live' }, { readOnly: true }), {
    viewMode: 'reading'
  })
})

check('代码文件:只读可开关、落在 readOnly 上;排版请求被忽略,档位永远缺省', () => {
  assert.deepEqual(applyViewFlags('src/a.ts', {}, { readOnly: true }), {
    viewMode: undefined,
    readOnly: true
  })
  assert.deepEqual(applyViewFlags('src/a.ts', { readOnly: true }, { readOnly: false }), {
    viewMode: undefined,
    readOnly: undefined
  })
  assert.deepEqual(applyViewFlags('src/a.ts', {}, { render: true }), {
    viewMode: undefined,
    readOnly: undefined
  })
  assert.equal(viewFlags('src/a.ts', { readOnly: true }).readOnly, true)
})

check('无后缀与目录名带点的路径不算 md', () => {
  assert.equal(viewFlags('docs.md/readme', {}).canRender, false)
  assert.equal(viewFlags('README', {}).canRender, false)
})
