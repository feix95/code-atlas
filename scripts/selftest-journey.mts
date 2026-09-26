import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = join(root, '.planning', 'journey')
await mkdir(base, { recursive: true })
const run = await mkdtemp(join(base, 'run-'))
for (const name of [
  'profile',
  'session',
  'crashes',
  'tmp',
  'shots',
  'project/src',
  'project/docs',
  'empty',
  'second'
]) {
  await mkdir(join(run, name), { recursive: true })
}
const project = join(run, 'project')
await writeFile(
  join(project, 'README.md'),
  '# Sample project\nThis application helps organize tasks.\n'
)
await writeFile(join(project, 'src/main.ts'), 'export const start = () => 1\n')
await writeFile(join(project, 'docs/guide.md'), '# Getting started\n')
await writeFile(join(project, 'package.json'), '{"name":"sample-project","private":true}')
// 超宽单行文件:预览装上后 min-content 极宽,回归分屏/内容区被顶出视口的 bug
await writeFile(join(project, 'wide.ts'), `export const wide = '${'x'.repeat(2400)}'\n`)
await writeFile(join(run, 'second/README.md'), '# Second project\n')
const main = join(root, 'out/main/index.js')
assert.ok(existsSync(main), 'Run npm run build before test:journey')
const bootstrap = join(run, 'bootstrap.cjs')
await writeFile(
  bootstrap,
  `
const { app, ipcMain, net } = require('electron')
const cp = require('node:child_process')
const path = require('node:path')
for (const [key, folder] of [['userData','profile'],['sessionData','session'],['crashDumps','crashes']]) {
  app.setPath(key, path.join(__dirname, folder))
}
const originalExec = cp.execFile
cp.execFile = function(file, ...args) {
  if (/taskkill(?:\\.exe)?$/i.test(file)) throw new Error('Journey forbids process termination')
  return originalExec.call(this, file, ...args)
}
globalThis.fetch = async () => { throw new Error('Journey forbids network requests') }
net.fetch = globalThis.fetch
const state = globalThis.__journey = { configured:false, mode:'success', calls:{}, partial:false, holdGit:false, holdGraph:false, releases:[] }
const originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
  state.calls[channel] = (state.calls[channel] || 0) + 1
  if (channel === 'atlas:ai-config-get' && state.configured) return {
    provider:'lmstudio', builtin:{serverPath:'',modelPath:''},
    lmstudio:{baseUrl:'http://127.0.0.1:1/v1',model:'test-only',apiKey:''}, webLookup:false
  }
  if (channel === 'atlas:ai-explain-file') {
    if (!state.configured) throw new Error('Unexpected AI request while browsing')
    const mode = state.mode
    if (mode === 'delay') await new Promise(resolve => state.releases.push(resolve))
    return { status:mode === 'error' ? 'error':'supported', text:mode === 'error' ? '测试连接失败，请重试。':'测试回复：这是测试夹具里的 main.ts。',model:'test-only',durationMs:0 }
  }
  if (channel === 'atlas:ai-cancel') return
  if (channel === 'atlas:model-status-get' && state.configured) return { provider:'lmstudio',state:'ready',modelName:'test-only',sizeBytes:null,progress:null }
  if (channel === 'atlas:dep-graph' && state.holdGraph) {
    await new Promise(resolve => state.releases.push(resolve))
    return {rootPath:args[0],nodes:[],edges:[],hubs:[{relPath:'old-project-only.ts',languageId:'typescript',inCount:8,outCount:0}],stats:{analyzed:0,externalCount:0,unresolved:[],skipped:0},durationMs:0}
  }
  const result = await handler(event, ...args)
  if (channel === 'atlas:git-changes' && state.holdGit) await new Promise(resolve => state.releases.push(resolve))
  if (channel === 'atlas:scan-folder' && state.partial) return {...result,tree:{...result.tree,truncated:true}}
  return result
})
require(${JSON.stringify(main)})
`
)
const env = { ...process.env, TEMP: join(run, 'tmp'), TMP: join(run, 'tmp') }
delete env.ELECTRON_RUN_AS_NODE
const electron = await _electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/electron.exe'),
  args: [bootstrap],
  cwd: root,
  env,
  timeout: 30_000
})
try {
  const page = await electron.firstWindow()
  page.setDefaultTimeout(12_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const control = async (patch: Record<string, unknown>) =>
    electron.evaluate((_electron, value) => {
      Object.assign(
        (globalThis as typeof globalThis & { __journey: Record<string, unknown> }).__journey,
        value
      )
    }, patch)
  const release = async () =>
    electron.evaluate(() => {
      const state = (
        globalThis as typeof globalThis & { __journey: { releases: Array<() => void> } }
      ).__journey
      state.releases.splice(0).forEach((fn) => fn())
    })
  const calls = async (channel: string) =>
    electron.evaluate((_electron, name) => {
      return (
        (globalThis as typeof globalThis & { __journey: { calls: Record<string, number> } })
          .__journey.calls[name] ?? 0
      )
    }, channel)
  const shot = (name: string) => page.screenshot({ path: join(run, 'shots', `${name}.png`) })
  const open = async (folder: string) => {
    await page.getByRole('textbox', { name: '文件夹路径', exact: true }).fill(folder)
    await page.getByRole('textbox', { name: '文件夹路径', exact: true }).press('Enter')
    await page.getByRole('heading', { name: '项目导览', exact: true }).waitFor()
  }
  const home = () => page.getByRole('heading', { name: /先看懂项目/ }).waitFor()
  const overview = async () => {
    // UI v3:「项目导览」钮已摘除(规格 §7.0)。回项目导览 = 点树根行 ——
    // 根节点 relPath='',选中它走概览零状态,也就是老导览页
    await page.locator('.tree > .tree-branch > .tree-row.is-dir > .tree-main').click()
    await page.getByRole('heading', { name: '项目导览', exact: true }).waitFor()
  }
  const selectMain = async () => {
    await overview()
    await page.locator('.guide-child').filter({ hasText: 'main.ts' }).click()
    await page.getByRole('button', { name: '查看文件内容', exact: true }).waitFor()
  }
  await home()
  // UI v3(B7):没工作区时顶栏搜索框置灰(深搜要有工作区根)
  assert.ok(
    await page.getByRole('searchbox', { name: '搜索文件', exact: true }).isDisabled(),
    'top-bar search must be disabled without a workspace'
  )
  // UI v3(B4):AI 状态收进 rail 底槽浮层,未配置引导要点开状态钮才现身
  await page.getByRole('button', { name: /AI 状态/ }).click()
  await page.locator('.ai-status-pop').getByText('AI 讲解尚未设置', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.ai-status-pop').waitFor({ state: 'hidden' })
  assert.equal(electron.windows().length, 1, 'Development entry must not open a bubble')
  await shot('home')
  // Ctrl+滚轮缩放(网页惯例):向上滚放大一档(105%),Ctrl+0 归 100%;落盘走 setUiScale 原路。
  // (扫完报数的 .scan-toast 机制已随页签打磨批摘除 —— 断言落在功能本体:根字号真变大)
  await page.mouse.move(800, 500)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -240)
  await page.keyboard.up('Control')
  const zoomedPx = await page.evaluate(() => parseFloat(document.documentElement.style.fontSize))
  assert.ok(zoomedPx > 16, 'ctrl+wheel up must raise root font size')
  await page.keyboard.down('Control')
  await page.keyboard.press('0')
  await page.keyboard.up('Control')
  await page.waitForFunction(() => document.documentElement.style.fontSize === '16px')
  // UI v3(B8):侧栏「这台电脑」可下钻——单击盘符/目录原地展开(懒加载纯浏览),
  // 单击文件开「瞄一眼」预览签(scopeRoot=盘根,不进工作区账本),双击盘根开为工作区
  const firstDrive = page.locator('.tree > .tree-branch > .tree-row.is-dir .tree-main').first()
  await firstDrive.click()
  const winBranch = page
    .locator('.tree > .tree-branch > .tree-branch')
    .filter({ has: page.locator('.tree-name').getByText('Windows', { exact: true }) })
  await winBranch.locator('> .tree-row .tree-main').click()
  const anyFile = winBranch.locator('> .tree-row.is-file .tree-main').first()
  await anyFile.waitFor()
  await anyFile.click()
  await page.locator('.tabbar-tab').filter({ hasText: '预览' }).waitFor()
  assert.equal(
    await page.locator('.tabbar-tab').filter({ hasText: '预览' }).count(),
    1,
    'browse file must open a peek preview tab'
  )
  await shot('browse-peek')
  await page.getByRole('button', { name: '关闭 预览', exact: true }).click()
  await page.locator('.tabbar-tab').waitFor({ state: 'detached' })
  // UI v3(B6):设置退役弹窗改单例页签——首页无工作区也能开;再点入口只聚焦不生第二张;
  // 左目录翻节;页签 × 收掉后孤组清场,首页回前台
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('.cfg-page').waitFor()
  assert.equal(
    await page.locator('.tabbar-tab').filter({ hasText: '设置' }).count(),
    1,
    'settings must open as a singleton tab'
  )
  await page.getByRole('button', { name: '设置', exact: true }).click()
  assert.equal(
    await page.locator('.tabbar-tab').filter({ hasText: '设置' }).count(),
    1,
    'reopening settings must focus the same tab'
  )
  await page.locator('.cfg-nav-item').filter({ hasText: '高级选项' }).click()
  await page.locator('.cfg-nav-item.is-active').filter({ hasText: '高级选项' }).waitFor()
  await page.locator('#cfg-model-path').waitFor()
  await shot('settings-page')
  await page.getByRole('button', { name: '关闭 设置', exact: true }).click()
  await page.locator('.cfg-page').waitFor({ state: 'hidden' })
  await page.locator('.tabbar-tab').waitFor({ state: 'detached' })
  // UI v3(B8)续:双击盘根 = 开为工作区(§7.1)——挪到设置测试后跑:
  // 开了工作区就有跟随签守在页签栏,上面「页签全收光」的断言只在空态下成立
  await firstDrive.dblclick()
  await page.getByRole('heading', { name: '项目导览', exact: true }).waitFor()
  assert.ok(
    /^[A-Z]:\\?$/.test(
      await page.getByRole('textbox', { name: '文件夹路径', exact: true }).inputValue()
    ),
    'double-clicked drive must become the workspace root'
  )
  await control({ holdGit: true })
  await open(project)
  const treeIconStyle = await page.locator('.tree-icon svg').first().getAttribute('style')
  assert.match(treeIconStyle ?? '', /--ic:/, 'file-tree icons must retain their type colors')
  const railIcon = page.locator('.rail-btn svg').first()
  assert.equal(await railIcon.getAttribute('style'), null, 'rail icons must inherit theme color')
  assert.equal(
    await railIcon.getAttribute('class'),
    null,
    'non-tree icons must not use the colored tint class'
  )
  await shot('guide')
  // 悬停轻提示(全场唯一户口):树行小灰字退役 → 摘要挪进 #2c2c2c 圆角气泡,
  // 统一从树区右缘(sash 拖杆线)弹出,不压上下行的字;鼠标一走气泡收摊
  const tipRow = page.locator('.tree:not(.search-results) .tree-main[data-tip]').first()
  // 窗口拉宽保证右侧摆得下:窄窗翻面是正当行为,这里要锁的是「右缘(sash 线)出」
  await page.setViewportSize({ width: 1280, height: 800 })
  await tipRow.hover()
  const bubble = page.locator('.tip-bubble')
  await bubble.waitFor()
  assert.ok((await bubble.textContent())?.trim(), 'tooltip must carry the annotation text')
  assert.equal(await bubble.getAttribute('data-side'), 'right', 'tree tooltip must open right')
  const bubbleBox = await bubble.boundingBox()
  const rowBox = await tipRow.boundingBox()
  assert.ok(bubbleBox && rowBox, 'tooltip and row must have boxes')
  assert.ok(
    Math.abs(bubbleBox.x - (rowBox.x + rowBox.width + 10)) <= 4,
    'tooltip must open right at the tree right edge (sash line)'
  )
  await shot('tree-tip')
  await page.mouse.move(12, 320)
  await bubble.waitFor({ state: 'detached' })
  assert.equal(
    await page.locator('.tree:not(.search-results) .tree-summary').count(),
    0,
    'tree rows must not render gray annotation text'
  )
  // UI v3(B5):workspace 卡 ⇅ 菜单——浮层成行、↓ 键盘高亮、行首 pin 两态、Esc 收摊
  await page.getByRole('button', { name: '展开工作区菜单', exact: true }).click()
  await page.locator('.ws-menu').waitFor()
  const menuRow = page.locator('.ws-menu .wsm-row').first()
  await menuRow.waitFor()
  await page.getByRole('textbox', { name: '文件夹路径', exact: true }).press('ArrowDown')
  await page.locator('.wsm-row.is-active').waitFor()
  await menuRow.hover()
  await menuRow.locator('.wsm-pin').click()
  await page.locator('.wsm-row.is-pinned').waitFor()
  await page.locator('.wsm-row.is-pinned').hover()
  await page.locator('.wsm-row.is-pinned .wsm-pin').click()
  await page.locator('.wsm-row.is-pinned').waitFor({ state: 'detached' })
  await shot('ws-menu')
  await page.keyboard.press('Escape')
  await page.locator('.ws-menu').waitFor({ state: 'hidden' })
  assert.equal(await calls('atlas:ai-explain-file'), 0)
  await release()
  await control({ holdGit: false })
  // UI v3(B7):顶栏深搜——词一进,树区整体换成结果清单;文件命中补探父链后开预览页签;
  // 空账照实说;文件夹命中打开为工作区(地址栏同一条路);清空词文件树原样回来
  const searchBox = page.getByRole('searchbox', { name: '搜索文件', exact: true })
  // 顶栏搜索是默认收起的放大镜:输入框 max-width:0+opacity:0,悬停才展开 —— 先悬停再填
  await page.locator('.tb-search').hover()
  await searchBox.fill('guide')
  await page.locator('.search-results .tree-row').waitFor()
  await shot('search-results')
  await page.locator('.search-results .tree-row').filter({ hasText: 'guide.md' }).click()
  await page.locator('.code-text').filter({ hasText: 'Getting started' }).waitFor()
  await searchBox.fill('绝没有这个词zzz')
  await page
    .locator('.search-results')
    .getByText(/没找到叫/)
    .waitFor()
  await searchBox.fill('src')
  await page.locator('.search-results .tree-row.is-dir').waitFor()
  await page.locator('.search-results .tree-row.is-dir').click()
  await page.getByRole('heading', { name: '项目导览', exact: true }).waitFor()
  assert.ok(
    (await page.getByRole('textbox', { name: '文件夹路径', exact: true }).inputValue()).endsWith(
      'src'
    ),
    'directory hit must open itself as the workspace'
  )
  assert.equal(await searchBox.inputValue(), '', 'search box must clear when the workspace changes')
  await open(project)
  // 关系图谱(drill-down):rail 钮开单例签 → 画布有内容 → 自动跑关系分析 →
  // 键盘进入 src(节点按钮清单)→ 面包屑更新 → Backspace 返回 → 键盘打开文件预览
  const graphCallsBefore = await calls('atlas:dep-graph')
  await page.getByRole('button', { name: '关系图谱', exact: true }).click()
  await page.locator('.graph-canvas[data-graph-dir=""]').waitFor()
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>('.graph-canvas')
    const d = c?.getContext('2d')?.getImageData(0, 0, c.width, c.height).data
    if (!d) return false
    for (let i = 4; i < d.length; i += 4) {
      if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return true
    }
    return false
  })
  await page.waitForFunction(() => !document.querySelector('.graph-status'))
  assert.ok((await calls('atlas:dep-graph')) > graphCallsBefore, 'graph tab must load relations')
  await page.waitForTimeout(1500)
  await shot('graph-root')
  await page.getByRole('button', { name: /^文件夹 src/ }).focus()
  await page.keyboard.press('Enter')
  await page.locator('.graph-canvas[data-graph-dir="src"]').waitFor()
  assert.equal(
    await page.locator('.graph-crumb button[aria-current="location"]').innerText(),
    'src',
    'breadcrumb must show the current folder'
  )
  await page.locator('.graph-view').focus()
  await page.keyboard.press('Backspace')
  await page.locator('.graph-canvas[data-graph-dir=""]').waitFor()
  await page.getByRole('button', { name: /^文件 README\.md/ }).focus()
  await page.keyboard.press('Enter')
  await page
    .locator('.code-text')
    .filter({ hasText: 'This application helps organize tasks.' })
    .waitFor()
  await page.locator('.tabbar-tab').filter({ hasText: '关系图谱' }).locator('.tabbar-name').click()
  const themeBefore = await page.evaluate(() => {
    const prev = document.documentElement.dataset.theme ?? null
    document.documentElement.dataset.theme = 'dark'
    return prev
  })
  await page.waitForTimeout(400)
  await shot('graph-root-dark')
  await page.evaluate((prev) => {
    if (prev === null) delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = prev
  }, themeBefore)
  await page.getByRole('button', { name: '关闭 关系图谱', exact: true }).click()
  await page.locator('.graph-view').waitFor({ state: 'detached' })
  await page.locator('.tabbar-tab').filter({ hasText: '概览' }).locator('.tabbar-name').click()
  await overview()
  await page.getByRole('button', { name: /读项目说明/ }).click()
  await page
    .locator('.code-text')
    .filter({ hasText: 'This application helps organize tasks.' })
    .waitFor()
  await selectMain()
  await page.waitForTimeout(800)
  assert.equal(await calls('atlas:ai-explain-file'), 0, 'Browsing must not start AI predictions')
  await shot('file-unconfigured')
  await page.locator('.ai-card').getByRole('button', { name: '设置 AI', exact: true }).click()
  // UI v3(B6):「设置 AI」直达开设置页签并翻到高级节(不是弹窗了)
  await page.locator('.cfg-page').waitFor()
  await page.locator('#cfg-model-path').waitFor()
  await page.waitForTimeout(200)
  const picker = await page.locator('#cfg-model-path').boundingBox()
  assert.ok(
    picker && picker.y >= 0 && picker.y + picker.height <= (await page.evaluate(() => innerHeight)),
    'AI setup must scroll to model selection'
  )
  await shot('setup')
  await page.getByRole('button', { name: '关闭 设置', exact: true }).click()
  await page.locator('.cfg-page').waitFor({ state: 'hidden' })
  // 关签接力到左邻签(页签模型规矩):点回概览签(点签名不点签心,免得误中尾部的 ×),
  // 文件讲解卡照旧在
  await page.locator('.tabbar-tab').filter({ hasText: '概览' }).locator('.tabbar-name').click()
  await page.getByRole('button', { name: '查看文件内容', exact: true }).click()
  await page.locator('.code-text').filter({ hasText: 'export const start' }).waitFor()
  // 回归:预览带超长单行的文件不得把内容区顶出视口 —— 超宽内容靠 min-content 传染链
  // 顶穿 .workspace/.detail,右组分屏曾被挤出屏幕;.workspace/.content 已补 min-width:0 断链
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'wide.ts' }).dblclick()
  await page.locator('.code-view').waitFor()
  const detailBox = await page.locator('.detail').boundingBox()
  assert.ok(
    detailBox && detailBox.width <= (await page.evaluate(() => innerWidth)),
    'previewing a file with a very long line must not push .detail beyond the viewport'
  )
  await page.getByRole('textbox', { name: '文件夹路径', exact: true }).fill(join(run, 'missing'))
  await page.getByRole('textbox', { name: '文件夹路径', exact: true }).press('Enter')
  await page.getByRole('heading', { name: '这个文件夹没能打开' }).waitFor()
  await shot('error')
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await home()
  await open(join(run, 'empty'))
  await page.locator('.guide-empty').waitFor()
  assert.equal(await page.locator('.guide-start-link').count(), 0)
  await control({ partial: true })
  await open(project)
  await page.locator('.guide-orientation .notice-warn').waitFor()
  assert.equal(await page.locator('.guide-orientation .chip').count(), 0)
  await control({ partial: false, holdGraph: true })
  await page.locator('.guide-more summary').click()
  await page.getByRole('button', { name: /分析文件关系/ }).click()
  await open(join(run, 'second'))
  await release()
  await control({ holdGraph: false, configured: true })
  assert.ok(!(await page.locator('.guide-body').innerText()).includes('old-project-only.ts'))
  await page.reload()
  // 会话复现(Obsidian 式):重开不回首页,还原关门前的工作区+页签 —— 应停在 second 的导览
  await page.getByRole('heading', { name: '项目导览', exact: true }).waitFor()
  assert.ok(
    (await page.getByRole('textbox', { name: '文件夹路径', exact: true }).inputValue()).endsWith(
      'second'
    ),
    'reload must restore the last workspace (session replay)'
  )
  await open(project)
  await selectMain()
  await page.locator('.ai-card').getByRole('button', { name: '解释这个文件', exact: true }).click()
  await page
    .locator('.ai-card')
    .getByText('测试回复：这是测试夹具里的 main.ts。', { exact: true })
    .waitFor()
  await shot('ai-fixture-success')
  await control({ mode: 'error' })
  await selectMain()
  await page.locator('.ai-card').getByRole('button', { name: '解释这个文件', exact: true }).click()
  await page.locator('.ai-card').getByRole('button', { name: '重试', exact: true }).waitFor()
  await page.locator('.ai-card').getByRole('button', { name: 'AI 设置', exact: true }).waitFor()
  await control({ mode: 'delay' })
  await page.locator('.ai-card').getByRole('button', { name: '重试', exact: true }).click()
  await page.getByRole('button', { name: '取消分析', exact: true }).click()
  await page.locator('.ai-card .badge').filter({ hasText: '已取消' }).waitFor()
  await release()
  await page.waitForTimeout(100)
  assert.ok((await calls('atlas:ai-cancel')) > 0)
  assert.match(await page.locator('.ai-card .badge').innerText(), /已取消/)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await shot('file-dark')
  assert.deepEqual(errors, [], 'Renderer must not report errors')
  console.log(
    'Journey passed: real scanning/reading/navigation/setup/recovery, mocked AI success/error/cancel, delayed Git and stale graph.'
  )
  console.log('AI responses are test fixtures; model quality is not verified.')
  console.log(`Local screenshots: ${join(run, 'shots')}`)
} finally {
  await electron.close()
}
