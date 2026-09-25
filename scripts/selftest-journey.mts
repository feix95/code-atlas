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
  await control({ holdGit: true })
  await open(project)
  await shot('guide')
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
  await home()
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
