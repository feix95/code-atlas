// UI 框架(UI Spec Builder)规格包自测:纯 node 直跑,读 node_modules 里的 lucide 与字体清单。
// 覆盖:单位换算、默认模板导出零体检错误、实测暴露的缺口能被体检拦下(§23.2)、产物同源一致。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildPackage,
  iconFileNames,
  type PackageAssets
} from '../src/shared/uiFrame/exportPackage.ts'
import { fileIndex } from '../src/shared/uiFrame/readme.ts'
import { HOME_PAGE } from '../src/shared/uiFrame/page.ts'
import { defaultDoc } from '../src/shared/uiFrame/template.ts'
import { hasErrors, lintPackage } from '../src/shared/uiFrame/lint.ts'
import { LUCIDE_VERSION, svgText } from '../src/shared/uiFrame/markup.ts'
import { describePx, remText, snapPx } from '../src/shared/uiFrame/units.ts'
import { resolvePx } from '../src/shared/uiFrame/resolve.ts'
import { demoBody } from '../src/shared/uiFrame/demo.ts'
import { boardBody, boardCss, boardValueText } from '../src/shared/uiFrame/board.ts'
import { rulesCss } from '../src/shared/uiFrame/recipes/kit.ts'
import { RECIPES } from '../src/shared/uiFrame/recipes/index.ts'
import { htmlDocument, PAGE_STYLES, pageFor, styleTexts } from '../src/shared/uiFrame/documents.ts'
import {
  defaultDeviceId,
  deviceFor,
  devicesFor,
  isDeviceId
} from '../src/shared/uiFrame/devices.ts'
import { contrastRatio, platformIssues } from '../src/shared/uiFrame/platformRules.ts'
import {
  flutterThemeDart,
  reactNativeThemeTs,
  tailwindThemeCss
} from '../src/shared/uiFrame/adapters.ts'
import {
  manifestFor,
  parseDoc,
  schemeIdFromName,
  serializeDoc,
  snapshotStamp,
  SNAPSHOT_RE
} from '../src/shared/uiFrame/scheme.ts'
import { BLANK_ID, TEMPLATES, templateDoc } from '../src/shared/uiFrame/templates.ts'
import { importCssVars, importDtcg, importSchemeFiles } from '../src/shared/uiFrame/importDoc.ts'
import { packUiframe, unpackUiframe } from '../src/shared/uiFrame/uiframeFile.ts'
import { benchBody } from '../src/shared/uiFrame/benchBoard.ts'
import { PART_DEFS, partNode } from '../src/shared/uiFrame/parts.ts'
import { strToU8, zipSync } from 'fflate'
import type {
  IconNode,
  LintIssue,
  PageNode,
  SpecPackage,
  UiFrameDoc
} from '../src/shared/uiFrame/types.ts'

const NM = join(import.meta.dirname, '..', 'node_modules')
const read = (p: string): string => readFileSync(join(NM, p), 'utf8')

const iconNodes = JSON.parse(read('lucide-static/icon-nodes.json')) as Record<string, IconNode>
const assets: PackageAssets = {
  lookup: (name) => iconNodes[name],
  fontSources: [
    { dir: 'inter', css: read('@fontsource-variable/inter/index.css') },
    { dir: 'noto-sans-sc', css: read('@fontsource-variable/noto-sans-sc/index.css') }
  ],
  licenses: {
    lucide: read('lucide-static/LICENSE'),
    inter: read('@fontsource-variable/inter/LICENSE'),
    notoSansSc: read('@fontsource-variable/noto-sans-sc/LICENSE')
  },
  stamp: '20261002-1200'
}
/** 页面结构体检对象:本平台的页面 + 每个组件演示页(键随意,体检只按结构树检查) */
const pagesForDoc = (d: UiFrameDoc): Record<string, PageNode[]> => ({
  [pageFor(d.platform).specPath]: pageFor(d.platform).body,
  ...Object.fromEntries(RECIPES.map((r) => [`components/${r.id}.html`, demoBody(r.id)]))
})
const PAGES: Record<string, PageNode[]> = {
  'pages/home.md': HOME_PAGE.body,
  ...Object.fromEntries(RECIPES.map((r) => [`components/${r.id}.html`, demoBody(r.id)]))
}

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const errorsOf = (issues: LintIssue[], check: string): LintIssue[] =>
  issues.filter((i) => i.level === 'error' && i.check === check)

function clonePkg(pkg: SpecPackage): SpecPackage {
  return { ...pkg, files: { ...pkg.files } }
}

console.log('── 单位换算')
check('逻辑像素 → rem(根字号 16)', () => {
  assert.equal(remText(13), '0.8125rem')
  assert.equal(remText(1), '0.0625rem')
  assert.equal(remText(0), '0')
  assert.equal(remText(640), '40rem')
  assert.equal(describePx(40), '2.5rem · 40px')
})
check('吸附步长与上下限', () => {
  assert.equal(snapPx(41, 2, 0, 100), 42)
  assert.equal(snapPx(-5, 2, 0, 100), 0)
  assert.equal(snapPx(999, 2, 0, 100), 100)
  assert.equal(snapPx(41.3, 0, 0, 100), 41.3)
})

console.log('── 默认模板导出')
const doc = defaultDoc()
const pkg = buildPackage(doc, assets)
const issues = lintPackage(pkg, PAGES)

check('体检零错误零提醒', () => {
  for (const i of issues) console.log(`    ${i.level} [${i.check}] ${i.file}: ${i.message}`)
  assert.equal(issues.length, 0)
})
check('规格包文件齐全(§13.3):注册表全部组件的 css 与演示页俱全', () => {
  assert.equal(RECIPES.length, 53)
  for (const f of [
    'README-给AI.md',
    'page-template.html',
    'tokens.css',
    'reset.css',
    'fonts/fonts.css',
    'components/_demo.css',
    'pages/home.md',
    'pages/home.css',
    'pages/home.html',
    'icons/arrow-right.svg',
    'icons/timer.svg',
    'icons/music.svg',
    'icons/dumbbell.svg',
    'icons/ellipsis.svg',
    'icons/check.svg',
    'icons/search.svg',
    'icons/bell.svg',
    'icons/chevron-right.svg',
    'design.json',
    'LICENSES.md'
  ]) {
    assert.ok(f in pkg.files, `缺文件 ${f}`)
  }
  for (const r of RECIPES) {
    assert.ok(`components/${r.id}.css` in pkg.files, `缺组件样式 ${r.id}`)
    assert.ok(`components/${r.id}.html` in pkg.files, `缺演示页 ${r.id}`)
  }
  assert.match(pkg.folderName, /^UI规格包_落地页示例_20261002-1200$/)
})
check('组件变量默认引用基础变量,基础变量为 rem', () => {
  const css = pkg.files['tokens.css']
  assert.match(css, /--btn-height-md: var\(--control-md\);/)
  assert.match(css, /--control-md: 2\.5rem;/)
  assert.match(css, /--page-hero-title-tracking: -0\.02em;/)
  assert.match(css, /--color-primary: #2563EB;/)
  assert.equal(resolvePx(doc.tokens, 'btn-height-md'), 40)
})
check('组件变量随容器亮暗重新取值(引用颜色/阴影的变量在 [data-theme] 上重声明)', () => {
  assert.match(
    pkg.files['tokens.css'],
    /:root,\n\[data-theme\] \{[\s\S]*--card-shadow: var\(--shadow-sm\);/
  )
})
check('组件 CSS 无演示 class,演示 CSS 有状态模拟', () => {
  for (const r of RECIPES) {
    assert.doesNotMatch(pkg.files[`components/${r.id}.css`], /is-hover|\.demo/, r.id)
  }
  assert.match(pkg.files['components/button.css'], /\.btn--solid:hover:not\(:disabled\)/)
  assert.match(pkg.files['components/_demo.css'], /\.btn--solid\.is-hover/)
})
check('表单组件走真实状态属性,不用 class 模拟勾选', () => {
  const swCss = pkg.files['components/switch.css']
  assert.match(swCss, /\.sw__in:checked \+ \.sw__thumb/)
  assert.match(pkg.files['components/checkbox.html'], /checked/)
  assert.match(pkg.files['components/checkbox.html'], /disabled/)
  assert.match(pkg.files['components/input.html'], /placeholder="输入内容"/)
})
check('导出 HTML 无画布痕迹,元素之间无空白(规则 13)', () => {
  for (const f of ['pages/home.html', ...RECIPES.map((r) => `components/${r.id}.html`)]) {
    const html = pkg.files[f]
    assert.doesNotMatch(html, /data-uf-/, `${f} 带了画布属性`)
    const body = html.slice(html.indexOf('<body>'), html.indexOf('</body>'))
    assert.doesNotMatch(body, />\s+</, `${f} 的 body 里元素之间有空白`)
  }
})
check('图标:icons/*.svg 与页面内联为同一份原文', () => {
  const inline = svgText(iconNodes['arrow-right'])
  assert.ok(pkg.files['icons/arrow-right.svg'].includes(inline))
  assert.ok(pkg.files['pages/home.html'].includes(inline))
})
check('页面骨架含 viewport 与全部样式引用(规则 10)', () => {
  const tpl = pkg.files['page-template.html']
  assert.match(tpl, /name="viewport"/)
  for (const href of [
    'fonts/fonts.css',
    'tokens.css',
    'reset.css',
    'components/button.css',
    'pages/home.css'
  ]) {
    assert.ok(tpl.includes(`href="${href}"`), `骨架缺 ${href}`)
  }
  assert.doesNotMatch(tpl, /_demo\.css/)
})
check('README 带「必须停下」硬规则与自检清单', () => {
  const readme = pkg.files['README-给AI.md']
  assert.match(readme, /必须停下并在回复中列出疑问/)
  assert.match(readme, /交付前自检清单/)
})
check('字体:打包清单与 node_modules 实物一致', () => {
  const inter = pkg.fonts.find((p) => p.dir === 'inter')
  const noto = pkg.fonts.find((p) => p.dir === 'noto-sans-sc')
  assert.equal(inter?.files.length, 7)
  assert.ok((noto?.files.length ?? 0) > 90)
  for (const p of pkg.fonts) {
    for (const f of p.files) {
      const pkgName = p.dir === 'inter' ? 'inter' : 'noto-sans-sc'
      assert.ok(
        existsSync(join(NM, '@fontsource-variable', pkgName, 'files', f)),
        `字体文件不存在 ${f}`
      )
    }
  }
  assert.match(pkg.files['fonts/fonts.css'], /url\(\.\/inter\/inter-latin-wght-normal\.woff2\)/)
})
check('lucide 版本号与 package.json 锁定版本一致', () => {
  const installed = JSON.parse(read('lucide-static/package.json')) as { version: string }
  const own = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
    devDependencies: Record<string, string>
  }
  assert.equal(installed.version, LUCIDE_VERSION)
  assert.equal(own.devDependencies['lucide-static'], LUCIDE_VERSION)
})
check('导出结果确定:同一方案两次导出逐字相同', () => {
  assert.deepEqual(buildPackage(defaultDoc(), assets).files, pkg.files)
})

console.log('── 拖动改值后的导出')
check('组件变量改为具体数值后:tokens.css 与 design.json 同步,体检仍零错误', () => {
  const edited: UiFrameDoc = defaultDoc()
  edited.tokens['btn-height-md'] = {
    ...edited.tokens['btn-height-md'],
    value: { kind: 'dimension', px: 44 }
  }
  const p2 = buildPackage(edited, assets)
  assert.match(p2.files['tokens.css'], /--btn-height-md: 2\.75rem;/)
  assert.match(p2.files['design.json'], /"value": 2\.75/)
  assert.equal(hasErrors(lintPackage(p2, PAGES)), false)
})

console.log('── 体检拦得住实测缺口(§23.2)')
check('含糊词:「可从 Google Fonts 引入」', () => {
  const p = clonePkg(pkg)
  p.files['README-给AI.md'] += '\n字体可从 Google Fonts 引入。\n'
  assert.ok(errorsOf(lintPackage(p, PAGES), '含糊词').length > 0)
})
check('写死数值:组件 CSS 出现 40px / 页面 CSS 出现 #fff', () => {
  const p = clonePkg(pkg)
  p.files['components/button.css'] += '\n.btn--wide { width: 40px; }\n'
  p.files['pages/home.css'] += '\n.page-x { color: #fff; line-height: 1.5; }\n'
  assert.equal(errorsOf(lintPackage(p, PAGES), '写死数值').length, 3)
})
check('缺标签与属性:<a> 无 href、<button> 无 type', () => {
  const bad: PageNode[] = [
    { tag: 'nav', cls: 'page-nav', children: [{ tag: 'a', text: '功能' }] },
    { tag: 'button', cls: 'btn', text: '登录' }
  ]
  assert.equal(errorsOf(lintPackage(pkg, { 'pages/x.md': bad }), '缺标签与属性').length, 2)
})
check('演示代码泄漏:组件 CSS 出现 .is-hover', () => {
  const p = clonePkg(pkg)
  p.files['components/button.css'] +=
    '\n.btn--solid.is-hover { background: var(--color-primary-hover); }\n'
  assert.ok(errorsOf(lintPackage(p, PAGES), '演示代码泄漏').length > 0)
})
check('引用失效:变量不存在、文件不存在、路径出包', () => {
  const p = clonePkg(pkg)
  p.files['components/card.css'] += '\n.card { gap: var(--space-99); }\n'
  p.files['pages/home.html'] = p.files['pages/home.html'].replace(
    '../tokens.css',
    '../../tokens.css'
  )
  p.files['page-template.html'] = p.files['page-template.html'].replace('reset.css', 'missing.css')
  const found = errorsOf(lintPackage(p, PAGES), '引用失效').map((i) => i.message)
  assert.ok(found.some((m) => m.includes('--space-99')))
  assert.ok(found.some((m) => m.includes('规格包外')))
  assert.ok(found.some((m) => m.includes('missing.css')))
})
check('数据含描述文字:design.json 写了自然语言', () => {
  const p = clonePkg(pkg)
  const json = JSON.parse(p.files['design.json']) as Record<
    string,
    Record<string, Record<string, unknown>>
  >
  json['btn']['border-width']['$value'] = '1px solid(solid变体为transparent)'
  p.files['design.json'] = JSON.stringify(json)
  assert.ok(errorsOf(lintPackage(p, PAGES), '数据含描述文字').length > 0)
})
check('三份数据不一致:tokens.css 被单独改动', () => {
  const p = clonePkg(pkg)
  p.files['tokens.css'] = p.files['tokens.css'].replace(
    '--control-md: 2.5rem;',
    '--control-md: 2.6rem;'
  )
  assert.ok(
    errorsOf(lintPackage(p, PAGES), '三份数据不一致').some((i) =>
      i.message.includes('--control-md')
    )
  )
})
check('行内间距依赖:父级不是 flex 时提醒', () => {
  const inline: PageNode[] = [
    {
      tag: 'div',
      cls: 'plain',
      children: [
        { tag: 'a', attrs: { href: '#' } },
        { tag: 'a', attrs: { href: '#' } }
      ]
    }
  ]
  assert.ok(lintPackage(pkg, { 'pages/x.md': inline }).some((i) => i.check === '行内间距依赖'))
})

console.log('── 变量板(§5.5)')
check('每个基础变量在板上各有一个条目,part 为 tok:<名>且一一对应', () => {
  const parts: string[] = []
  const walk = (n: PageNode): void => {
    if (n.part) parts.push(n.part)
    n.children?.forEach(walk)
  }
  boardBody(doc).forEach(walk)
  const base = Object.keys(doc.tokens).filter((n) => doc.tokens[n].tier === 'base')
  assert.equal(parts.length, base.length)
  for (const p of parts) {
    assert.ok(p.startsWith('tok:'), `part 不是 tok: 前缀 ${p}`)
    assert.ok(doc.tokens[p.slice(4)], `板上 part 无对应变量 ${p}`)
  }
  for (const n of base) assert.ok(parts.includes(`tok:${n}`), `变量 ${n} 没上板`)
})
check('变量板读数:dimension 给 rem+px,颜色给亮暗两值', () => {
  assert.equal(boardValueText(doc, 'control-md'), '2.5rem · 40px')
  assert.equal(boardValueText(doc, 'color-primary'), '#2563EB / #60A5FA')
})
check('变量板样式全走变量引用,色板同时给亮暗两个 data-theme 小样', () => {
  const css = rulesCss(boardCss())
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}|\d+px/)
  const html = htmlDocument({
    title: '变量板',
    body: boardBody(doc),
    styles: ['fonts', 'tokens', 'reset', 'board'],
    ctx: { mode: 'export', icons: doc.icons, lookup: assets.lookup },
    styleMode: { kind: 'inline', texts: { ...styleTexts(doc, ''), board: css } }
  })
  assert.match(
    html,
    /<span data-theme="light" style="background: var\(--color-primary\)"><\/span><span data-theme="dark"/
  )
})

console.log('── 画布与导出同源')
check('画布模式只多 data-uf-* 属性,其余逐字相同', () => {
  const texts = styleTexts(doc, '')
  const make = (mode: 'canvas' | 'export'): string =>
    htmlDocument({
      title: 't',
      body: HOME_PAGE.body,
      styles: PAGE_STYLES,
      ctx: { mode, icons: doc.icons, lookup: assets.lookup },
      styleMode: { kind: 'inline', texts }
    })
  const canvas = make('canvas')
  assert.match(canvas, /data-uf-part="btn-lg"/)
  assert.equal(canvas.replace(/ data-uf-(part|icon)="[^"]*"/g, ''), make('export'))
})

console.log('── 模板与方案(M1-c)')
check('首批模板 4 个:2 电脑 + 2 手机,空白起步不在模板表里', () => {
  assert.equal(TEMPLATES.length, 4)
  assert.equal(TEMPLATES.filter((t) => t.platform === 'desktop').length, 2)
  assert.equal(TEMPLATES.filter((t) => t.platform === 'phone').length, 2)
  assert.ok(TEMPLATES.every((t) => t.id !== BLANK_ID))
  for (const t of TEMPLATES) {
    assert.ok(t.name && t.style && t.blurb, `模板 ${t.id} 缺名/风格/简介`)
  }
})
check('模板覆盖值落在变量表上,平台与户口名正确', () => {
  const tint = templateDoc('tint-phone')
  assert.equal(tint.platform, 'phone')
  assert.equal(tint.template, 'tint-phone')
  assert.deepEqual(tint.tokens['color-primary']?.value, {
    kind: 'color',
    light: '#6750A4',
    dark: '#D0BCFF'
  })
  assert.deepEqual(tint.tokens['btn-radius']?.value, { kind: 'ref', ref: 'radius-full' })
  const blank = templateDoc(BLANK_ID, 'phone')
  assert.equal(blank.platform, 'phone')
  assert.equal(blank.template, BLANK_ID)
  // 空白起步 = 中性默认值:主色仍是默认蓝
  assert.deepEqual(blank.tokens['color-primary']?.value, doc.tokens['color-primary'].value)
})
check('四个模板都能过体检(各自建包 lint 零错误)', () => {
  for (const t of TEMPLATES) {
    const d = templateDoc(t.id)
    const p = buildPackage(d, assets)
    const errs = lintPackage(p, pagesForDoc(d)).filter((i) => i.level === 'error')
    for (const i of errs) console.log(`    ${t.id}: [${i.check}] ${i.file}: ${i.message}`)
    assert.equal(errs.length, 0, `模板 ${t.id} 体检有错误`)
  }
})
check('方案序列化往返:serializeDoc → parseDoc 变量、图标、户口名一致', () => {
  const edited = templateDoc('modern-desk')
  edited.name = '测试方案甲'
  edited.tokens['btn-height-md'] = {
    ...edited.tokens['btn-height-md'],
    value: { kind: 'dimension', px: 44 }
  }
  edited.icons['demo-button'] = 'star'
  const back = parseDoc(serializeDoc(edited))
  assert.equal(back.name, '测试方案甲')
  assert.equal(back.platform, 'desktop')
  assert.equal(back.template, 'modern-desk')
  assert.deepEqual(back.tokens['btn-height-md'], edited.tokens['btn-height-md'])
  assert.equal(back.icons['demo-button'], 'star')
})
check('parseDoc 清洗:坏 kind 变量剔除、缺变量补默认、版本不符抛错', () => {
  const raw = JSON.parse(serializeDoc(doc)) as Record<string, unknown>
  const tokens = raw['tokens'] as Record<string, unknown>
  tokens['evil'] = { path: ['x', 'y'], label: '坏', tier: 'base', value: { kind: 'alien' } }
  delete tokens['color-primary']
  const back = parseDoc(JSON.stringify(raw))
  assert.ok(!('evil' in back.tokens), '坏 kind 的变量必须被剔除')
  assert.ok(back.tokens['color-primary'], '缺的变量要补回默认模板值')
  assert.throws(() => parseDoc('{"schemaVersion":99,"tokens":{}}'), /版本不支持/)
})
check('方案 id 合法化:中文保留、特殊字符清洗、纯符号兜底时间戳', () => {
  assert.equal(schemeIdFromName('我的 方案!', '20261002-1200'), '我的-方案')
  assert.equal(schemeIdFromName('  //..//  ', '20261002-1200'), '方案-20261002-1200')
  assert.equal(schemeIdFromName('', '20261002-1200'), '方案-20261002-1200')
})
check('manifestFor 与快照名:格式版本、模板户口、时间戳形态', () => {
  const m = manifestFor(doc, {
    id: 'x',
    style: '极简中性',
    createdAt: '2026-01-01T00:00:00.000Z',
    appVersion: '0.2.0'
  })
  assert.equal(m.formatVersion, 1)
  assert.equal(m.template, doc.template)
  assert.equal(m.createdAt, '2026-01-01T00:00:00.000Z')
  assert.match(snapshotStamp(new Date('2026-10-02T12:03:04')), /^20261002-120304$/)
  assert.match('20261002-120304.json', SNAPSHOT_RE)
})
check('.uiframe zip(§15):打包解包往返,成员齐全,版本/非 zip 拒绝', () => {
  const manifest = JSON.stringify(
    manifestFor(doc, {
      id: 'x',
      style: '极简中性',
      createdAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.2.0'
    })
  )
  const design = serializeDoc(doc)
  const thumb = new Uint8Array([137, 80, 78, 71])
  const zipped = packUiframe({ manifest, design, thumbnail: thumb })
  // zip 魔数 PK
  assert.equal(zipped[0], 0x50)
  assert.equal(zipped[1], 0x4b)
  const back = unpackUiframe(zipped)
  assert.equal(back.design, design)
  assert.equal(back.manifest, manifest)
  assert.deepEqual([...back.thumbnail!], [137, 80, 78, 71])
  // 解出的 design 直接过 parseDoc,和原 doc 等价
  assert.deepEqual(parseDoc(back.design), doc)
  // 自定义图标成员落在 assets/icons/ 下(M3-e 预位)
  const withIcon = packUiframe({
    manifest,
    design,
    icons: { 'x.svg': new TextEncoder().encode('<svg/>') }
  })
  const backIcon = unpackUiframe(withIcon)
  assert.ok('x.svg' in backIcon.icons, 'icons 成员应留在 assets/icons/ 下')
  // 版本不符与非 zip 都要拦(版本不对的包绕过打包校验,直接 zipSync 造)
  const badVer = zipSync({
    'manifest.json': strToU8(JSON.stringify({ formatVersion: 99 })),
    'design.json': strToU8(design)
  })
  assert.throws(() => unpackUiframe(badVer), /版本不支持/)
  assert.throws(() => unpackUiframe(new TextEncoder().encode('not a zip')), /有效的方案文件/)
  assert.throws(() => packUiframe({ manifest: '{"formatVersion":2}', design }), /版本不对/)
})

console.log('── 导入(M1-d,§14)')
check('导出 design.json → 导回:全部变量数值逐字一致(往返验收)', () => {
  const exported = pkg.files['design.json']
  const back = importDtcg(exported, '回读')
  // DTCG 只带数值(与图标/平台/根字号);逐变量比对 value
  for (const [name, def] of Object.entries(doc.tokens)) {
    assert.deepEqual(back.doc.tokens[name]?.value, def.value, `往返不一致:${name}`)
  }
  assert.equal(back.doc.platform, doc.platform)
  assert.equal(back.doc.rootFontPx, doc.rootFontPx)
  assert.equal(back.doc.icons['demo-button'], doc.icons['demo-button'])
  assert.equal(back.applied, Object.keys(doc.tokens).length)
  assert.deepEqual(back.skipped, [])
})
check('外来的 DTCG:同名变量被套用,生面孔记 skipped,引用链还原', () => {
  const foreign = JSON.stringify({
    color: {
      primary: { $type: 'color', $value: { hex: '#123456' } },
      'brand-new': { $type: 'color', $value: { hex: '#abcdef' } }
    },
    control: { md: { $type: 'dimension', $value: { value: 3, unit: 'rem' } } },
    btn: { 'height-md': { $type: 'dimension', $value: '{control.md}' } }
  })
  const r = importDtcg(foreign, '外来')
  assert.deepEqual(r.doc.tokens['color-primary']?.value, {
    kind: 'color',
    light: '#123456',
    dark: '#123456'
  })
  assert.deepEqual(r.doc.tokens['control-md']?.value, { kind: 'dimension', px: 48 })
  assert.deepEqual(r.doc.tokens['btn-height-md']?.value, { kind: 'ref', ref: 'control-md' })
  assert.ok(r.skipped.includes('color-brand-new'))
})
check('CSS 变量:按既有 kind 猜值; var()→ref; 不认识的名字跳过', () => {
  const r = importCssVars(
    `:root{--color-primary:#00ff00;--space-4:1.25rem;--btn-height-md:var(--control-lg);--nope:9px;}`,
    '粘贴'
  )
  assert.equal(r.applied, 3)
  assert.deepEqual(r.doc.tokens['color-primary']?.value, {
    kind: 'color',
    light: '#00FF00',
    dark: '#00FF00'
  })
  assert.deepEqual(r.doc.tokens['space-4']?.value, { kind: 'dimension', px: 20 })
  assert.deepEqual(r.doc.tokens['btn-height-md']?.value, { kind: 'ref', ref: 'control-lg' })
  assert.ok(r.skipped.includes('nope'))
})
check('CSS 变量:阴影与字体族按既有 kind 解析', () => {
  const r = importCssVars(
    `--shadow-sm:0 2px 8px rgba(0,0,0,0.2);--font-family:"My Sans",Inter,sans-serif;`,
    'x'
  )
  const shadow = r.doc.tokens['shadow-sm']?.value
  assert.equal(shadow?.kind, 'shadow')
  if (shadow?.kind === 'shadow') {
    assert.equal(shadow.y, 2)
    assert.equal(shadow.blur, 8)
    assert.equal(shadow.light, 'rgba(0,0,0,0.2)')
  }
  assert.deepEqual(r.doc.tokens['font-family']?.value, {
    kind: 'fontFamily',
    families: ['My Sans', 'Inter', 'sans-serif']
  })
})
check('方案文件夹:内部 design.json 直接还原;导出的 DTCG 包也能走方案入口', () => {
  const own = serializeDoc(templateDoc('tint-phone'))
  const r1 = importSchemeFiles('{"name":"库名"}', own, 'x')
  assert.equal(r1.doc.name, '库名')
  assert.equal(r1.doc.template, 'tint-phone')
  const r2 = importSchemeFiles(null, pkg.files['design.json'], '导出包')
  assert.equal(r2.applied, Object.keys(doc.tokens).length)
})
check('全对不上时报人话错误,不静默产空方案', () => {
  assert.throws(() => importDtcg('{"foo":{"bar":{"$value":1}}}', 'x'), /没认出任何变量/)
  assert.throws(() => importCssVars('body{color:red}', 'x'), /没在文本里找到/)
})

console.log('── 设备与手机端画布(M1-e,§5.4)')
check('设备预设:桌面 3 档 + 手机 3 档,各有默认档', () => {
  assert.equal(devicesFor('desktop').length, 3)
  assert.equal(devicesFor('phone').length, 3)
  assert.equal(defaultDeviceId('desktop'), 'desktop-1280')
  assert.equal(defaultDeviceId('phone'), 'phone-390')
  assert.ok(isDeviceId('phone', 'phone-430'))
  assert.ok(!isDeviceId('phone', 'desktop-1280'))
})
check('deviceFor 兜底:未知 id / 跨平台 id 都回平台默认档', () => {
  assert.equal(deviceFor({ platform: 'phone', device: 'bogus' }).id, 'phone-390')
  assert.equal(deviceFor({ platform: 'desktop', device: 'phone-390' }).id, 'desktop-1280')
  const d390 = deviceFor({ platform: 'phone', device: 'phone-390' })
  assert.equal(d390.width, 390)
  assert.equal(d390.statusBar, 54)
  assert.equal(d390.island, true)
})
check('手机方案的规格包:出 pages/app.* 而不是 pages/home.*', () => {
  const phone = templateDoc('tint-phone')
  assert.equal(phone.platform, 'phone')
  assert.equal(phone.device, 'phone-390')
  const p = buildPackage(phone, assets)
  assert.ok(p.files['pages/app.html'])
  assert.ok(p.files['pages/app.md'])
  assert.ok(p.files['pages/app.css'])
  assert.ok(!('pages/home.html' in p.files), '手机包里不该有桌面页')
  assert.ok(!('pages/home.css' in p.files), '手机包里不该有桌面页样式')
  // 体检:手机页面结构树 + 全量组件演示页,零错误
  const errs = lintPackage(p, pagesForDoc(phone)).filter((i) => i.level === 'error')
  for (const i of errs) console.log(`    phone: [${i.check}] ${i.file}: ${i.message}`)
  assert.equal(errs.length, 0)
  // 预览清单:页面截图按设备尺寸
  const pv = p.previews[p.previews.length - 1]
  assert.equal(pv.html, 'pages/app.html')
  assert.equal(pv.width, 390)
  assert.equal(pv.height, 844)
  // design.json 带设备口径,导回能还原
  const dj = JSON.parse(p.files['design.json']) as Record<string, unknown>
  const ext = (dj['$extensions'] as Record<string, unknown>)['com.codeatlas.uiframe'] as Record<
    string,
    unknown
  >
  assert.equal(ext['device'], 'phone-390')
  const back = importDtcg(p.files['design.json'], '回读')
  assert.equal(back.doc.device, 'phone-390')
})
check('parseDoc:非法设备 id 回默认档,跨平台 id 不认', () => {
  const raw = JSON.parse(serializeDoc(doc)) as Record<string, unknown>
  raw['device'] = 'phone-390' // 平台是 desktop,这个 id 不属于它
  assert.equal(parseDoc(JSON.stringify(raw)).device, 'desktop-1280')
  const raw2 = JSON.parse(serializeDoc(templateDoc('tint-phone'))) as Record<string, unknown>
  raw2['device'] = 'phone-430'
  assert.equal(parseDoc(JSON.stringify(raw2)).device, 'phone-430')
})
check('示例页结构与文件随平台走:pageFor 与画布同源', () => {
  const desk = pageFor('desktop')
  const phone = pageFor('phone')
  assert.equal(desk.htmlPath, 'pages/home.html')
  assert.equal(phone.htmlPath, 'pages/app.html')
  assert.notEqual(desk.specPath, phone.specPath)
  // 手机示例页引用了它声明的全部组件样式(icon-button/input/tabs/list-row/switch/button)
  for (const s of phone.styles.filter((k) => k.startsWith('comp-'))) {
    assert.ok(
      RECIPES.some((r) => `comp-${r.id}` === s),
      `app 页声明了未注册的组件样式:${s}`
    )
  }
})

console.log('── 平台规范校验(M1-f,§5.7)')
check('对比度算法:黑白 21:1、同色 1:1、参数顺序无关', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff') ?? 0), 21)
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1)
  assert.equal(contrastRatio('#123', '#112233'), contrastRatio('#112233', '#123'))
})
check('最小点击区分平台:同一值 30px,桌面放行、手机拦', () => {
  const d = defaultDoc()
  d.tokens['control-sm'] = { ...d.tokens['control-sm'], value: { kind: 'dimension', px: 30 } }
  const desk = platformIssues(d).filter((i) => i.rule === '最小点击区' && i.target === 'control-sm')
  assert.equal(desk.length, 0)
  const p = { ...d, platform: 'phone' as const, device: 'phone-390' }
  const phone = platformIssues(p).filter(
    (i) => i.rule === '最小点击区' && i.target === 'control-sm'
  )
  assert.equal(phone.length, 1)
  assert.ok(phone[0].message.includes('44'))
})
check('正文字号下限随平台:font-size-md=13 手机拦、桌面放行', () => {
  const d = defaultDoc()
  d.tokens['font-size-md'] = { ...d.tokens['font-size-md'], value: { kind: 'dimension', px: 13 } }
  assert.equal(
    platformIssues(d).filter((i) => i.rule === '正文字号下限').length,
    0,
    '桌面 12px 下限,13 放行'
  )
  const p = { ...d, platform: 'phone' as const, device: 'phone-390' }
  assert.equal(platformIssues(p).filter((i) => i.rule === '正文字号下限').length, 1)
})
check('引用失效是 error 级;非整数 px 与离网格间距分别拦', () => {
  const d = defaultDoc()
  d.tokens['btn-height-md'] = { ...d.tokens['btn-height-md'], value: { kind: 'ref', ref: 'ghost' } }
  d.tokens['space-4'] = { ...d.tokens['space-4'], value: { kind: 'dimension', px: 21 } }
  d.tokens['card-padding'] = { ...d.tokens['card-padding'], value: { kind: 'dimension', px: 24.5 } }
  const list = platformIssues(d)
  const dead = list.find((i) => i.rule === '引用失效')
  assert.equal(dead?.level, 'error')
  assert.ok(list.some((i) => i.rule === '非步长数值' && i.target === 'space-4'))
  assert.ok(list.some((i) => i.rule === '非步长数值' && i.target === 'card-padding'))
})
check('刻意值豁免:radius-full=999、1px 描边、3px 开关内缩不报非步长', () => {
  const list = platformIssues(defaultDoc())
  for (const n of ['radius-full', 'border-width-1', 'sw-inset-md']) {
    assert.ok(!list.some((i) => i.rule === '非步长数值' && i.target === n), `${n} 不该被判非步长`)
  }
})
check('状态缺失:无交互组件(卡片/提示气泡)不查,焦点态两端都查、悬停态仅桌面', () => {
  const desk = platformIssues(defaultDoc())
  assert.equal(desk.filter((i) => i.rule === '悬停态缺失').length, 0, '交互组件都该有悬停态')
  assert.equal(desk.filter((i) => i.rule === '焦点态缺失').length, 0)
  assert.ok(!desk.some((i) => i.target === '组件:card'), '卡片不是交互组件,不该被查')
})
check('默认方案提示有价值:桌面与手机都检出边界对比度与点击区提醒', () => {
  const desk = platformIssues(defaultDoc())
  assert.ok(desk.some((i) => i.rule === '控件边界对比度'))
  assert.ok(desk.some((i) => i.rule === '最小点击区' && i.target === 'icon-md'))
  const phone = platformIssues(templateDoc('tint-phone'))
  assert.ok(phone.some((i) => i.rule === '最小点击区' && i.target === 'control-md'))
  assert.ok(!phone.some((i) => i.rule === '悬停态缺失'), '手机不查悬停态')
})
check('D9 加强档(§5.7):字号下限 +2、文字对比度 7:1、边界 4.5:1,消息带标记', () => {
  const d = defaultDoc()
  d.tokens['font-size-md'] = { ...d.tokens['font-size-md'], value: { kind: 'dimension', px: 13 } }
  assert.equal(
    platformIssues(d).filter((i) => i.rule === '正文字号下限').length,
    0,
    '桌面 12px 下限,13 放行'
  )
  const enhanced = { ...d, a11yEnhanced: true }
  const list = platformIssues(enhanced)
  assert.equal(list.filter((i) => i.rule === '正文字号下限').length, 1, '加强档 14px 下限,13 拦')
  assert.ok(list.find((i) => i.rule === '正文字号下限')?.message.includes('加强档'))
  assert.ok(
    list.every((i) => i.rule !== '文字对比度' || i.message.includes('7')),
    '加强档文字对比度按 7:1 卡'
  )
  // 边界用例:4.5~7 之间的对比度,普通档放行、加强档拦(#707070 对 #FAFAF9 ≈4.64;暗色档保持默认)
  const mid = defaultDoc()
  const darkText =
    mid.tokens['color-text'].value.kind === 'color'
      ? mid.tokens['color-text'].value.dark
      : '#F8FAFC'
  mid.tokens['color-text'] = {
    ...mid.tokens['color-text'],
    value: { kind: 'color', light: '#707070', dark: darkText }
  }
  const midIssues = platformIssues(mid).filter(
    (i) => i.rule === '文字对比度' && i.target === 'color-text'
  )
  const midEnhanced = platformIssues({ ...mid, a11yEnhanced: true }).filter(
    (i) => i.rule === '文字对比度' && i.target === 'color-text'
  )
  assert.equal(midIssues.length, 0, '4.64:1 过 AA 4.5')
  assert.ok(midEnhanced.length >= 1, '4.64:1 不过 AAA 7,加强档拦')
})
check('a11yEnhanced/targetStack 字段随 design.json 往返', () => {
  const d = { ...defaultDoc(), a11yEnhanced: true, targetStack: 'Tauri + Vue' }
  const back = parseDoc(serializeDoc(d))
  assert.equal(back.a11yEnhanced, true)
  assert.equal(back.targetStack, 'Tauri + Vue')
  const plain = parseDoc(serializeDoc(defaultDoc()))
  assert.equal(plain.a11yEnhanced, undefined, '老方案没这个字段,不能冒出加强档')
  assert.equal(plain.targetStack, undefined)
})

console.log('── 导出适配器(M1-g,§13.5)')
check('Tailwind @theme:命名空间归位、ref 解为字面值、暗色值进 [data-theme] 块', () => {
  const css = tailwindThemeCss(doc)
  assert.ok(css.includes('@theme {'), '必须有 @theme 块')
  assert.ok(css.includes('--color-primary: #2563EB;'))
  assert.ok(css.includes('--spacing-4: 1rem;'), 'space-4 归位 spacing')
  assert.ok(css.includes('--text-md: '), 'font-size 归位 text')
  assert.ok(css.includes('--font-sans:'), 'font-family 改名 font-sans')
  assert.ok(css.includes("[data-theme='dark']"))
  assert.ok(css.includes('--color-primary: #60A5FA;'), '暗色档值写进暗色块')
  assert.ok(css.includes('--control-md: '), '无归位的变量原样保留')
  assert.ok(!css.includes('var(--'), 'ref 必须解成字面值')
})
check('RN 主题对象:亮暗分桶、尺寸出数值、字族出数组、ref 解到底', () => {
  const ts = reactNativeThemeTs(doc)
  assert.ok(ts.includes('export const uiTheme'))
  assert.ok(ts.includes('light: {') && ts.includes('dark: {'), '亮暗分桶')
  assert.ok(ts.includes('primary: "#2563EB"') || ts.includes("primary: '#2563EB'"))
  assert.ok(ts.includes('heightMd: 40'), 'btn-height-md 经 ref 解析为 40')
  assert.ok(/family:\s*\[/.test(ts), '字族出数组')
  assert.ok(/offset:\s*{/.test(ts), '阴影出 RN 结构')
  assert.ok(!ts.includes('undefined'), '不许出现未解析值')
})
check('Flutter ThemeData:颜色出 0xAARRGGBB、亮暗双 ThemeData、ref 解为字面值', () => {
  const dart = flutterThemeDart(doc)
  assert.ok(dart.includes("import 'package:flutter/material.dart';"))
  assert.ok(dart.includes('ThemeData uiThemeLight()') && dart.includes('ThemeData uiThemeDark()'))
  assert.ok(dart.includes('lightColorPrimary = Color(0xFF2563EB)'), '亮色 6 位 hex → FF 前缀')
  assert.ok(dart.includes('darkColorPrimary = Color(0xFF60A5FA)'), '暗色独立成常量')
  assert.ok(/double\s+controlMd\s*=\s*40/.test(dart), '尺寸 ref 解成数字')
  assert.ok(!dart.includes('var(--'), 'ref 必须解成字面值')
  const ov = flutterThemeDart(templateDoc('tint-phone'))
  assert.ok(/0x[0-9A-F]{8}/.test(ov), 'rgba 遮罩色要转出 8 位 ARGB')
})
check('Tailwind @theme 导入:命名空间逆归位、暗色块并回 dark 端(§13.5 往返)', () => {
  const css = tailwindThemeCss(doc)
  const r = importCssVars(css, 'tw 主题')
  assert.equal(r.sourceLabel, 'Tailwind @theme')
  assert.deepEqual(r.doc.tokens['color-primary']?.value, {
    kind: 'color',
    light: '#2563EB',
    dark: '#60A5FA'
  })
  assert.deepEqual(r.doc.tokens['space-4']?.value, { kind: 'dimension', px: 16 })
  assert.equal(r.doc.tokens['font-family']?.value.kind, 'fontFamily', 'font-sans 归位 font-family')
  const v = r.doc.tokens['control-md']?.value
  assert.ok(v && 'px' in v && v.px === 40, '无归位变量按原名对上')
})
check('外来 Tailwind 主题:非本家名字入 skipped,同语义变量仍对上', () => {
  const r = importCssVars(
    `@theme { --color-primary:#123456; --spacing-4:2rem; --color-weird-99:#000000; }`,
    '外来'
  )
  assert.deepEqual(r.doc.tokens['color-primary']?.value, {
    kind: 'color',
    light: '#123456',
    dark: '#123456'
  })
  assert.deepEqual(r.doc.tokens['space-4']?.value, { kind: 'dimension', px: 32 })
  assert.ok(r.skipped.includes('color-weird-99'))
})
check('规格包含三个适配器文件,体检仍零错误零提醒', () => {
  const p = buildPackage(doc, assets)
  assert.ok(p.files['adapters/tailwind.theme.css'].includes('@theme'))
  assert.ok(p.files['adapters/uiTheme.ts'].includes('export const uiTheme'))
  assert.ok(p.files['adapters/ui_theme.dart'].includes('ThemeData uiThemeLight'))
  const errs = lintPackage(p, PAGES).filter((i) => i.level === 'error')
  for (const i of errs) console.log(`    [${i.check}] ${i.file}: ${i.message}`)
  assert.equal(errs.length, 0)
})

console.log('── M1 收口:全链路验收(§19 M1 标准)')
check('空白起步:空方案也产出零错误的完整规格包', () => {
  const d = templateDoc(BLANK_ID)
  const p = buildPackage(d, assets)
  const errs = lintPackage(p, pagesForDoc(d)).filter((i) => i.level === 'error')
  for (const i of errs) console.log(`    [${i.check}] ${i.file}: ${i.message}`)
  assert.equal(errs.length, 0)
})
check('全部模板 × 双平台:8 种组合出包体检全零错误', () => {
  for (const t of TEMPLATES) {
    for (const platform of ['desktop', 'phone'] as const) {
      const d = { ...templateDoc(t.id), platform, device: defaultDeviceId(platform) }
      const errs = lintPackage(buildPackage(d, assets), pagesForDoc(d)).filter(
        (i) => i.level === 'error'
      )
      assert.equal(
        errs.length,
        0,
        `${t.id}/${platform}: ${errs.map((i) => `${i.check}→${i.file}`).join(' | ')}`
      )
    }
  }
})
check('确定性导出:同一份数据两次出包,文件集合与逐字节内容一致', () => {
  const a = buildPackage(doc, assets)
  const b = buildPackage(doc, assets)
  assert.deepEqual(Object.keys(a.files).sort(), Object.keys(b.files).sort())
  for (const k of Object.keys(a.files)) {
    assert.equal(a.files[k], b.files[k], `${k} 两次产出不一致`)
  }
})
check('README 文件索引 ↔ 产物一一对应:索引条目全在包内,包内文件全被索引', () => {
  const indexed = new Set(fileIndex(doc, iconFileNames(doc)).map(([p]) => p))
  const emitted = new Set(Object.keys(pkg.files))
  for (const p of indexed) {
    if (p.endsWith('/')) continue // 目录条目(preview/)
    assert.ok(emitted.has(p), `索引列了 ${p} 但包里没有`)
  }
  for (const p of emitted) {
    assert.ok(indexed.has(p), `包里多了 ${p} 但索引没收录`)
  }
})
check('图标槽位换图标后,导出包文件同步换', () => {
  const files = iconFileNames({ ...doc, icons: { ...doc.icons, 'demo-ibtn': 'plus' } })
  assert.ok(files.includes('icons/plus.svg'), '换成 plus 后包内要有 icons/plus.svg')
  assert.ok(!files.includes('icons/ellipsis.svg'), '不再被引用的图标不该入包')
})

console.log('── M3-a 底板拼装:数据层')
check('底板摆放随方案往返:serialize → parse 后实例逐条一致', () => {
  const d: typeof doc = {
    ...doc,
    placed: [
      { id: 'p1', recipe: 'button', x: 40, y: 24 },
      { id: 'p2', recipe: 'card', x: 120, y: 96 }
    ]
  }
  const back = parseDoc(serializeDoc(d))
  assert.deepEqual(back.placed, d.placed)
})
check('老方案没有 placed 字段:解析后为空数组,不报错', () => {
  const raw = JSON.parse(serializeDoc(doc)) as Record<string, unknown>
  delete raw['placed']
  const back = parseDoc(JSON.stringify(raw))
  assert.deepEqual(back.placed, [])
})
check('坏摆放条目被丢掉不挡打开:缺字段/非有限坐标/生面孔都剔除', () => {
  const raw = JSON.parse(serializeDoc(doc)) as Record<string, unknown>
  raw['placed'] = [
    { id: 'ok', recipe: 'button', x: 1, y: 2 },
    { id: 'no-recipe', x: 1, y: 2 },
    { id: 'nan', recipe: 'button', x: Number.NaN, y: 0 },
    'garbage'
  ]
  const back = parseDoc(JSON.stringify(raw))
  assert.deepEqual(back.placed, [{ id: 'ok', recipe: 'button', x: 1, y: 2 }])
})
check('零件注册表:每个零件 id 都有对应配方与样板节点', () => {
  for (const def of PART_DEFS) {
    assert.ok(
      RECIPES.some((r) => r.id === def.id),
      `零件 ${def.id} 没有对应配方`
    )
    assert.ok(partNode(def.id), `零件 ${def.id} 样板为空`)
  }
})
check('底板结构:每个实例包一层 data-uf-placed 壳并带坐标', () => {
  const d = { ...doc, placed: [{ id: 'p9', recipe: 'button', x: 33, y: 57 }] }
  const board = benchBody(d)
  assert.equal(board.cls, 'uf-board')
  const shell = board.children?.[0]
  assert.equal(shell?.cls, 'uf-placed')
  assert.equal(shell?.attrs?.['data-uf-placed'], 'p9')
  assert.equal(shell?.attrs?.['style'], 'left:33px;top:57px')
})
check('.uiframe 容器把摆放一起打包:zip 往返后 placed 不丢', () => {
  const d = { ...doc, placed: [{ id: 'pz', recipe: 'switch', x: 8, y: 8 }] }
  const packed = packUiframe({
    manifest: JSON.stringify(
      manifestFor(d, { id: 't', style: 's', createdAt: 'x', appVersion: '0' })
    ),
    design: serializeDoc(d)
  })
  const un = unpackUiframe(packed)
  assert.deepEqual(parseDoc(un.design).placed, d.placed)
})

console.log(`✅ UI 框架规格包自测全绿(${passed} 项)`)
