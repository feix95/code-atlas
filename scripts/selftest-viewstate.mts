// 预览显示开关自测:全局偏好(排版显示 × 只读) → 文件读数的换算;账在 codePrefs(localStorage)
import assert from 'node:assert/strict'

// codePrefs 模块装载时就要读 localStorage:node 里没有,先垫个内存假档再动态 import。
// storage 跨 realm 同步是浏览器 API(node 无 window,监听器不挂),不在这层测。
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>)['localStorage'] = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear()
}
const { viewFlags, applyViewFlags } = await import('../src/renderer/src/viewState.ts')
const { getPreviewReadOnly, getPreviewRender } = await import('../src/renderer/src/codePrefs.ts')

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

/** 归零:每个用例跑完把两颗开关复位回默认,用例间不串账 */
function reset(): void {
  applyViewFlags({ render: true, readOnly: false })
}

check('默认读数:md = 排版开 + 可编辑;代码文件没有排版这一维', () => {
  reset()
  assert.deepEqual(viewFlags('a.md'), { canRender: true, render: true, readOnly: false })
  assert.deepEqual(viewFlags('src/a.ts'), { canRender: false, render: false, readOnly: false })
})

check('只读是全局一档:拨一次,md 与代码文件读数一起翻', () => {
  reset()
  applyViewFlags({ readOnly: true })
  assert.equal(getPreviewReadOnly(), true)
  assert.deepEqual(viewFlags('a.md'), { canRender: true, render: true, readOnly: true })
  assert.deepEqual(viewFlags('src/a.ts'), { canRender: false, render: false, readOnly: true })
  applyViewFlags({ readOnly: false })
  assert.equal(viewFlags('a.md').readOnly, false)
  assert.equal(viewFlags('src/a.ts').readOnly, false)
})

check('排版显示是全局一档:只翻 md 的读数,代码文件永远 render=false', () => {
  reset()
  applyViewFlags({ render: false })
  assert.equal(getPreviewRender(), false)
  assert.equal(viewFlags('a.md').render, false)
  assert.equal(viewFlags('src/a.ts').render, false)
  applyViewFlags({ render: true })
  assert.equal(viewFlags('a.md').render, true)
  assert.equal(viewFlags('src/a.ts').render, false, '排版偏好开了也轮不到代码文件')
})

check('两颗开关互不牵连:单拨一颗,另一颗保持原样', () => {
  reset()
  applyViewFlags({ readOnly: true })
  applyViewFlags({ render: false })
  assert.deepEqual(viewFlags('a.md'), { canRender: true, render: false, readOnly: true })
  applyViewFlags({ render: true })
  assert.deepEqual(viewFlags('a.md'), { canRender: true, render: true, readOnly: true })
  applyViewFlags({ readOnly: false })
  assert.deepEqual(viewFlags('a.md'), { canRender: true, render: true, readOnly: false })
})

check('md 的四档组合:排版×只读四种值各就各位(原三档语义的完整展开)', () => {
  reset()
  const cases = [
    { render: true, readOnly: false }, // live 实时预览
    { render: true, readOnly: true }, // reading 阅读
    { render: false, readOnly: false }, // source 源码
    { render: false, readOnly: true } // source + 只读(纯文本只读)
  ]
  for (const c of cases) {
    applyViewFlags(c)
    assert.deepEqual(
      viewFlags('a.md'),
      { canRender: true, render: c.render, readOnly: c.readOnly },
      `排版${c.render}/只读${c.readOnly}`
    )
  }
})

check('拨开关落到 localStorage(on/off 裸串),重开进程照这份账', () => {
  reset()
  applyViewFlags({ readOnly: true })
  assert.equal(store.get('atlas.previewReadOnly'), 'on')
  applyViewFlags({ render: false })
  assert.equal(store.get('atlas.previewRender'), 'off')
  reset()
  assert.equal(store.get('atlas.previewReadOnly'), 'off')
  assert.equal(store.get('atlas.previewRender'), 'on')
})

check('无后缀与目录名带点的路径不算 md', () => {
  reset()
  assert.equal(viewFlags('docs.md/readme').canRender, false)
  assert.equal(viewFlags('README').canRender, false)
})

reset()
