import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
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
const state = globalThis.__journey = { configured:false, mode:'success', calls:{}, partial:false, holdGit:false, holdGraph:false, releases:[], uiframeExportDir:null }
const { dialog } = require('electron')
const originalOpenDialog = dialog.showOpenDialog.bind(dialog)
dialog.showOpenDialog = async (...a) => state.uiframeExportDir ? { canceled:false, filePaths:[state.uiframeExportDir] } : originalOpenDialog(...a)
// 立项单存盘替身:save 对话框固定回 .planning/journey 下的路径
dialog.showSaveDialog = async () => state.quizSavePath ? { canceled:false, filePath:state.quizSavePath } : { canceled:true }
const originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
  state.calls[channel] = (state.calls[channel] || 0) + 1
  if (channel === 'atlas:ai-config-get' && state.configured) return {
    provider:'lmstudio', builtin:{serverPath:'',modelPath:''},
    lmstudio:{baseUrl:'http://127.0.0.1:1/v1',model:'test-only',apiKey:''},
    cloud:{vendor:'deepseek',baseUrl:'https://api.deepseek.com',model:'',apiKey:'',contextSize:131072,consented:false}, webLookup:false
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
    const leaf =
      folder
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? ''
    await page.getByRole('textbox', { name: '文件夹路径', exact: true }).fill(folder)
    await page.getByRole('textbox', { name: '文件夹路径', exact: true }).press('Enter')
    // 页签改版:开工作区不再自动开签。地址栏落到新路径 = 扫描已起跑(旧工作区同帧卸载),
    // 此后 main.workspace 只会在扫完才回来 —— 两个等待排队用,别指望第一个等扫描
    await page.waitForFunction((expected) => {
      const el = document.querySelector('input[aria-label="文件夹路径"]')
      return el instanceof HTMLInputElement && el.value.endsWith(expected)
    }, leaf)
    await page.locator('main.workspace').waitFor()
    // 概览签是手动开的单例(rail 钮在扫描期间禁用,click 自动等到能点)
    await page.getByRole('button', { name: '概览', exact: true }).click()
    await page.getByRole('heading', { name: '项目导览', exact: true }).waitFor()
  }
  // 欢迎主页已退役:没开工作区的起始态 = 空签板(大 logo +「还没有打开的页签」)
  const home = () => page.getByText('还没有打开的页签', { exact: true }).waitFor()
  const overview = async () => {
    // 回项目导览 = 树根行清选中(概览签的零状态就是导览页)+ rail 开/聚焦概览签
    await page.locator('.tree > .tree-branch > .tree-row.is-dir > .tree-main').click()
    await page.getByRole('button', { name: '概览', exact: true }).click()
    await page.getByRole('heading', { name: '项目导览', exact: true }).waitFor()
  }
  const selectMain = async () => {
    await overview()
    await page.locator('.guide-child').filter({ hasText: 'main.ts' }).click()
    // 点文件 = 开/激活它的文件签;概览签的选中已换成 main.ts —— 切回概览签看文件概览
    await page.locator('.tabbar-tab').filter({ hasText: '概览' }).locator('.tabbar-name').click()
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
  // 界面缩放键盘档(网页惯例,文档缩放改版):Ctrl+= 放大一档(105%),Ctrl+0 归 100%;
  // 落盘走 setUiScale 原路。Ctrl+滚轮的户口已让给文档字号(docZoom),预览处实测见后文。
  await page.keyboard.down('Control')
  await page.keyboard.press('=')
  await page.keyboard.up('Control')
  const zoomedPx = await page.evaluate(() => parseFloat(document.documentElement.style.fontSize))
  assert.ok(zoomedPx > 16, 'ctrl+= must raise root font size')
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
  // 名字走 textContent(innerText 认渲染态,懒加载刷新途中会读成空串)
  const peekName = ((await anyFile.locator('.tree-name').textContent()) ?? '').trim()
  assert.notEqual(peekName, '', 'browse file row must carry a name')
  await anyFile.click()
  // 页签改版:瞄签脸 = 文件名(品类名牌退役)——按文件名认签
  const peekTab = page
    .locator('.tabbar-tab')
    .filter({ has: page.locator('.tabbar-name').getByText(peekName, { exact: true }) })
  await peekTab.waitFor()
  assert.equal(await peekTab.count(), 1, 'browse file must open a peek preview tab')
  // 文档缩放(文档字号这锤):Ctrl+滚轮落在预览正文上 = 字号比例缩放,根字号不许动;
  // 量 .code-text 的 computed font-size —— --doc-zoom 乘进去的就是它,真账不量 CSS 变量
  const codeView = page.locator('.code-view').first()
  const codeText = codeView.locator('.code-text').first()
  // attached 而非 visible:空文件的 <pre> 零尺寸不可见,但 font-size 照样量得出
  await codeText.waitFor({ state: 'attached' })
  const docFontBefore = await codeText.evaluate(
    (el) => parseFloat(getComputedStyle(el).fontSize) || 0
  )
  const viewBox = await codeView.boundingBox()
  assert.ok(viewBox, 'preview body must have a box')
  await page.mouse.move(viewBox.x + viewBox.width / 2, viewBox.y + viewBox.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -240)
  await page.keyboard.up('Control')
  const docFontAfter = await codeText.evaluate(
    (el) => parseFloat(getComputedStyle(el).fontSize) || 0
  )
  assert.ok(docFontAfter > docFontBefore, 'ctrl+wheel on preview must enlarge doc font')
  assert.equal(
    await page.evaluate(() => parseFloat(document.documentElement.style.fontSize)),
    16,
    'doc zoom must not touch the root font size'
  )
  // 归位:滚回去把 docZoom 退回 1,别把放大带进后续断言 —— 字号回到原值才算账平
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 240)
  await page.keyboard.up('Control')
  await page.waitForFunction((target) => {
    const el = document.querySelector('.code-view .code-text')
    return el !== null && Math.abs(parseFloat(getComputedStyle(el).fontSize) - target) < 0.01
  }, docFontBefore)
  await shot('browse-peek')
  await page.getByRole('button', { name: `关闭 ${peekName}`, exact: true }).click()
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
  // 第二步:导航搬进侧栏(.cfg-snav-item),点击 = 切到对应页(一项一页)
  await page.locator('.cfg-snav-item').filter({ hasText: 'AI 设置' }).click()
  await page.locator('.cfg-snav-item.is-active').filter({ hasText: 'AI 设置' }).waitFor()
  await page.locator('#cfg-model-path').waitFor()
  await shot('settings-page')
  await page.getByRole('button', { name: '关闭 设置', exact: true }).click()
  await page.locator('.cfg-page').waitFor({ state: 'hidden' })
  await page.locator('.tabbar-tab').waitFor({ state: 'detached' })
  // UI v3(B8)续:双击盘根 = 开为工作区(§7.1)——挪到设置测试后跑:
  // 页签改版后开工作区栏仍是空的(签只在点文件/单例入口时开)
  await firstDrive.dblclick()
  await page.locator('main.workspace').waitFor()
  // 页签改版(钉住退役):开工作区栏是空的 —— 签只在点文件/点单例入口时才长出来
  assert.equal(
    await page.locator('.tabbar-tab').count(),
    0,
    'opening a workspace must not spawn any tab'
  )
  assert.ok(
    /^[A-Z]:\\?$/.test(
      await page.getByRole('textbox', { name: '文件夹路径', exact: true }).inputValue()
    ),
    'double-clicked drive must become the workspace root'
  )
  await control({ holdGit: true })
  await open(project)
  // 页签改版(小葵拍板):树里点文件 = 开绑死它的文件签 —— 一文件一张,
  // 重开同一文件只激活不生第二张;点文件夹只选中不开签;已有页签一概不动
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'README.md' }).click()
  await page
    .locator('.tabbar-tab')
    .filter({ has: page.locator('.tabbar-name').getByText('README.md', { exact: true }) })
    .waitFor()
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'package.json' }).click()
  await page
    .locator('.tabbar-tab')
    .filter({ has: page.locator('.tabbar-name').getByText('package.json', { exact: true }) })
    .waitFor()
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'README.md' }).click()
  assert.equal(
    await page.locator('.tabbar-tab').count(),
    3,
    're-clicking an open file must not spawn a duplicate tab'
  )
  assert.equal(
    await page
      .locator('.tabbar-tab.is-active')
      .filter({ has: page.locator('.tabbar-name').getByText('README.md', { exact: true }) })
      .count(),
    1,
    're-clicked file must activate its existing tab'
  )
  await page.locator('.tree-row.is-dir .tree-main').filter({ hasText: 'src' }).first().click()
  assert.equal(
    await page.locator('.tabbar-tab').count(),
    3,
    'clicking a folder must not open a tab'
  )
  // 页签撕窗(M1):右键「移到新窗口」= 签撕去同进程子窗 —— 子窗带自绘标题栏和
  // 自己的页签带,主窗名下签数减一;关子窗连签销户(Chrome 语义),窗数回原
  const tearTab = page
    .locator('.tabbar-tab')
    .filter({ has: page.locator('.tabbar-name').getByText('package.json', { exact: true }) })
  await tearTab.click({ button: 'right' })
  const [auxPage] = await Promise.all([
    electron.waitForEvent('window', { timeout: 8_000 }),
    page.getByRole('menuitem', { name: '移到新窗口', exact: true }).click()
  ])
  assert.equal(electron.windows().length, 2, 'tearing a tab must open an aux window')
  // 页签带兼标题栏(浏览器同款):带里有签,带尾钉着窗控三键(主窗同款 win-ctl)
  await auxPage.locator('.aux-strip .win-ctl').waitFor()
  await auxPage
    .locator('.tabbar-tab')
    .filter({ has: auxPage.locator('.tabbar-name').getByText('package.json', { exact: true }) })
    .waitFor()
  assert.equal(await page.locator('.tabbar-tab').count(), 2, 'torn tab must leave the main strip')
  // realm 探针:子窗里点一张签要能激活 —— React 合成事件必须够得着外文书(forein document)
  // 里渲染的 Portal 子树;这条断了,子窗里所有交互都是死的
  await auxPage.locator('.tabbar-tab').first().click()
  await auxPage.locator('.tabbar-tab.is-active').waitFor({ timeout: 5_000 })
  // 关子窗(标题栏 × 经主 realm 代发 IPC):连签销户,窗数回原。
  // close 事件要先挂上再点 —— 窗关得快,点后挂监听会扑空
  await Promise.all([
    auxPage.waitForEvent('close', { timeout: 8_000 }),
    auxPage.locator('.win-btn.win-close').click()
  ])
  assert.equal(electron.windows().length, 1, 'closing aux window must leave only the main window')
  assert.equal(
    await page.locator('.tabbar-tab').count(),
    2,
    'closed aux window must take its tabs with it'
  )
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
  const bubble = page.locator('.tip-bubble')
  // hover 的 scrollIntoView 可能在 mouseover 之后才补发 scroll 事件,把 1s 慢档计时器收掉;
  // 真机使用不受影响——重悬一次即可,重试三次兜底这类事件时序抖动
  for (let attempt = 0; attempt < 3 && (await bubble.count()) === 0; attempt++) {
    await page.mouse.move(12, 320)
    await tipRow.hover()
    await bubble.waitFor({ timeout: 4_000 }).catch(() => {})
  }
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
  // md 系文件签默认阅读档:渲染容器是 .code-reading,不是源码档的 .code-text
  await page.locator('.code-reading').filter({ hasText: 'Getting started' }).waitFor()
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
    .locator('.code-reading')
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
  await overview()
  await page.getByRole('button', { name: /读项目说明/ }).click()
  await page
    .locator('.code-reading')
    .filter({ hasText: 'This application helps organize tasks.' })
    .waitFor()
  await selectMain()
  await page.waitForTimeout(800)
  assert.equal(await calls('atlas:ai-explain-file'), 0, 'Browsing must not start AI predictions')
  await shot('file-unconfigured')
  await page.locator('.ai-card').getByRole('button', { name: '设置 AI', exact: true }).click()
  // UI v3(B6):「设置 AI」直达开设置页签并切到「AI 设置」页(不是弹窗了)
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
  // UI 框架(规格见 docs/to-do list《UI框架-需求规格》):rail 开单例签 → 侧栏换脸零件盒 →
  // 底板渲染 → 拖高度手柄(+8 逻辑像素磁吸到 --control-lg)→ 撤销复原 → 导出给 AI(对话框替身)→ 文件、字体、截图齐全
  await page.getByRole('button', { name: 'UI 框架', exact: true }).click()
  // 工作台改造:侧栏换脸成零件盒,文件树藏起(保活不卸载)
  await page.locator('.sidebar .uf-parts').waitFor()
  await page.locator('.sidebar .cfg-snav-title').filter({ hasText: '工作台' }).waitFor()
  assert.equal(
    await page.locator('.sidebar .sidebar-mid:not([hidden])').count(),
    0,
    'uiframe tab must hide the file tree'
  )
  // M1-c 起步页(§5.2):选平台 → 模板按平台过滤 → 空白起步 / 我的方案 / 导入(未上线禁用)
  await page.getByRole('group', { name: '目标平台' }).waitFor()
  await page.getByRole('button', { name: '极简工作台', exact: true }).waitFor()
  await page.getByRole('button', { name: '现代仪表盘', exact: true }).waitFor()
  await page.getByRole('button', { name: '手机端', exact: true }).click()
  await page.getByRole('button', { name: '色调圆角', exact: true }).waitFor()
  await page.getByRole('button', { name: '留白清透', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: '现代仪表盘', exact: true }).count(),
    0,
    'desktop templates must not show under phone platform'
  )
  await page.getByRole('button', { name: '电脑端', exact: true }).click()
  // 导入(M1-d):入口卡 → 浮层三条来源 + 粘贴框
  await page.getByRole('button', { name: '导入方案' }).click()
  const importDialog = page.getByRole('dialog', { name: '导入方案' })
  await importDialog.waitFor()
  await importDialog.getByRole('button', { name: '方案文件夹' }).waitFor()
  await importDialog.getByRole('button', { name: /DTCG/ }).waitFor()
  await page.keyboard.press('Escape')
  await importDialog.waitFor({ state: 'hidden' })
  await page.getByText('还没有保存过的方案', { exact: false }).waitFor()
  await shot('uiframe-start')
  // M2 立项问卷(§3):入口卡 → 向导 → A1 条件显隐(A2/A3 随手机选项出现)→
  // 「让 AI 建议」→ 七组走到底 → 完成页复制立项单
  await page.getByRole('button', { name: '开始问卷', exact: true }).click()
  const quiz = page.getByRole('dialog', { name: '立项问卷' })
  await quiz.waitFor()
  await quiz.getByRole('checkbox', { name: '电脑桌面应用' }).click()
  await quiz.getByRole('checkbox', { name: '手机 app' }).click()
  // 条件显隐(§3.2):选了手机才有 iOS/Android 题
  await quiz.getByText('手机端系统').waitFor()
  await quiz.getByRole('checkbox', { name: 'iOS' }).click()
  await quiz
    .locator('.qz-q', { hasText: '离线使用' })
    .getByRole('button', { name: '不确定,让 AI 建议' })
    .click()
  for (let i = 0; i < 6; i++) {
    await quiz.getByRole('button', { name: '下一组', exact: true }).click()
  }
  await quiz.getByRole('button', { name: '生成立项单', exact: true }).click()
  await quiz.getByText('立项单生成好了').waitFor()
  await quiz.locator('.qz-brief').getByText('# 立项单', { exact: false }).waitFor()
  await quiz.getByRole('button', { name: '复制立项单' }).click()
  await quiz.getByRole('button', { name: '已复制' }).waitFor()
  // M2-c 出口:存 .md(对话框替身)与技术栈回填;交内置 agent 放最后(会切签)
  const quizSavePath = join(run, '立项单.md')
  await control({ quizSavePath })
  await quiz.getByRole('button', { name: '存成 .md 文件' }).click()
  await quiz.getByText(/已存到:/).waitFor()
  assert.ok(existsSync(quizSavePath), '立项单 .md 应写到替身路径')
  assert.ok(readFileSync(quizSavePath, 'utf8').includes('# 立项单'), '立项单内容落盘')
  await quiz.getByRole('combobox', { name: '技术栈预设' }).selectOption({ label: 'Tauri + Vue' })
  await quiz.getByText('已记:').waitFor()
  await shot('uiframe-quiz')
  // 交给内置 agent:切到自由对话签,立项单作为问句出现在对话里
  await quiz.getByRole('button', { name: '交给内置 agent' }).click()
  await quiz.waitFor({ state: 'hidden' })
  await page.getByText('# 立项单', { exact: false }).first().waitFor()
  // 回到 UI 框架签:草稿已存,重开落完成页;重答一遍做 M2-d 预填验收
  await page.getByRole('tab', { name: /UI 框架/ }).click()
  await page.getByRole('button', { name: /立项单已生成/ }).click()
  await quiz.locator('.qz-brief').waitFor()
  // M2-d 答案预填第二步(§3.6 入口 A):只答 A1 手机 → 走完 → 产品名 → 带着答案调 UI
  await quiz.getByRole('button', { name: '重答一遍' }).click()
  await quiz.getByText('A 组 · 平台与设备').waitFor()
  await quiz.getByRole('checkbox', { name: '手机 app' }).click()
  for (let i = 0; i < 6; i++) {
    await quiz.getByRole('button', { name: '下一组', exact: true }).click()
  }
  await quiz.getByRole('button', { name: '生成立项单', exact: true }).click()
  await quiz.getByText('立项单生成好了').waitFor()
  await quiz.getByRole('textbox', { name: '产品名' }).fill('问卷起步品')
  await quiz.getByRole('button', { name: '带着答案调 UI' }).click()
  await quiz.waitFor({ state: 'hidden' })
  // 预填落点:方案名=产品名、平台=手机端;G1 没答 → 空白起步,底板空态
  await page.locator('.uf-scheme-name').filter({ hasText: '问卷起步品' }).waitFor()
  await page.locator('.uf-chip').filter({ hasText: '未入库' }).waitFor()
  assert.ok(
    (await page.getByRole('combobox', { name: '平台' }).inputValue()) === 'phone',
    '问卷 A1 手机应把平台预填成手机端'
  )
  await page.locator('.uf-bench-empty-title').filter({ hasText: '底板是空的' }).waitFor()
  // 回起步页继续原流程:极简工作台模板
  await page.locator('.uf-scheme-name').click()
  await page
    .getByRole('dialog', { name: '我的方案库' })
    .getByRole('button', { name: '新建方案' })
    .click()
  await page.getByRole('button', { name: '极简工作台', exact: true }).click()
  await page.locator('.uf-scheme-name').filter({ hasText: '极简工作台方案' }).waitFor()
  await page.locator('.uf-chip').filter({ hasText: '未入库' }).waitFor()
  // 默认视图是底板(示例页躺在设备/窗口框里),零件盒点「按钮」跳零件墙对应节
  const canvas = page.frameLocator('iframe.uf-canvas-frame')
  await canvas.locator('header.page-header').waitFor()
  await page.locator('.uf-parts .uf-part-row .uf-part-name', { hasText: /^按钮$/ }).click()
  await page.locator('.uf-seg-btn.is-on').filter({ hasText: '零件墙' }).waitFor()
  await canvas.locator('[data-uf-wall="button"]').waitFor()
  const solidBtn = canvas.locator('button.btn--solid[data-uf-part="btn-md"]').first()
  await solidBtn.waitFor()
  const btnBefore = await solidBtn.boundingBox()
  assert.ok(
    btnBefore && Math.abs(btnBefore.height - 40) < 0.5,
    'default md button must be 2.5rem (40px) tall'
  )
  await solidBtn.click()
  const heightHandle = page.locator('.uf-handle--bottom')
  await heightHandle.waitFor()
  const hb = await heightHandle.boundingBox()
  assert.ok(hb, 'selected button must show the height handle')
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 8, { steps: 6 })
  await page.locator('.uf-drag-badge').filter({ hasText: '--control-lg' }).waitFor()
  await page.mouse.up()
  await page.waitForTimeout(150)
  const btnAfter = await solidBtn.boundingBox()
  assert.ok(
    btnAfter && Math.abs(btnAfter.height - 48) < 0.5,
    'dragging +8px must snap the height to --control-lg (48px)'
  )
  await page.locator('.uf-row-ref').filter({ hasText: '--btn-height-md → --control-lg' }).waitFor()
  await shot('uiframe-drag')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.waitForTimeout(150)
  const btnUndo = await solidBtn.boundingBox()
  assert.ok(btnUndo && Math.abs(btnUndo.height - 40) < 0.5, 'undo must restore the button height')
  // 变量板(§5.5):点色板条目 → 属性面板出取色器 → 改主色后画布读数与组件一起更新 → 撤销复原
  await page.getByRole('button', { name: '变量板', exact: true }).click()
  const swatch = canvas.locator('[data-uf-part="tok:color-primary"]').first()
  await swatch.waitFor()
  await swatch.click()
  const colorPicker = page.locator('.uf-color input[type="color"]').first()
  await colorPicker.waitFor()
  await colorPicker.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(el, '#ff0000')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await canvas
    .locator('[data-uf-part="tok:color-primary"] .vb-val')
    .filter({ hasText: '#ff0000 / #60A5FA' })
    .waitFor()
  await shot('uiframe-board')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await canvas
    .locator('[data-uf-part="tok:color-primary"] .vb-val')
    .filter({ hasText: '#2563EB / #60A5FA' })
    .waitFor()
  await page.getByRole('button', { name: '底板', exact: true }).click()
  await canvas.locator('header.page-header').waitFor()
  await shot('uiframe-page')
  // M1-e 手机画布(§5.4):平台切手机 → 设备外框三件套齐全 → 安全区开关 → 换尺寸预设 → 切回桌面
  await page.locator('select[aria-label="平台"]').selectOption('phone')
  await page.locator('.uf-device').waitFor()
  await page.locator('.uf-statusbar').waitFor()
  await page.locator('.uf-homebar').waitFor()
  await page.locator('.uf-island').waitFor() // 390 档有灵动岛
  assert.equal(await page.locator('.uf-safe-line').count(), 2, '手机画布默认画两条安全区线')
  // 设备内容宽 390 逻辑像素(画布缩放进外层 stage,iframe 本体保持设备宽)
  await page.waitForFunction(() => {
    const el = document.querySelector('iframe.uf-canvas-frame') as HTMLIFrameElement | null
    return el?.clientWidth === 390
  })
  await canvas.locator('.app-screen').waitFor() // 手机示例页结构(底部页签栏在,见 appPage)
  await shot('uiframe-phone')
  // 安全区开关:关掉线消失,开回来
  await page.getByRole('button', { name: '安全区', exact: true }).click()
  await page.locator('.uf-safe-line').first().waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '安全区', exact: true }).click()
  await page.locator('.uf-safe-line').first().waitFor()
  // 换大屏预设 → 设备宽随动
  await page.locator('select[aria-label="设备尺寸"]').selectOption('phone-430')
  await page.waitForFunction(() => {
    const el = document.querySelector('iframe.uf-canvas-frame') as HTMLIFrameElement | null
    return el?.clientWidth === 430
  })
  // 设备外框开关:关掉只剩裸屏(机身件退场,屏幕还在)
  await page.getByRole('button', { name: '外框', exact: true }).click()
  await page.locator('.uf-statusbar').waitFor({ state: 'detached' })
  await page.locator('.uf-device.is-plain').waitFor()
  await page.getByRole('button', { name: '外框', exact: true }).click()
  await page.locator('.uf-statusbar').waitFor()
  // M1-f 规范提醒(§5.7):手机端出现 iOS 44 点击区提醒,点条目跳变量板选中该变量
  await page.getByRole('button', { name: /^检查/ }).click()
  const rulesPanel = page.getByRole('dialog', { name: '平台适配检查' })
  await rulesPanel.waitFor()
  await rulesPanel.locator('.uf-rules-item', { hasText: '最小点击区' }).first().waitFor()
  await rulesPanel.locator('.uf-rules-item', { hasText: '44px' }).first().waitFor()
  await rulesPanel.locator('.uf-rules-target', { hasText: 'control-md' }).first().click()
  await canvas.locator('[data-uf-part="tok:control-md"]').waitFor()
  await shot('uiframe-rules')
  // 切回桌面:设备选项回到桌面档,机身消失,示例页回 home;44px 档提醒同时消失
  await page.locator('select[aria-label="平台"]').selectOption('desktop')
  await page.locator('.uf-device').waitFor({ state: 'detached' })
  await rulesPanel.locator('.uf-rules-item', { hasText: '44px' }).waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '底板', exact: true }).click()
  await canvas.locator('header.page-header').waitFor()
  const exportDir = join(run, 'uiframe')
  await mkdir(exportDir, { recursive: true })
  await control({ uiframeExportDir: exportDir })
  await page.getByRole('button', { name: '导出给 AI', exact: true }).click()
  await page.getByText('规格包已导出').waitFor({ timeout: 90_000 })
  await page.getByText(/交给你的 AI 编程助手/).waitFor()
  await control({ uiframeExportDir: null })
  const exported = (await page.locator('.uf-page .notice code').first().innerText()).trim()
  for (const rel of [
    'README-给AI.md',
    'page-template.html',
    'tokens.css',
    'pages/home.html',
    'fonts/fonts.css',
    'fonts/inter/inter-latin-wght-normal.woff2',
    'preview/home.png',
    'preview/button.png',
    'preview/card.png',
    'adapters/tailwind.theme.css',
    'adapters/uiTheme.ts'
  ]) {
    assert.ok(existsSync(join(exported, rel)), `exported spec package must contain ${rel}`)
  }
  await shot('uiframe-exported')
  // M1-c 方案库(§5.8):保存(起名)→ 重命名 → 复制 → 导出方案文件 → 删除 → 快照回滚
  await page.getByRole('button', { name: '保存方案', exact: true }).click()
  const saveDialog = page.getByRole('dialog', { name: '保存方案' })
  await saveDialog.waitFor()
  await saveDialog.getByRole('textbox', { name: '方案名' }).fill('旅程验证方案')
  await saveDialog.getByRole('button', { name: '保存', exact: true }).click()
  // 保存顺带离屏截缩略图,给它余量;落库后「未入库」收摊
  await page.locator('.uf-chip').waitFor({ state: 'detached', timeout: 30_000 })
  await page.locator('.uf-scheme-name').click()
  const lib = page.getByRole('dialog', { name: '我的方案库' })
  await lib.waitFor()
  const libRows = lib.locator('.uf-lib-row')
  await libRows.first().waitFor()
  assert.equal(await libRows.count(), 1, 'library must list the just-saved scheme')
  await libRows.first().getByRole('button', { name: '重命名', exact: true }).click()
  const renameDialog = page.getByRole('dialog', { name: '重命名方案' })
  await renameDialog.getByRole('textbox', { name: '方案名' }).fill('旅程方案二号')
  await renameDialog.getByRole('button', { name: '确定', exact: true }).click()
  await lib.locator('.uf-lib-name').filter({ hasText: '旅程方案二号' }).waitFor()
  await libRows.first().getByRole('button', { name: '复制', exact: true }).click()
  const copyDialog = page.getByRole('dialog', { name: '复制方案' })
  await copyDialog.getByRole('textbox', { name: '方案名' }).fill('导出验证方案')
  await copyDialog.getByRole('button', { name: '确定', exact: true }).click()
  await libRows.nth(1).waitFor()
  assert.equal(await libRows.count(), 2, 'copy must add a second scheme')
  // 导出方案文件(§15 文件夹):对话框替身在 main 里,落地 manifest + design
  const schemeExportDir = join(run, 'scheme-export')
  await mkdir(schemeExportDir, { recursive: true })
  await control({ uiframeExportDir: schemeExportDir })
  const copyRow = libRows.filter({ hasText: '导出验证方案' })
  await copyRow.getByRole('button', { name: '导出', exact: true }).click()
  const exportedManifest = join(schemeExportDir, '导出验证方案', 'manifest.json')
  for (let i = 0; i < 60 && !existsSync(exportedManifest); i++) await page.waitForTimeout(250)
  await control({ uiframeExportDir: null })
  assert.ok(existsSync(exportedManifest), 'scheme export must write manifest.json')
  assert.ok(
    existsSync(join(schemeExportDir, '导出验证方案', 'design.json')),
    'scheme export must write design.json'
  )
  // 删除复制行:二次确认后回一行
  await copyRow.getByRole('button', { name: '删除', exact: true }).click()
  await copyRow.getByRole('button', { name: '再点一次删除', exact: true }).click()
  await page.waitForFunction((n) => document.querySelectorAll('.uf-lib-row').length === n, 1)
  // 快照:保存时落过一版,回滚它 → 方案名回到保存时刻的名字(快照是那时的存档)
  await libRows.first().getByRole('button', { name: '快照', exact: true }).click()
  const restoreBtn = libRows.first().getByRole('button', { name: '回到这版', exact: true }).first()
  await restoreBtn.waitFor()
  await restoreBtn.click()
  await page.locator('.uf-scheme-name').filter({ hasText: '旅程验证方案' }).waitFor()
  await shot('uiframe-library')
  // M1-d 导入(§14):库面板「新建方案」回起步页 → 导入浮层 → 粘贴 CSS 变量 → 战报 + 变量板读数换值
  await page.locator('.uf-scheme-name').click()
  await page
    .getByRole('dialog', { name: '我的方案库' })
    .getByRole('button', { name: '新建方案', exact: true })
    .click()
  await page.getByRole('group', { name: '目标平台' }).waitFor()
  await page.getByRole('button', { name: '导入方案' }).click()
  const imp = page.getByRole('dialog', { name: '导入方案' })
  await imp.waitFor()
  await imp
    .getByRole('textbox', { name: '粘贴 CSS 变量' })
    .fill(':root{--color-primary:#00ff00;--space-4:1.25rem;--bogus-99:7px;}')
  await imp.getByRole('button', { name: '解析粘贴内容', exact: true }).click()
  // 导入成功 → 自动进画布,战报横幅报数(套用 2 个,跳过 1 个 bogus)
  await page.getByText(/导入完成:套用了 2 个变量/).waitFor()
  await page.getByText(/没对上的 1 个/).waitFor()
  await page.getByRole('button', { name: '变量板', exact: true }).click()
  await canvas
    .locator('[data-uf-part="tok:color-primary"] .vb-val')
    .filter({ hasText: '#00FF00' })
    .waitFor()
  await shot('uiframe-imported')
  // M1-g 适配器剪贴板(§13.5):导出钮旁的 ▾ 菜单里复制 Tailwind / RN 主题,出成功横幅
  await page.getByRole('button', { name: '更多导出方式', exact: true }).click()
  await page.getByRole('menuitem', { name: '复制 Tailwind v4 主题(@theme)' }).click()
  await page.getByText('Tailwind v4 @theme 主题已复制到剪贴板').waitFor()
  // 读回剪贴板核对内容确为 @theme 文件
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(clip.includes('@theme'), '剪贴板里必须是 Tailwind @theme 文件')
  assert.ok(clip.includes('--color-primary:'), '主题文件要含变量定义')
  await page.getByRole('button', { name: '更多导出方式', exact: true }).click()
  await page.getByRole('menuitem', { name: '复制 React Native 主题对象' }).click()
  await page.getByText('React Native 主题对象已复制到剪贴板').waitFor()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  // 工作台改造:零件盒「风格」一键套用——点「现代简洁」整套变量换值(可撤销)
  await page.locator('.uf-parts .uf-part-row', { hasText: '现代简洁' }).click()
  await page.getByText(/已套用「现代简洁」风格/).waitFor()
  await canvas
    .locator('[data-uf-part="tok:color-primary"] .vb-val')
    .filter({ hasText: '#18181B' })
    .waitFor()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await canvas
    .locator('[data-uf-part="tok:color-primary"] .vb-val')
    .filter({ hasText: '#00FF00' })
    .waitFor()
  // M1-h 收口:空白起步路径(§19 M1「从空白到方案包」)——方案库「新建方案」回起步页 →
  // 空白起步 → 底板是真空态(示例页不预载),「填入示例页看看」后才出内容
  await page.getByTitle('打开方案库', { exact: true }).click()
  await page.getByRole('button', { name: '新建方案', exact: true }).click()
  await page.getByRole('button', { name: '空白起步', exact: true }).click()
  await page.locator('.uf-chip').filter({ hasText: '未入库' }).waitFor()
  await page.locator('.uf-bench-empty').waitFor()
  await shot('uiframe-blank')
  await page.getByRole('button', { name: '填入示例页看看', exact: true }).click()
  await page.locator('.uf-bench-empty').waitFor({ state: 'detached' })
  const blankCanvas = page.frameLocator('iframe.uf-canvas-frame')
  await blankCanvas.locator('button.btn--solid').first().waitFor()
  await page.getByRole('button', { name: '零件墙', exact: true }).click()
  await blankCanvas.locator('button.btn--solid[data-uf-part="btn-md"]').first().waitFor()
  await shot('uiframe-blank-wall')
  await page.getByRole('button', { name: '关闭 UI 框架', exact: true }).click()
  // 关签后侧栏换回文件树
  await page.locator('.sidebar .uf-parts').waitFor({ state: 'detached' })
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
