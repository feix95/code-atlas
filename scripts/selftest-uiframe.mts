// UI 框架(UI Spec Builder)规格包自测:纯 node 直跑,读 node_modules 里的 lucide 与字体清单。
// 覆盖:单位换算、默认模板导出零体检错误、实测暴露的缺口能被体检拦下(§23.2)、产物同源一致。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPackage, type PackageAssets } from '../src/shared/uiFrame/exportPackage.ts'
import { HOME_PAGE } from '../src/shared/uiFrame/page.ts'
import { defaultDoc } from '../src/shared/uiFrame/template.ts'
import { hasErrors, lintPackage } from '../src/shared/uiFrame/lint.ts'
import { LUCIDE_VERSION, svgText } from '../src/shared/uiFrame/markup.ts'
import { describePx, remText, snapPx } from '../src/shared/uiFrame/units.ts'
import { resolvePx } from '../src/shared/uiFrame/resolve.ts'
import { htmlDocument, PAGE_STYLES, styleTexts } from '../src/shared/uiFrame/documents.ts'
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
const PAGES = { 'pages/home.md': HOME_PAGE.body }

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
check('规格包文件齐全(§13.3)', () => {
  for (const f of [
    'README-给AI.md',
    'page-template.html',
    'tokens.css',
    'reset.css',
    'fonts/fonts.css',
    'components/button.css',
    'components/button.html',
    'components/card.css',
    'components/card.html',
    'components/_demo.css',
    'pages/home.md',
    'pages/home.css',
    'pages/home.html',
    'icons/arrow-right.svg',
    'icons/timer.svg',
    'icons/music.svg',
    'icons/dumbbell.svg',
    'design.json',
    'LICENSES.md'
  ]) {
    assert.ok(f in pkg.files, `缺文件 ${f}`)
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
  assert.doesNotMatch(pkg.files['components/button.css'], /is-hover|\.demo/)
  assert.match(pkg.files['components/button.css'], /\.btn--solid:hover:not\(:disabled\)/)
  assert.match(pkg.files['components/_demo.css'], /\.btn--solid\.is-hover/)
})
check('导出 HTML 无画布痕迹,元素之间无空白(规则 13)', () => {
  for (const f of ['pages/home.html', 'components/button.html', 'components/card.html']) {
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

console.log(`✅ UI 框架规格包自测全绿(${passed} 项)`)
