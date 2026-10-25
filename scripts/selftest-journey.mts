import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 测试产物不写仓库: 默认系统临时目录, AI 验收时用 CODE_ATLAS_TMP 指到共享 tmp。
const tempRoot = process.env.CODE_ATLAS_TMP ?? tmpdir()
const base = join(tempRoot, 'code-atlas-journey')
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
// 表格 + hr 是 Live Preview 块级装饰的登记 —— 缺了它们,块装饰禁令的覆盖缺口在 journey 里探不到
await writeFile(
  join(project, 'docs/guide.md'),
  '# Getting started\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n'
)
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
const state = globalThis.__journey = { configured:false, calls:{}, partial:false, holdGraph:false, releases:[] }
const originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
  state.calls[channel] = (state.calls[channel] || 0) + 1
  if (channel === 'atlas:ai-config-get' && state.configured) return {
    provider:'lmstudio', builtin:{serverPath:'',modelPath:''},
    lmstudio:{baseUrl:'http://127.0.0.1:1/v1',model:'test-only',apiKey:''},
    cloud:{vendor:'deepseek',baseUrl:'https://api.deepseek.com',model:'',apiKey:'',contextSize:131072,consented:false}, webLookup:false
  }
  if (channel === 'atlas:model-status-get' && state.configured) return { provider:'lmstudio',state:'ready',modelName:'test-only',sizeBytes:null,progress:null }
  if (channel === 'atlas:dep-graph' && state.holdGraph) {
    await new Promise(resolve => state.releases.push(resolve))
    return {rootPath:args[0],nodes:[],edges:[],hubs:[{relPath:'old-project-only.ts',languageId:'typescript',inCount:8,outCount:0}],stats:{analyzed:0,externalCount:0,unresolved:[],skipped:0},durationMs:0}
  }
  const result = await handler(event, ...args)
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
  /** 截一块区域量「墨迹」宽度:按列看明暗差,有字的列对比高、纯底色列没有(明暗主题通用) */
  const inkWidth = async (clip: { x: number; y: number; width: number; height: number }) => {
    const png = await page.screenshot({ clip })
    return electron.evaluate(({ nativeImage }, data) => {
      const img = nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
      const { width, height } = img.getSize()
      const bmp = img.getBitmap()
      let left = -1
      let right = -1
      for (let x = 0; x < width; x++) {
        let min = 255
        let max = 0
        for (let y = 0; y < height; y++) {
          const i = (y * width + x) * 4
          const lum = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]
          if (lum < min) min = lum
          if (lum > max) max = lum
        }
        if (max - min > 20) {
          if (left < 0) left = x
          right = x
        }
      }
      return right - left + 1
    }, png.toString('base64'))
  }
  const open = async (folder: string) => {
    await page.getByRole('textbox', { name: '文件夹路径', exact: true }).fill(folder)
    await page.getByRole('textbox', { name: '文件夹路径', exact: true }).press('Enter')
    // 页签改版:开工作区不再自动开签,开图也不自动开页签。扫描一开 result 就置空
    // (正文换 ScanOrError),扫完 main.workspace 才回来 —— 这个等待本身即「扫描完成」信号
    await page.locator('main.workspace').waitFor()
  }
  // 欢迎主页已退役:没开工作区的起始态 = 空签板(大 logo +「还没有打开的页签」)
  const home = () => page.getByText('还没有打开的页签', { exact: true }).waitFor()
  await home()
  // UI v3(B7):没工作区时顶栏搜索框置灰(深搜要有工作区根)
  assert.ok(
    await page.getByRole('searchbox', { name: '搜索文件', exact: true }).isDisabled(),
    'top-bar search must be disabled without a workspace'
  )
  // 顶栏搜索框的降级 placeholder 不能被切:type=search 的原生清除钮会在框内占一块地,
  // clientWidth 却把它算进可用宽,量着放得下的文案会被切掉最后一个字(实测窄侧栏切掉约 7px)。
  // 账按墨迹量:placeholder 的墨迹必须跟同字体同文案的 DOM 文本一样长。
  {
    const sidebarBefore = await page.evaluate(() =>
      document.querySelector('.app')?.style.getPropertyValue('--sidebar-w')
    )
    await page.evaluate(() => {
      document.querySelector('.app')?.style.setProperty('--sidebar-w', '17rem')
    })
    // 侧栏宽度会被 App 的后续渲染写回,顶住几轮确认落地
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(150)
      const applied = await page.evaluate(() =>
        document.querySelector('.app')?.style.getPropertyValue('--sidebar-w')
      )
      if (applied === '17rem') break
      await page.evaluate(() => {
        document.querySelector('.app')?.style.setProperty('--sidebar-w', '17rem')
      })
    }
    // 悬停态交给 CDP 强制:真鼠标悬停时,展开动画会把导航组挪到手底下,偶发把悬停抢走,
    // 截图那一下框已经收回,量到的是旁边的按钮(表现为「被切了 100 多像素」的假红)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const doc = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } }
    const found = (await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '.tb-search'
    })) as { nodeId: number }
    await cdp.send('CSS.forcePseudoState', {
      nodeId: found.nodeId,
      forcedPseudoClasses: ['hover']
    })
    await page.waitForTimeout(700)
    const ruler = await page.evaluate(() => {
      const input = document.querySelector('.tb-search input')
      if (!(input instanceof HTMLInputElement)) return null
      const cs = getComputedStyle(input)
      const span = document.createElement('span')
      span.id = 'hint-ruler'
      span.textContent = input.placeholder
      span.style.cssText = `position:fixed;left:420px;top:300px;white-space:pre;color:#000;background:#fff;font:${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily};z-index:9999`
      document.body.appendChild(span)
      const r = input.getBoundingClientRect()
      const sr = span.getBoundingClientRect()
      return {
        placeholder: input.placeholder,
        clientW: input.clientWidth,
        input: { x: r.x, y: r.y, width: r.width, height: r.height },
        span: { x: sr.x, y: sr.y, width: sr.width, height: sr.height }
      }
    })
    assert.ok(ruler, 'search input must exist')
    const inputInk = await inkWidth({
      x: Math.ceil(ruler.input.x),
      y: Math.ceil(ruler.input.y),
      width: Math.floor(ruler.input.width),
      height: Math.ceil(ruler.input.height)
    })
    const rulerInk = await inkWidth({
      x: Math.ceil(ruler.span.x),
      y: Math.ceil(ruler.span.y),
      width: Math.ceil(ruler.span.width) + 8,
      height: Math.ceil(ruler.span.height)
    })
    await page.evaluate(() => document.getElementById('hint-ruler')?.remove())
    await cdp.send('CSS.forcePseudoState', { nodeId: found.nodeId, forcedPseudoClasses: [] })
    await cdp.detach()
    await page.evaluate((v) => {
      document.querySelector('.app')?.style.setProperty('--sidebar-w', v ?? '')
    }, sidebarBefore)
    await shot('search-hint')
    assert.ok(ruler.clientW > 100, `搜索框没展开(clientWidth=${ruler.clientW}),量不到 placeholder`)
    assert.ok(
      rulerInk - inputInk <= 4,
      `placeholder「${ruler.placeholder}」被切掉 ${rulerInk - inputInk} 设备像素(框宽 ${ruler.clientW})`
    )
  }
  // 自由对话不吃工作区:没开项目也能点开聊,只是不带项目上下文;关系图谱仍要项目
  const railNav = page.locator('.rail-btn')
  assert.equal(
    await railNav.nth(0).isDisabled(),
    true,
    'graph must stay disabled without a workspace'
  )
  assert.equal(await railNav.nth(1).isDisabled(), false, 'free chat must open without a workspace')
  await railNav.nth(1).click()
  await page.locator('.free-chat').waitFor()
  await page.locator('.fc-chip').first().waitFor()
  const noProjectChips = (await page.locator('.fc-chip').allTextContents()).join('|')
  assert.equal(
    /项目|文件/.test(noProjectChips),
    false,
    `no-workspace starter chips must not point at a project: ${noProjectChips}`
  )
  assert.equal(
    await page.locator('.chat-input textarea').getAttribute('placeholder'),
    '想问点什么,直接说……',
    'no-workspace composer must not mention the project'
  )
  await shot('chat-no-workspace')
  await page.getByRole('button', { name: '关闭 自由对话' }).click()
  await home()
  // UI v3(B4):AI 状态收进 rail 底槽浮层,未配置引导要点开状态钮才现身
  await page.getByRole('button', { name: /AI 状态/ }).click()
  await page.locator('.ai-status-pop').getByText('AI 讲解尚未设置', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.ai-status-pop').waitFor({ state: 'hidden' })
  assert.equal(electron.windows().length, 1, 'Development entry must not open a bubble')
  await shot('home')
  // 界面缩放键盘档(网页惯例,文档缩放改版):Ctrl+= 放大一档(105%),Ctrl+0 归 100%;
  // 落盘走 setUiScale 原路。Ctrl+滚轮的登记已让给文档字号(docZoom),预览处实测见后文。
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
  // 单击文件开「瞄一眼」预览签(scopeRoot=盘根,不进工作区状态表),双击盘根开为工作区
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
  // 文档缩放:Ctrl+滚轮落在预览正文上 = 字号比例缩放,根字号不许动;
  // 量 .cm-content 的 computed font-size(编辑批次:正文登记搬进了 CodeMirror,旧 .code-text 退役)
  // —— --doc-zoom 乘进去的就是它,真账不量 CSS 变量
  const codeView = page.locator('.code-view').first()
  const codeText = codeView.locator('.cm-content').first()
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
    const el = document.querySelector('.code-view .cm-content')
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
  // 回复风格的两个下拉必须真的改得动:设置页首读存档的 effect 一旦把「每次渲染都新建的
  // 回调」当依赖,就会读配置↔改状态的死循环,选完立刻被旧值顶回去(症状:下拉能点开、切不动)
  const cfgGetsBefore = await calls('atlas:ai-config-get')
  const toneSelect = page.getByLabel('语气', { exact: true })
  const teachingSelect = page.getByLabel('讲解深度', { exact: true })
  await toneSelect.selectOption('humorous')
  await teachingSelect.selectOption('deep')
  await page.waitForTimeout(600)
  assert.equal(await toneSelect.inputValue(), 'humorous', '语气选择必须留得住')
  assert.equal(await teachingSelect.inputValue(), 'deep', '讲解深度选择必须留得住')
  assert.ok(
    (await calls('atlas:ai-config-get')) - cfgGetsBefore < 10,
    '设置页渲染不该反复重读 AI 配置'
  )
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
  await open(project)
  // 高缩放 × 最小侧栏(4K 屏 + 界面缩放):240px 侧栏下限是固定 px,字和间距按 rem 放大,
  // 有工作区时 placeholder 若写死就会差一两个像素切掉末字(实测 110% 缩放切 2px)。
  // 降级链 + tight 腾宽必须兜住;按几何账判,不比墨迹抗锯齿。
  // 同时钉住顶栏布局:搜索框独占左端、向右展开,放大镜不随展开漂移,
  // 三个导航钮贴右且原地不动。
  {
    const uiScaleBefore = await page.evaluate(() => window.atlas.getUiScale())
    await page.evaluate(() => window.atlas.setUiScale(1.1))
    await page.waitForTimeout(300)
    // 侧栏宽度会被 App 的缩放回调写回,顶住几轮确认落到 240px 下限
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
        document.querySelector('.app')?.style.setProperty('--sidebar-w', `${240 / rem}rem`)
      })
      await page.waitForTimeout(120)
      const applied = await page.evaluate(() => {
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
        const want = `${240 / rem}rem`
        return document.querySelector('.app')?.style.getPropertyValue('--sidebar-w') === want
      })
      if (applied) break
    }
    // 顶栏左段宽度带 0.3s 过渡:钉完再等它落定,否则收起/展开两次测量撞在过渡中间,
    // 导航组的绝对位置会差出十几像素(量的不是搜索展开造成的位移)
    await page.waitForTimeout(500)
    /** 顶栏几何:导航组右缘、三个钮的 x、放大镜中心;收起/动画中段/展开各量一次对账 */
    const navGeo = () =>
      page.evaluate(() => {
        const nav = document.querySelector('.tb-nav')
        const side = document.querySelector('.topbar-side')
        const search = document.querySelector('.tb-search')
        const collapse = document.querySelector('.tb-collapse')
        if (!nav || !side || !search || !collapse) return null
        const box = (el: Element): { x: number; right: number } => {
          const r = el.getBoundingClientRect()
          return { x: r.x, right: r.right }
        }
        const icon = search.querySelector(':scope > svg')
        const iconBox = icon?.getBoundingClientRect()
        return {
          nav: box(nav),
          search: box(search),
          collapse: box(collapse),
          iconCenterX: iconBox ? iconBox.x + iconBox.width / 2 : Number.NaN,
          sideRight: side.getBoundingClientRect().right,
          sideBorder: parseFloat(getComputedStyle(side).borderRightWidth),
          searchMarginLeft: parseFloat(getComputedStyle(search).marginLeft),
          navMarginRight: parseFloat(getComputedStyle(nav).marginRight),
          buttons: [...nav.querySelectorAll('.tb-btn')].map(box)
        }
      })
    const collapsedGeo = await navGeo()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const doc = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } }
    const found = (await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '.tb-search'
    })) as { nodeId: number }
    await cdp.send('CSS.forcePseudoState', {
      nodeId: found.nodeId,
      forcedPseudoClasses: ['hover']
    })
    // 展开动画中途也量一次:图标若跟着左内边距走,静止态看不出来,动画期间会一路漂
    await page.waitForTimeout(120)
    const midGeo = await navGeo()
    await page.waitForTimeout(480)
    const expandedGeo = await navGeo()
    const fit = await page.evaluate(() => {
      const input = document.querySelector('.tb-search input')
      if (!(input instanceof HTMLInputElement)) return null
      const cs = getComputedStyle(input)
      const canvas = document.createElement('canvas').getContext('2d')
      if (!canvas) return null
      canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      return {
        placeholder: input.placeholder,
        clientW: input.clientWidth,
        textW: canvas.measureText(input.placeholder).width,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      }
    })
    await cdp.send('CSS.forcePseudoState', { nodeId: found.nodeId, forcedPseudoClasses: [] })
    await cdp.detach()
    await page.evaluate((v) => window.atlas.setUiScale(v), uiScaleBefore)
    await page.waitForTimeout(300)
    assert.ok(collapsedGeo, '收起态顶栏几何量不到')
    assert.ok(expandedGeo, '展开态顶栏几何量不到')
    // 导航组贴左段右缘(只留右内边距 + 1px 分隔线);搜索框独占左端,与导航组隔开
    assert.ok(
      Math.abs(
        collapsedGeo.nav.right -
          (collapsedGeo.sideRight - collapsedGeo.sideBorder - collapsedGeo.navMarginRight)
      ) <= 1,
      `导航组没贴右:nav.right=${collapsedGeo.nav.right}, 左段右缘=${collapsedGeo.sideRight}`
    )
    assert.ok(
      Math.abs(
        collapsedGeo.search.x - (collapsedGeo.collapse.right + collapsedGeo.searchMarginLeft)
      ) <= 1,
      '收起态搜索框没有留在左端'
    )
    assert.ok(
      collapsedGeo.nav.x - collapsedGeo.search.right > 20,
      '收起态搜索框与导航组之间应留出空档'
    )
    // 展开时左缘钉住、右缘向右长;三个导航钮一像素都不许挪
    assert.ok(
      Math.abs(expandedGeo.sideRight - collapsedGeo.sideRight) <= 0.5,
      `量导航组时左段宽度还在变:${collapsedGeo.sideRight} -> ${expandedGeo.sideRight}`
    )
    assert.ok(
      Math.abs(expandedGeo.nav.right - collapsedGeo.nav.right) <= 0.5,
      `搜索展开把导航组右缘挪了位:${collapsedGeo.nav.right} -> ${expandedGeo.nav.right}`
    )
    assert.ok(
      Math.abs(expandedGeo.search.x - collapsedGeo.search.x) <= 0.5,
      `搜索框左缘挪了位:${collapsedGeo.search.x} -> ${expandedGeo.search.x}`
    )
    assert.ok(
      expandedGeo.search.right > collapsedGeo.search.right + 20,
      `搜索框没有向右展开:${collapsedGeo.search.right} -> ${expandedGeo.search.right}`
    )
    assert.ok(
      Math.abs(expandedGeo.search.right - expandedGeo.nav.x) <= 1,
      `搜索框展开后没有吃满到导航组左缘:search.right=${expandedGeo.search.right}, nav.x=${expandedGeo.nav.x}`
    )
    // 放大镜占固定首列:展开只加长输入框,图标在整段动画里都不许动
    assert.ok(midGeo, '展开动画中段顶栏几何量不到')
    assert.ok(
      Math.abs(midGeo.iconCenterX - collapsedGeo.iconCenterX) <= 0.5,
      `展开动画中放大镜漂了位:${collapsedGeo.iconCenterX} -> ${midGeo.iconCenterX}`
    )
    assert.ok(
      Math.abs(expandedGeo.iconCenterX - collapsedGeo.iconCenterX) <= 0.5,
      `搜索展开把放大镜挪了位:${collapsedGeo.iconCenterX} -> ${expandedGeo.iconCenterX}`
    )
    collapsedGeo.buttons.forEach((box, i) => {
      assert.ok(
        expandedGeo.buttons[i] && Math.abs(expandedGeo.buttons[i].x - box.x) <= 0.5,
        `搜索展开把第 ${i + 1} 个导航钮挪了位:${box.x} -> ${expandedGeo.buttons[i]?.x}`
      )
    })
    assert.ok(fit, 'search input must exist')
    assert.equal(fit.placeholder, '搜索文件', '110% 缩放下搜索提示应完整显示')
    assert.ok(
      fit.textW + fit.rem * 0.5 <= fit.clientW + 0.5,
      `placeholder 塞不进输入框:文案 ${fit.textW.toFixed(1)}px + 余量,框宽 ${fit.clientW}px`
    )
  }
  // 页签改版(产品裁定):树里点文件 = 开绑死它的文件签 —— 一文件一张,
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
    2,
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
    2,
    'clicking a folder must not open a tab'
  )
  // 选项区开关(只读):代码文件的菜单只有「只读/自动换行」,没有 md 才有的「排版显示」;
  // 点开关不关闭、状态当场翻面,页头锁钮同步,锁住后键入被拒收;再点一次解锁(不留状态给后面的步骤)
  const lockTab = page
    .locator('.tabbar-tab')
    .filter({ has: page.locator('.tabbar-name').getByText('package.json', { exact: true }) })
  await lockTab.click()
  await lockTab.click({ button: 'right' })
  assert.equal(
    await page.getByRole('menuitemcheckbox', { name: '排版显示' }).count(),
    0,
    'non-markdown tab menu must not offer the render switch'
  )
  const lockRow = page.getByRole('menuitemcheckbox', { name: '只读' })
  assert.equal(await lockRow.getAttribute('aria-checked'), 'false')
  await lockRow.click()
  assert.equal(
    await lockRow.getAttribute('aria-checked'),
    'true',
    'switch row must flip in place and keep the menu open'
  )
  await page.keyboard.press('Escape')
  await page.locator('.code-mode-btn[aria-pressed="true"]').waitFor({ timeout: 5_000 })
  const lockedText = await page.locator('.cm-content').first().innerText()
  await page.locator('.cm-content').first().click()
  await page.keyboard.type('zzz')
  assert.equal(
    await page.locator('.cm-content').first().innerText(),
    lockedText,
    'a read-only tab must reject typing'
  )
  // 全局偏好验证:锁是在 package.json 签上拨的,别的签读数跟着翻 ——
  // README 签菜单里「只读」已开,正文页头锁钮也是锁态(右键不激活签,正文断言前先点回)
  const readmeTab = page
    .locator('.tabbar-tab')
    .filter({ has: page.locator('.tabbar-name').getByText('README.md', { exact: true }) })
  await readmeTab.click({ button: 'right' })
  assert.equal(
    await page.getByRole('menuitemcheckbox', { name: '只读' }).getAttribute('aria-checked'),
    'true',
    'a flip on one tab must read on for every tab (the switch is global)'
  )
  await page.keyboard.press('Escape')
  await readmeTab.click()
  await page.locator('.code-mode-btn[aria-pressed="true"]').waitFor({ timeout: 5_000 })
  await lockTab.click()
  await lockTab.click({ button: 'right' })
  await page.getByRole('menuitemcheckbox', { name: '只读' }).click()
  await page.keyboard.press('Escape')
  await page.locator('.code-mode-btn[aria-pressed="false"]').waitFor({ timeout: 5_000 })
  await lockTab.click({ button: 'right' })
  assert.equal(
    await page.getByRole('menuitemcheckbox', { name: '只读' }).getAttribute('aria-checked'),
    'false',
    'a reopened menu must read the unlocked ledger, not the last click'
  )
  await page.keyboard.press('Escape')
  const editableText = await page.locator('.cm-content').first().innerText()
  await page.locator('.cm-content').first().click()
  await page.keyboard.type('zzz')
  assert.notEqual(
    await page.locator('.cm-content').first().innerText(),
    editableText,
    'an unlocked tab must accept typing'
  )
  // 页签拆出独立窗口(M1):右键「移到新窗口」= 签拆去同进程子窗 —— 子窗带自绘标题栏和
  // 自己的页签带,主窗名下签数减一;关子窗连带关闭并清理该签(Chrome 语义),窗数回原
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
  assert.equal(await page.locator('.tabbar-tab').count(), 1, 'torn tab must leave the main strip')
  // realm 探针:子窗里点一张签要能激活 —— React 合成事件必须够得着外文书(forein document)
  // 里渲染的 Portal 子树;这条断了,子窗里所有交互都是死的
  await auxPage.locator('.tabbar-tab').first().click()
  await auxPage.locator('.tabbar-tab.is-active').waitFor({ timeout: 5_000 })
  // 关子窗(标题栏 × 经主 realm 代发 IPC):连带关闭并清理该签,窗数回原。
  // close 事件要先挂上再点 —— 窗关得快,点后挂监听会扑空
  await Promise.all([
    auxPage.waitForEvent('close', { timeout: 8_000 }),
    auxPage.locator('.win-btn.win-close').click()
  ])
  assert.equal(electron.windows().length, 1, 'closing aux window must leave only the main window')
  assert.equal(
    await page.locator('.tabbar-tab').count(),
    1,
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
  await shot('tree-notes')
  // 悬停轻提示(全场唯一登记):树行小灰字退役 → 摘要挪进 #2c2c2c 圆角气泡,
  // 统一从树区右缘(sash 拖杆线)弹出,不压上下行的字;鼠标一走气泡关闭
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
  // 备注:树上右键 → 写备注就地长输入框 → 回车保存 → 悬停提示只显示备注正文;
  // 清除备注后,悬停提示自动恢复引擎摘要
  const noteTarget = page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'README.md' })
  const summaryTip = await noteTarget.getAttribute('data-tip')
  assert.ok(summaryTip, 'README.md must start with an engine summary tip')
  await noteTarget.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '写备注', exact: true }).click()
  const noteInput = page.locator('.file-path-menu-input')
  await noteInput.waitFor()
  // 中文输入法选字时的回车是「上屏」,不许触发保存
  await noteInput.fill('合成中的字')
  await noteInput.evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
    )
  })
  assert.ok(await noteInput.isVisible(), 'composing Enter must not save')
  await noteInput.fill('这是我对 README 的备注')
  await noteInput.press('Enter')
  await page.locator('.file-path-menu').waitFor({ state: 'detached' })
  await page
    .locator('.tree-row.is-file')
    .filter({ hasText: 'README.md' })
    .locator('.tree-note-mark')
    .waitFor()
  assert.equal(
    await noteTarget.getAttribute('data-tip'),
    '这是我对 README 的备注',
    'note must replace summary tip'
  )
  await noteTarget.hover()
  await bubble.waitFor()
  assert.equal(
    (await bubble.textContent())?.trim(),
    '这是我对 README 的备注',
    'tooltip must show only the note body'
  )
  await page.mouse.move(12, 320)
  await bubble.waitFor({ state: 'detached' })
  // 页脚笔形开关:关掉只藏显示(行内小笔标 + 悬停里的备注话术),备注数据与右键菜单照旧
  const notesToggle = page.locator('.sidebar-notes-toggle')
  assert.equal(
    await notesToggle.getAttribute('aria-pressed'),
    'true',
    'notes must be visible by default'
  )
  await notesToggle.click()
  assert.equal(
    await page.evaluate(() => localStorage.getItem('atlas.treeNotesShown')),
    'off',
    'notes toggle must be a global preference, not per project'
  )
  await page
    .locator('.tree-row.is-file')
    .filter({ hasText: 'README.md' })
    .locator('.tree-note-mark')
    .waitFor({ state: 'detached' })
  assert.equal(
    await noteTarget.getAttribute('data-tip'),
    summaryTip,
    'hiding notes must restore the summary tip'
  )
  await notesToggle.click()
  await page
    .locator('.tree-row.is-file')
    .filter({ hasText: 'README.md' })
    .locator('.tree-note-mark')
    .waitFor()
  assert.equal(
    await noteTarget.getAttribute('data-tip'),
    '这是我对 README 的备注',
    'showing notes again must bring the note back'
  )
  assert.equal(
    await page.evaluate(() => localStorage.getItem('atlas.treeNotesShown')),
    'on',
    'the global notes preference must record the "on" state too'
  )
  await noteTarget.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '清除备注', exact: true }).click()
  await page.locator('.file-path-menu').waitFor({ state: 'detached' })
  assert.equal(
    await noteTarget.getAttribute('data-tip'),
    summaryTip,
    'summary tip must come back after removing the note'
  )
  // UI v3(B5):workspace 卡 ⇅ 菜单——浮层成行、↓ 键盘高亮、行首 pin 两态、Esc 关闭
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
  // UI v3(B7):顶栏深搜——词一进,树区整体换成结果清单;文件命中补探父链后开预览页签;
  // 空账照实说;文件夹命中打开为工作区(地址栏同一条路);清空词文件树原样回来
  const searchBox = page.getByRole('searchbox', { name: '搜索文件', exact: true })
  // 顶栏搜索是默认收起的放大镜:输入框 max-width:0+opacity:0,悬停才展开 —— 先悬停再填
  await page.locator('.tb-search').hover()
  await searchBox.fill('guide')
  await page.locator('.search-results .tree-row').waitFor()
  await shot('search-results')
  await page.locator('.search-results .tree-row').filter({ hasText: 'guide.md' }).click()
  // md 系文件签默认 Live Preview:容器是 .cm-editor,上妆后标题记号藏起只剩大字;
  // 块级替身也要现身(表格/hr 走 compute 出账 —— 走插件出账是 CM6 禁令,一报就崩)
  await page.locator('.cm-editor').filter({ hasText: 'Getting started' }).waitFor()
  await page.locator('.cm-live-table .md-table').waitFor()
  await page.locator('.cm-live-hr').waitFor()
  // 格内编辑(Obsidian 式):格子常驻 contenteditable 装饰源码格,点进去即编辑、
  // 表格始终渲染态不塌妆;敲字整表重序列化写回源码
  const cell = page.locator('.cm-live-table td').filter({ hasText: '1' }).first()
  await cell.click()
  await cell.locator('.cm-live-cell-src').fill('9')
  await page.locator('.cm-live-table td').filter({ hasText: '9' }).waitFor()
  // 点标题文字卸妆(md-title margin 案):借皮的 margin-bottom 不在 border-box 内,
  // CM 行高账量不到 → 它之下所有行记账偏低、单击穿透到下一行;margin 换 padding 归位后,
  // 单击标题行必须落进本行、# 记号现身 —— 顺带验证点格外后表格仍是渲染态
  await page.locator('.cm-live-h1').click()
  await page.locator('.cm-live-h1').filter({ hasText: '#' }).waitFor()
  await page.locator('.cm-live-table td').filter({ hasText: '9' }).waitFor()
  // 右缘 ＋列(悬停现身):点了表头多一格;底缘 ＋行:正文多一行。
  // 钮的 pointer-events 靠 .cm-live-table:hover 才开口 —— 先把鼠标真实压到钮上再点,
  // 否则命中检测的瞬间悬停可能还没挂上,底下的 td 会截胡(抖动,不是回归)
  await page.locator('.cm-live-table').hover()
  await page.locator('.cm-live-edge-col').hover()
  await page.locator('.cm-live-edge-col').click()
  await page.locator('.cm-live-table th').nth(2).waitFor()
  await page.locator('.cm-live-edge-row').hover()
  await page.locator('.cm-live-edge-row').click()
  await page.locator('.cm-live-table tbody tr').nth(1).waitFor()
  // 点表格边缘(非格子)照旧卸妆露管道源码 —— 替身敲门砖 + 烂表逃生口
  await page.locator('.cm-live-table').click({ position: { x: 2, y: 2 } })
  await page.locator('.cm-live-table').waitFor({ state: 'detached' })
  await page.locator('.cm-content').filter({ hasText: '| a | b |' }).waitFor()
  // 深搜框是悬停展开的:刚才鼠标在表格上舞了一圈,先悬停再填词
  await page.locator('.tb-search').hover()
  await searchBox.fill('绝没有这个词zzz')
  await page
    .locator('.search-results')
    .getByText(/没找到叫/)
    .waitFor()
  await searchBox.fill('src')
  await page.locator('.search-results .tree-row.is-dir').waitFor()
  await page.locator('.search-results .tree-row.is-dir').click()
  // 目录命中 = 把它当工作区打开:重扫期间正文换 ScanOrError,扫完 main.workspace 才回来
  await page.locator('main.workspace').waitFor()
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
    .locator('.cm-editor')
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
  // UI 工作台:rail 钮开单例签 → 空白页面就位 → 再点只聚焦不生第二张 → 关签卸载
  const uiWorkbenchBtn = page.getByRole('button', { name: 'UI 工作台', exact: true })
  await uiWorkbenchBtn.click()
  await page.getByRole('region', { name: 'UI 工作台', exact: true }).waitFor()
  await page.getByRole('region', { name: 'UI 工作台左侧栏' }).waitFor()
  await uiWorkbenchBtn.click()
  assert.equal(
    await page.locator('.tabbar-tab').filter({ hasText: 'UI 工作台' }).count(),
    1,
    'UI workbench is a singleton tab'
  )
  // 画板是页面里的普通对象:新文档预置一个画板,点它的名签选中后属性面板出画板分区
  await page.locator('.uwb-frame-label').first().click()
  // 画板分区:宽高间的对调钮一键互换(默认 390×844);正方形时禁态且点了无效。
  // 放在缩放段之前:改画板会重新 fit 视口,后面 Ctrl+0 的归位断言不受影响
  const widthInput = page.getByLabel('画板宽')
  const heightInput = page.getByLabel('画板高')
  const swapBtn = page.getByRole('button', { name: '对调宽高' })
  assert.equal(await widthInput.inputValue(), '390')
  assert.equal(await heightInput.inputValue(), '844')
  await swapBtn.click()
  assert.equal(await widthInput.inputValue(), '844', 'swap swaps W/H')
  assert.equal(await heightInput.inputValue(), '390')
  await heightInput.fill('844')
  await heightInput.press('Enter')
  assert.equal(
    await swapBtn.getAttribute('aria-disabled'),
    'true',
    'swap button is inert on a square artboard'
  )
  await swapBtn.click({ force: true })
  assert.equal(await heightInput.inputValue(), '844', 'inert swap does not change size')
  await widthInput.fill('390')
  await widthInput.press('Enter')
  assert.equal(await widthInput.inputValue(), '390', 'board restored to 390x844')
  // 书签钮:一键以当前尺寸存预设(空名自动以「宽 × 高」命名),已存态再点即删
  const presetSelect = page.getByLabel('画板尺寸预设')
  const saveBtn = page.getByRole('button', { name: '存为预设' })
  const removeBtn = page.getByRole('button', { name: '删除预设' })
  await saveBtn.click()
  assert.ok(
    (await presetSelect.inputValue()).startsWith('saved:'),
    'saving selects the new saved preset'
  )
  await removeBtn.waitFor()
  await removeBtn.click()
  assert.equal(
    await presetSelect.inputValue(),
    'builtin:phone-standard',
    'removing the preset falls back to the builtin match'
  )
  await saveBtn.waitFor()
  // 取消选中画板:空选时属性面板回到页面分区
  await page.locator('.uwb-viewport').hover()
  await page.keyboard.press('Escape')
  // 画布:Ctrl+滚轮缩放画板;鼠标在画布上时 Ctrl+0 只把画板回 100%,不动应用界面缩放
  const zoomReadout = page.locator('.uwb-zoom')
  const zoomBefore = await zoomReadout.innerText()
  await page.locator('.uwb-viewport').hover()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -400)
  await page.keyboard.up('Control')
  await page.waitForFunction(
    (prev) => document.querySelector('.uwb-zoom')?.textContent !== prev,
    zoomBefore
  )
  const uiScaleBefore = await page.evaluate(() => window.atlas.getUiScale())
  await page.keyboard.press('Control+0')
  await page.waitForFunction(() => document.querySelector('.uwb-zoom')?.textContent === '100%')
  assert.equal(
    await page.evaluate(() => window.atlas.getUiScale()),
    uiScaleBefore,
    'Ctrl+0 over the canvas must not reset the app UI scale'
  )
  await shot('ui-workbench-canvas')
  // 矩形工具:R 拖出矩形 → 选中态(描边 + 四角圆角手柄)与属性面板矩形分区就位
  const canvasVp = page.locator('.uwb-viewport')
  await canvasVp.hover()
  await page.keyboard.press('r')
  const vpBox = (await canvasVp.boundingBox())!
  await page.mouse.move(vpBox.x + 300, vpBox.y + 200)
  await page.mouse.down()
  await page.mouse.move(vpBox.x + 420, vpBox.y + 280, { steps: 4 })
  await page.mouse.up()
  await page.locator('.uwb-sel-node').waitFor()
  assert.equal(await page.locator('.uwb-radius-handle').count(), 4, 'rect gets 4 radius handles')
  // 矩形本体渲染在画板 iframe 里(CSS 适配器输出,与导出同源)
  const frameFill = await page.evaluate(() => {
    const doc = (document.querySelector('.uwb-page-frame') as HTMLIFrameElement | null)
      ?.contentDocument
    const node = doc?.querySelector('.rect-1')
    return node ? doc?.defaultView?.getComputedStyle(node).backgroundColor : null
  })
  assert.equal(frameFill, 'rgb(217, 217, 217)', 'rect renders inside the artboard iframe')
  await page.getByRole('region', { name: '矩形 1' }).waitFor()
  await page.getByRole('region', { name: '圆角' }).waitFor()
  await shot('ui-workbench-rect')
  // 外观分区:填充可移除/改色;描边可添加并调线宽/线型;画布 iframe 与导出同源即时反映
  const fillSection = page.getByRole('region', { name: '填充', exact: true })
  const strokeSection = page.getByRole('region', { name: '描边', exact: true })
  await fillSection.waitFor()
  await strokeSection.waitFor()
  // 描边宽按设计值比对:高 DPI 下 Chromium 把 border 宽吸附到物理像素(如 DPR1.5 时 1px→0.667px),
  // 故线宽断言用 ±0.5px 容差,只验设计口径正确;颜色/线型不吃 DPI,仍精确比对
  const waitRectStyle = (expected: {
    background?: string
    borderWidth?: number
    borderStyle?: string
  }): Promise<void> =>
    page
      .waitForFunction(
        (want) => {
          const doc = (document.querySelector('.uwb-page-frame') as HTMLIFrameElement | null)
            ?.contentDocument
          const node = doc?.querySelector('.rect-1')
          const style = node ? doc?.defaultView?.getComputedStyle(node) : undefined
          if (!style) return false
          return (
            (want.background === undefined || style.backgroundColor === want.background) &&
            (want.borderWidth === undefined ||
              Math.abs(parseFloat(style.borderTopWidth) - want.borderWidth) <= 0.5) &&
            (want.borderStyle === undefined || style.borderTopStyle === want.borderStyle)
          )
        },
        expected,
        { timeout: 5000 }
      )
      .then(() => undefined)
  // 移除填充 → 画布透明;加回后改 hex → 画布变新色
  await fillSection.getByRole('button', { name: '移除填充' }).click()
  await waitRectStyle({ background: 'rgba(0, 0, 0, 0)' })
  await fillSection.getByRole('button', { name: '添加填充' }).click()
  const fillHex = fillSection.getByRole('textbox', { name: '填充色', exact: true })
  await fillHex.fill('#ff8800')
  await fillHex.press('Enter')
  await waitRectStyle({ background: 'rgb(255, 136, 0)' })
  // 取色器实时预览:连续 input 逐帧落地、画布即时变色;change(关弹窗)结算——
  // 整段挑色收成一步,Ctrl+Z 一按直接回到取色前的颜色,不留一串碎账
  await page.evaluate(() => {
    const swatch = document.querySelector('input[aria-label="填充色取色"]') as HTMLInputElement
    for (const hex of ['#00ff00', '#0000ff', '#123456']) {
      swatch.value = hex
      swatch.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await waitRectStyle({ background: 'rgb(18, 52, 86)' })
  await page.evaluate(() => {
    document
      .querySelector('input[aria-label="填充色取色"]')
      ?.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.keyboard.press('Control+z')
  await waitRectStyle({ background: 'rgb(255, 136, 0)' })
  // Esc 取消取色器(只发 cancel 不发 change):还原值提交进批 → 净零不入账;
  // 随后聚焦色板按 Ctrl+Z——既验证批次没挂死(撤销活着),也验证焦点在非文本控件上不是死键
  await page.evaluate(() => {
    const swatch = document.querySelector('input[aria-label="填充色取色"]') as HTMLInputElement
    swatch.value = '#ff00ff'
    swatch.dispatchEvent(new Event('input', { bubbles: true }))
    swatch.value = '#ff8800' // 取消时浏览器把值还原成取色前原值,此处模拟还原
    swatch.dispatchEvent(new Event('cancel', { bubbles: true }))
  })
  await waitRectStyle({ background: 'rgb(255, 136, 0)' })
  await page.evaluate(() =>
    (document.querySelector('input[aria-label="填充色取色"]') as HTMLElement).focus()
  )
  await page.keyboard.press('Control+z')
  await waitRectStyle({ background: 'rgb(217, 217, 217)' })
  await page.keyboard.press('Control+Shift+z')
  await waitRectStyle({ background: 'rgb(255, 136, 0)' })
  // 添加描边 → 1px 实线;线型切虚线、线宽改 3 → 画布同步;Ctrl+Z 逐笔撤
  await strokeSection.getByRole('button', { name: '添加描边' }).click()
  await waitRectStyle({ borderStyle: 'solid', borderWidth: 1 })
  await strokeSection.getByRole('combobox', { name: '线型' }).selectOption('dashed')
  const strokeWidthField = strokeSection.getByRole('textbox', { name: '线宽' })
  await strokeWidthField.fill('3')
  await strokeWidthField.press('Enter')
  await waitRectStyle({ borderStyle: 'dashed', borderWidth: 3 })
  await page.keyboard.press('Control+z')
  await waitRectStyle({ borderStyle: 'dashed', borderWidth: 1 })
  // Shift + 圆角柄:拖动中按下 Shift 不动鼠标也立即吸附,松开落回原值(PS 式)
  // 指针落点以矩形左上角顶点(300,200)为基准:手柄会随半径自己挪位置,不能用它的包围盒
  const radiusHandle = page.locator('.uwb-radius-handle').nth(0)
  const rhBox = (await radiusHandle.boundingBox())!
  const cornerField = page.getByRole('textbox', { name: '四角', exact: true })
  await page.mouse.move(rhBox.x + 4, rhBox.y + 4)
  await page.mouse.down()
  await page.mouse.move(vpBox.x + 337, vpBox.y + 237, { steps: 3 })
  assert.equal(await cornerField.inputValue(), '37', 'radius follows the drag')
  await page.keyboard.down('Shift')
  assert.equal(await cornerField.inputValue(), '36', 'pressing Shift snaps immediately')
  await page.keyboard.up('Shift')
  assert.equal(await cornerField.inputValue(), '37', 'releasing Shift restores the raw value')
  await page.mouse.up()
  // 旋转旋钮:按住旋钮区不丢选中,拖动改角度(矩形 120×80 画在 300,200 起,旋钮在顶边中点上方)
  await page.mouse.move(vpBox.x + 360, vpBox.y + 178)
  await page.mouse.down()
  await page.mouse.move(vpBox.x + 400, vpBox.y + 150, { steps: 3 })
  await page.mouse.up()
  await page.locator('.uwb-sel-node').waitFor()
  assert.notEqual(await page.getByLabel('角度').inputValue(), '0', 'rotate knob changes rotation')
  // 角缩放:拖右下白方块,宽高变化且选中不丢
  const widthField = page.getByRole('textbox', { name: '宽', exact: true })
  const heightField = page.getByRole('textbox', { name: '高', exact: true })
  const beforeW = await widthField.inputValue()
  const beforeH = await heightField.inputValue()
  const brHandle = page.locator('.uwb-corner-handle').nth(2)
  const brBox = (await brHandle.boundingBox())!
  await page.mouse.move(brBox.x + 4, brBox.y + 4)
  await page.mouse.down()
  await page.mouse.move(brBox.x + 34, brBox.y + 24, { steps: 3 })
  await page.mouse.up()
  await page.locator('.uwb-sel-node').waitFor()
  const afterW = await widthField.inputValue()
  const afterH = await heightField.inputValue()
  assert.ok(afterW !== beforeW || afterH !== beforeH, 'corner handle resizes the rect')
  // Shift + 拖角:宽高比不变
  const tlHandle = page.locator('.uwb-corner-handle').nth(0)
  const tlBox = (await tlHandle.boundingBox())!
  await page.keyboard.down('Shift')
  await page.mouse.move(tlBox.x + 4, tlBox.y + 4)
  await page.mouse.down()
  await page.mouse.move(tlBox.x - 40, tlBox.y + 30, { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const ratio = Number(afterW) / Number(afterH)
  const ratio2 = Number(await widthField.inputValue()) / Number(await heightField.inputValue())
  assert.ok(Math.abs(ratio2 - ratio) < 0.02, 'Shift-resize keeps the aspect ratio')
  // 导出按钮:下拉列出全部登记格式
  await page.getByRole('button', { name: '导出', exact: true }).click()
  for (const label of ['设计数值 tokens.json', '网页 HTML + CSS', '矢量图 SVG']) {
    await page.getByRole('menuitem', { name: label }).waitFor()
  }
  await page.keyboard.press('Escape')
  await page.locator('.file-path-menu').waitFor({ state: 'detached' })
  // 矩形工具常驻:先按 V 切回移动,再点画布左上空地取消选中 → 点矩形选中 → Delete 删除
  await canvasVp.hover()
  await page.keyboard.press('v')
  await page.mouse.click(vpBox.x + 60, vpBox.y + 60)
  await page.locator('.uwb-sel-node').waitFor({ state: 'detached' })
  await page.mouse.click(vpBox.x + 360, vpBox.y + 240)
  await page.locator('.uwb-sel-node').waitFor()
  await page.keyboard.press('Delete')
  await page.locator('.uwb-sel-node').waitFor({ state: 'detached' })
  // 只点不拖不生成(PS 规矩):矩形工具下单击画布,松手即回收,不留幽灵矩形
  await page.keyboard.press('r')
  await page.mouse.click(vpBox.x + 60, vpBox.y + 60)
  assert.equal(
    await page.evaluate(
      () =>
        (
          document.querySelector('.uwb-page-frame') as HTMLIFrameElement | null
        )?.contentDocument?.querySelectorAll('[class*="rect-"]').length ?? -1
    ),
    0,
    'bare click with rect tool must not leave a rect behind'
  )
  await page.keyboard.press('v')
  // 撤销/重做:Ctrl+Z 找回刚删的矩形并带选中;Ctrl+Shift+Z 把删除重做回去
  await page.keyboard.press('Control+z')
  await page.locator('.uwb-sel-node').waitFor()
  await page.keyboard.press('Control+Shift+z')
  await page.locator('.uwb-sel-node').waitFor({ state: 'detached' })
  await page.keyboard.press('Control+z')
  await page.locator('.uwb-sel-node').waitFor()
  await page.keyboard.press('Control+y')
  await page.locator('.uwb-sel-node').waitFor({ state: 'detached' })
  // 复制/粘贴/微调:找回矩形 → Ctrl+C 连贴两次出两个逐级偏移的克隆;方向键挪一格可整笔撤销
  await page.keyboard.press('Control+z')
  await page.locator('.uwb-sel-node').waitFor()
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await page.keyboard.press('Control+v')
  const pastedCount = await page.evaluate(
    () =>
      (
        document.querySelector('.uwb-page-frame') as HTMLIFrameElement | null
      )?.contentDocument?.querySelectorAll('[class^="rect-"]').length ?? 0
  )
  assert.equal(pastedCount, 3, 'Ctrl+V twice must paste two cloned rects')
  // 对齐吸附(Figma 式):拖矩形靠近他人边线自动吸上+引导线;Shift 拖 = 轴锁;Ctrl 按住 = 临时禁吸。
  // 视口 pan 非零(实测 103,-52),屏幕偏移 ≠ 设计坐标——先读 pan/zoom 做换算
  const viewNow = await page.evaluate(() => {
    const frameDoc = (document.querySelector('.uwb-page-frame') as HTMLIFrameElement)
      .contentDocument
    const t = (frameDoc?.querySelector('.uwb-root') as HTMLElement).style.transform
    const m = t.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/)!
    return { panX: Number(m[1]), panY: Number(m[2]), zoom: Number(m[3]) }
  })
  const sx = (dx: number): number => vpBox.x + viewNow.panX + dx * viewNow.zoom
  const sy = (dy: number): number => vpBox.y + viewNow.panY + dy * viewNow.zoom
  await canvasVp.hover()
  await page.keyboard.press('r')
  // 设计坐标系内画:A (60,420) 60×50;B (200,400) 60×50
  // 画完工具自动回弹选择(Figma 式):画 B 前得再按一次 r
  await page.mouse.move(sx(60), sy(420))
  await page.mouse.down()
  await page.mouse.move(sx(120), sy(470), { steps: 3 })
  await page.mouse.up()
  await canvasVp.hover()
  await page.keyboard.press('r')
  await page.mouse.move(sx(200), sy(400))
  await page.mouse.down()
  await page.mouse.move(sx(260), sy(450), { steps: 3 })
  await page.mouse.up()
  await page.keyboard.press('v')
  const xSnap = page.getByRole('textbox', { name: 'X', exact: true })
  const ySnap = page.getByRole('textbox', { name: 'Y', exact: true })
  // 抓 B 中心(230,425)拖到左缘差 2px → 吸成 60,引导线现身
  await page.mouse.move(sx(230), sy(425))
  await page.mouse.down()
  await page.mouse.move(sx(88), sy(428), { steps: 4 })
  // line 是零面积几何体,Playwright 的 visible 判定不认它——用 attached
  await page.locator('.uwb-guide').first().waitFor({ state: 'attached' })
  await page.mouse.up()
  assert.equal(await xSnap.inputValue(), '60', 'drag must snap B left edge to A left edge')
  assert.equal(await ySnap.inputValue(), '403', 'unsnapped axis keeps raw value')
  // Shift 轴锁:斜拖只走主方向,x 钉在 60 不动;B 现于 (60,403)
  await page.mouse.move(sx(90), sy(428))
  await page.mouse.down()
  await page.keyboard.down('Shift')
  await page.mouse.move(sx(40), sy(503), { steps: 4 })
  assert.equal(await xSnap.inputValue(), '60', 'Shift axis-lock pins x')
  assert.equal(await ySnap.inputValue(), '478', 'dominant axis moves freely')
  await page.mouse.up()
  await page.keyboard.up('Shift')
  // Ctrl 按住:B 现于 (60,478),同样位移落 58 不吸,引导线也不出
  await page.keyboard.down('Control')
  await page.mouse.move(sx(90), sy(503))
  await page.mouse.down()
  await page.mouse.move(sx(88), sy(506), { steps: 3 })
  assert.equal(await page.locator('.uwb-guide').count(), 0, 'Ctrl suppresses snap guides')
  await page.mouse.up()
  await page.keyboard.up('Control')
  assert.equal(await xSnap.inputValue(), '58', 'Ctrl disables snapping')
  const xField = page.getByRole('textbox', { name: 'X', exact: true })
  const xBefore = Number(await xField.inputValue())
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  assert.equal(Number(await xField.inputValue()), xBefore + 2, 'arrows nudge 1px each')
  await page.keyboard.press('Shift+ArrowRight')
  assert.equal(Number(await xField.inputValue()), xBefore + 12, 'Shift+arrow nudges 10px')
  // 三次点按 = 三笔账:逐次撤销验证每次按键都是独立一步
  await page.keyboard.press('Control+z')
  await page.waitForFunction(
    (x) => document.querySelector<HTMLInputElement>('input[aria-label="X"]')?.value === String(x),
    xBefore + 2
  )
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await page.waitForFunction(
    (x) => document.querySelector<HTMLInputElement>('input[aria-label="X"]')?.value === String(x),
    xBefore
  )
  // 小键盘方向键(e.code 恒为 Numpad*)与主键区同效;按完撤掉不留尾巴
  await page.keyboard.press('Numpad6')
  assert.equal(
    Number(await xField.inputValue()),
    xBefore + 1,
    'numpad arrow must nudge selected rect'
  )
  await page.keyboard.press('Control+z')
  await page.waitForFunction(
    (x) => document.querySelector<HTMLInputElement>('input[aria-label="X"]')?.value === String(x),
    xBefore
  )
  // 框选(Figma 式):空白处拖出虚线选框,扫到即中。A(60,420,60×50) B(58,478,60×50)
  // 用一个罩住俩的框圈进来;上面三个克隆体在 y≤352,框从 y=410 起拖碰不到
  const rectTotal = (): Promise<number> =>
    page.evaluate(
      () =>
        (
          document.querySelector('.uwb-page-frame') as HTMLIFrameElement
        ).contentDocument?.querySelectorAll('[class^="rect-"]').length ?? -1
    )
  await canvasVp.hover()
  await page.mouse.move(sx(40), sy(410))
  await page.mouse.down()
  await page.mouse.move(sx(150), sy(540), { steps: 4 })
  // rect 是零面积几何体,visible 判定不认它——用 attached
  await page.locator('.uwb-marquee').waitFor({ state: 'attached' })
  await page.mouse.up()
  assert.equal(await page.locator('.uwb-sel-node').count(), 2, 'marquee must select both rects')
  await page.getByText('已选 2 个对象').waitFor()
  // Shift+点击已选的 A 中心 → 减选,只剩 B
  await page.keyboard.down('Shift')
  await page.mouse.click(sx(90), sy(445))
  await page.keyboard.up('Shift')
  assert.equal(await page.locator('.uwb-sel-node').count(), 1, 'Shift+click must deselect A only')
  // 再框选俩 → Ctrl+D 整组复制:克隆俩也整体选中;Ctrl+Z 撤回到 A、B 选中
  await page.mouse.move(sx(40), sy(410))
  await page.mouse.down()
  await page.mouse.move(sx(150), sy(540), { steps: 4 })
  await page.mouse.up()
  await page.keyboard.press('Control+d')
  assert.equal(await rectTotal(), 7, 'Ctrl+D must clone both selected rects')
  assert.equal(await page.locator('.uwb-sel-node').count(), 2, 'duplicate selects the two clones')
  await page.keyboard.press('Control+z')
  assert.equal(await rectTotal(), 5, 'undo drops the two clones')
  assert.equal(
    await page.locator('.uwb-sel-node').count(),
    2,
    'undo restores the marquee selection'
  )
  // Delete 整组删:A、B 同时消失,选集清空;且指针停在属性面板上 Delete 也得灵(文档级键)
  await page.locator('.uwb-inspector').hover()
  await page.keyboard.press('Delete')
  assert.equal(await rectTotal(), 3, 'Delete removes all selected rects')
  assert.equal(await page.locator('.uwb-sel-node').count(), 0, 'selection empties with the nodes')
  // 边中点柄(单边缩放,PS 同款):点选残留的克隆体,拖右边中点外扩 30 → 只宽变,对边钉死
  await page.mouse.click(sx(277), sy(312))
  await page.locator('.uwb-sel-node').waitFor()
  assert.equal(
    await page.locator('.uwb-edge-handle').count(),
    4,
    'single selection shows 4 edge handles'
  )
  const xFieldE = page.getByRole('textbox', { name: 'X', exact: true })
  const wFieldE = page.getByRole('textbox', { name: '宽', exact: true })
  const hFieldE = page.getByRole('textbox', { name: '高', exact: true })
  const xEdge0 = Number(await xFieldE.inputValue())
  const wEdge0 = Number(await wFieldE.inputValue())
  const hEdge0 = Number(await hFieldE.inputValue())
  // 克隆体带着旋转角:拖要沿「右边」的法线方向(本地 +x 轴的屏幕投影),否则位移只有 cos 分量
  const rotDeg = Number(await page.getByRole('textbox', { name: '角度', exact: true }).inputValue())
  const rad = (rotDeg * Math.PI) / 180
  const edgeBox = await page.locator('.uwb-edge-handle').nth(1).boundingBox() // 上右下左 → 1=右边
  if (!edgeBox) throw new Error('right edge handle missing')
  await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    edgeBox.x + edgeBox.width / 2 + 30 * Math.cos(rad),
    edgeBox.y + edgeBox.height / 2 + 30 * Math.sin(rad),
    { steps: 3 }
  )
  await page.mouse.up()
  assert.equal(Number(await wFieldE.inputValue()), wEdge0 + 30, 'right edge drag grows width only')
  // 旋转矩形对边中点投影出半像素,取整路径允许 ±1 晃动(同角缩放断言口径)
  assert.ok(
    Math.abs(Number(await xFieldE.inputValue()) - xEdge0) <= 1,
    'opposite edge stays pinned within rounding wiggle'
  )
  assert.equal(Number(await hFieldE.inputValue()), hEdge0, 'height untouched')
  await page.keyboard.press('Control+z')
  assert.equal(Number(await wFieldE.inputValue()), wEdge0, 'undo restores width')
  // 外观样式(Figma 式活链接):存方案 → 应用 → 手动改脱钩 → 同名覆盖回写 → 删除保数值
  const styleSelect = page.getByRole('combobox', { name: '外观样式', exact: true })
  const styleNameOf = (): Promise<string> =>
    styleSelect.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '')
  // 残留克隆体仍选中:调成特征外观(填充 #22aaee、四角圆角)并存为「主按钮」
  await fillHex.fill('#22aaee')
  await fillHex.press('Enter')
  await cornerField.fill('8')
  await cornerField.press('Enter')
  const schemeRadius = await cornerField.inputValue() // 短边可能钳小,以落地值为准
  const saveStyleBtn = page.getByRole('button', { name: '存为样式', exact: true })
  const styleNameInput = page.getByRole('textbox', { name: '样式名', exact: true })
  await saveStyleBtn.click()
  await styleNameInput.fill('主按钮')
  await styleNameInput.press('Enter')
  assert.equal(await styleNameOf(), '主按钮', 'saving links the rect to the named style')
  // 新画一个矩形(画完回弹选择工具、自动选中)→ 下拉应用方案:外观三件套同步 + 挂链
  await canvasVp.hover()
  await page.keyboard.press('r')
  await page.mouse.move(sx(200), sy(560))
  await page.mouse.down()
  await page.mouse.move(sx(240), sy(600), { steps: 3 })
  await page.mouse.up()
  await styleSelect.selectOption({ label: '主按钮' })
  assert.equal(await fillHex.inputValue(), '#22aaee', 'apply style copies fill')
  assert.equal(await cornerField.inputValue(), schemeRadius, 'apply style copies radii')
  // 手动改外观 → 静默脱钩:下拉回「无样式」
  await fillHex.fill('#111111')
  await fillHex.press('Enter')
  assert.equal(await styleSelect.inputValue(), '', 'manual appearance edit detaches the link')
  // 重挂 → 点回源克隆体改填充、同名再存:定义更新,回写到仍挂着的矩形
  await styleSelect.selectOption({ label: '主按钮' })
  await page.mouse.click(sx(277), sy(312))
  await fillHex.fill('#00cc88')
  await fillHex.press('Enter')
  await saveStyleBtn.click()
  await styleNameInput.fill('主按钮')
  await styleNameInput.press('Enter')
  await page.mouse.click(sx(220), sy(580))
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>('input[aria-label="填充色"]')?.value === '#00cc88'
  )
  assert.equal(await styleNameOf(), '主按钮', 'style overwrite propagates to linked nodes')
  // 删除样式:定义没了,挂着的矩形保留当前数值、链接清空
  await page.getByRole('button', { name: '删除样式', exact: true }).click()
  assert.equal(await fillHex.inputValue(), '#00cc88', 'delete style keeps current values')
  assert.equal(await styleSelect.inputValue(), '', 'delete style clears the link')
  // Ctrl+Alt+C/V 匿名外观拷贝:以克隆体当前值为准,贴到新矩形
  await page.mouse.click(sx(277), sy(312))
  const srcFill = await fillHex.inputValue()
  const srcRadius = await cornerField.inputValue()
  await page.keyboard.press('Control+Alt+c')
  await page.mouse.click(sx(220), sy(580))
  await page.keyboard.press('Control+Alt+v')
  assert.equal(await fillHex.inputValue(), srcFill, 'appearance paste copies fill')
  assert.equal(await cornerField.inputValue(), srcRadius, 'appearance paste copies radii')
  // 多选整组换装:克隆体另存「副样式」→ Shift 加选新矩形 → 整组应用
  await page.mouse.click(sx(277), sy(312))
  await fillHex.fill('#aacc00')
  await fillHex.press('Enter')
  await saveStyleBtn.click()
  await styleNameInput.fill('副样式')
  await styleNameInput.press('Enter')
  await page.keyboard.down('Shift')
  await page.mouse.click(sx(220), sy(580))
  await page.keyboard.up('Shift')
  assert.equal(await page.locator('.uwb-sel-node').count(), 2, 'shift+click builds the pair')
  await page.getByRole('combobox', { name: '整组应用样式' }).selectOption({ label: '副样式' })
  await page.mouse.click(sx(220), sy(580))
  assert.equal(await fillHex.inputValue(), '#aacc00', 'group apply dresses each node')
  assert.equal(await styleNameOf(), '副样式', 'group apply links each node')
  // 点画布空处本已是空选;属性面板回到页面分区(画布底色)
  await page.mouse.click(vpBox.x + 60, vpBox.y + 60)
  await page.locator('.uwb-inspector').getByRole('region', { name: '页面', exact: true }).waitFor()
  // 画板工具:F 在页面空地拖出第二个画板 → 选中、属性面板出画板分区、图层树多一行
  const layerRowsBefore = await page.locator('.uwb-layer').count()
  await canvasVp.hover()
  await page.keyboard.press('f')
  await page.mouse.move(vpBox.x + 20, vpBox.y + 100)
  await page.mouse.down()
  await page.mouse.move(vpBox.x + 100, vpBox.y + 180, { steps: 4 })
  await page.mouse.up()
  await page.getByRole('region', { name: '画板 2', exact: true }).waitFor()
  assert.equal(
    await page.locator('.uwb-layer').count(),
    layerRowsBefore + 1,
    'drawing a frame adds one layer row'
  )
  await page.keyboard.press('Delete')
  await page.locator('.uwb-inspector').getByRole('region', { name: '页面', exact: true }).waitFor()
  assert.equal(
    await page.locator('.uwb-layer').count(),
    layerRowsBefore,
    'delete removes the frame'
  )
  // 工具栏焦点环回归:鼠标点过的钮不挂焦点,之后按快捷键不得补出 focus-visible 蓝环
  const rectTool = page.getByRole('button', { name: '矩形工具(R)', exact: true })
  await rectTool.click()
  await canvasVp.hover()
  await page.keyboard.press('v')
  assert.equal(
    await rectTool.evaluate((el) => el.matches(':focus-visible')),
    false,
    'clicked tool button must not keep a focus-visible ring'
  )
  // 工具栏量体:收起态两端留白对称、栏高 40px;左右格位展开后抓手缩进对称
  const bar = page.locator('.uwb-toolbar')
  const collapsed = await page.evaluate(() => {
    const el = document.querySelector('.uwb-toolbar')
    if (!el) throw new Error('toolbar missing')
    const svgs = [...el.querySelectorAll('.uwb-tool svg')]
    const barR = el.getBoundingClientRect()
    return {
      h: barR.height,
      leftGap: svgs[0].getBoundingClientRect().left - barR.left,
      rightGap: barR.right - svgs[svgs.length - 1].getBoundingClientRect().right
    }
  })
  assert.ok(Math.abs(collapsed.h - 64) <= 0.5, 'toolbar height must be 64px (var(--u) * 1.6)')
  assert.ok(
    Math.abs(collapsed.leftGap - collapsed.rightGap) <= 0.5,
    'collapsed toolbar end padding must be symmetric'
  )
  const gripGap = async (side: 'is-left' | 'is-right'): Promise<number> =>
    page.evaluate((s) => {
      const el = document.querySelector('.uwb-toolbar')
      const svg = el?.querySelector(`.uwb-grip-slot.${s} svg`)
      if (!el || !svg) throw new Error('grip svg missing')
      const barR = el.getBoundingClientRect()
      const svgR = svg.getBoundingClientRect()
      return s === 'is-left' ? svgR.left - barR.left : barR.right - svgR.right
    }, side)
  let barBox = (await bar.boundingBox())!
  await page.mouse.move(barBox.x - 6, barBox.y + barBox.height / 2)
  await page.waitForFunction(() =>
    document.querySelector('.uwb-toolbar')?.classList.contains('is-grip-l')
  )
  await page.waitForTimeout(260)
  const leftGap = await gripGap('is-left')
  barBox = (await bar.boundingBox())!
  await page.mouse.move(barBox.x + barBox.width + 6, barBox.y + barBox.height / 2)
  await page.waitForFunction(() =>
    document.querySelector('.uwb-toolbar')?.classList.contains('is-grip-r')
  )
  await page.waitForTimeout(260)
  const rightGap = await gripGap('is-right')
  assert.ok(Math.abs(leftGap - rightGap) <= 0.5, 'expanded grip inset must be symmetric left/right')
  // 出界熄灭回归:触发条只外探 8px,晕区带 28px——挪到 +33(两者之外)必须收起
  barBox = (await bar.boundingBox())!
  await page.mouse.move(barBox.x + barBox.width + 33, barBox.y + barBox.height / 2)
  await page.waitForTimeout(260)
  assert.equal(
    await page.evaluate(() =>
      document.querySelector('.uwb-toolbar')?.classList.contains('is-grip-r')
    ),
    false,
    'pointer beyond grip zone and halo must collapse the grip'
  )
  // 拖回触发条重新点亮,再按住拖动
  barBox = (await bar.boundingBox())!
  await page.mouse.move(barBox.x + barBox.width + 4, barBox.y + barBox.height / 2)
  await page.waitForFunction(() =>
    document.querySelector('.uwb-toolbar')?.classList.contains('is-grip-r')
  )
  await page.waitForTimeout(220)
  // 拖动存档格式不变;关签重开,位置按存档原地恢复不漂移
  barBox = (await bar.boundingBox())!
  await page.mouse.down()
  await page.mouse.move(barBox.x + barBox.width + 56, barBox.y + barBox.height / 2 + 30, {
    steps: 4
  })
  await page.mouse.up()
  const savedPos = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('uwb-toolbar-pos') ?? 'null')
  )
  assert.ok(
    Number.isFinite(savedPos?.fx) && Number.isFinite(savedPos?.fy),
    'uwb-toolbar-pos must stay in {fx,fy} frac format'
  )
  await page.mouse.move(vpBox.x + 200, vpBox.y + 100)
  const draggedBox = (await bar.boundingBox())!
  await page.getByRole('button', { name: '关闭 UI 工作台', exact: true }).click()
  await page.locator('.ui-workbench').waitFor({ state: 'detached' })
  await uiWorkbenchBtn.click()
  await page.getByRole('region', { name: 'UI 工作台', exact: true }).waitFor()
  const restoredBox = (await page.locator('.uwb-toolbar').boundingBox())!
  assert.ok(
    Math.abs(restoredBox.x - draggedBox.x) <= 0.5 && Math.abs(restoredBox.y - draggedBox.y) <= 0.5,
    'toolbar must restore archived position after reopen'
  )
  await page.getByRole('button', { name: '关闭 UI 工作台', exact: true }).click()
  await page.locator('.ui-workbench').waitFor({ state: 'detached' })
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'README.md' }).click()
  await page
    .locator('.cm-editor')
    .filter({ hasText: 'This application helps organize tasks.' })
    .waitFor()
  await shot('file-unconfigured')
  // UI v3(B6):AI 状态浮层的「设置 AI」直达开设置页签并切到「AI 设置」页(不是弹窗了)
  await page.getByRole('button', { name: /AI 状态/ }).click()
  await page.locator('.ai-status-pop').getByRole('button', { name: '设置 AI', exact: true }).click()
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
  // 空目录 = 一个签都没开:空签板顶上(开工作区不再自动开签)
  await home()
  await control({ partial: true })
  await open(project)
  // 分级扫描没探完:页脚不出字,实情挂进计数簇的悬停提示(树里对应目录另有「未扫描」徽章)
  await page.locator('.sidebar-footer .sidebar-counts[data-tip*="部分已扫描"]').waitFor()
  await control({ partial: false, holdGraph: true })
  // 关系分析挂在半路时换工作区:单例签不随工作区关闭,但迟到的旧项目图必须被丢弃,
  // 不许落进还开着的图谱签里
  await page.getByRole('button', { name: '关系图谱', exact: true }).click()
  await page.locator('.graph-view').waitFor()
  await open(join(run, 'second'))
  await release()
  await control({ holdGraph: false })
  await page.waitForTimeout(200)
  assert.equal(
    await page.locator('.tabbar-tab').filter({ hasText: '关系图谱' }).count(),
    1,
    'singleton tabs must survive a workspace switch'
  )
  assert.ok(
    !(await page.locator('.graph-view').innerText()).includes('old-project-only.ts'),
    'a stale graph from the previous project must never reach the graph tab'
  )
  await page.reload()
  // 会话复现(Obsidian 式):重开不回首页,还原关门前的工作区 —— 应停在 second
  await page.locator('.sidebar-footer').waitFor()
  assert.ok(
    (await page.getByRole('textbox', { name: '文件夹路径', exact: true }).inputValue()).endsWith(
      'second'
    ),
    'reload must restore the last workspace (session replay)'
  )
  await open(project)
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'README.md' }).click()
  await page
    .locator('.cm-editor')
    .filter({ hasText: 'This application helps organize tasks.' })
    .waitFor()
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await shot('file-dark')
  assert.deepEqual(errors, [], 'Renderer must not report errors')
  console.log(
    'Journey passed: real scanning/reading/navigation/setup/recovery, mocked delayed and stale graph.'
  )
  console.log(`Local screenshots: ${join(run, 'shots')}`)
} finally {
  await electron.close()
}
