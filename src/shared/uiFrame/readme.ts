// 给 AI 的文字:README-给AI.md(§13.4)、pages/home.md(页面规格)、LICENSES.md。
// 全文只用「必须 / 禁止」(规则 8);体检会扫描含糊词。
import { iconSvgRelPath } from './customIcon.ts'
import { compCssPath, compHtmlPath, pageFor, STYLE_FILES, type PageDef } from './documents.ts'
import { escapeHtml } from './markup.ts'
import { deviceFor } from './devices.ts'
import { RECIPES } from './recipes/index.ts'
import { declaredCss, isThemed } from './resolve.ts'
import type { IconSlot, PageNode, TokenTier, UiFrameDoc } from './types.ts'

const SLOT_LABEL: Record<IconSlot, string> = {
  'demo-button': '按钮演示页的图标按钮',
  'demo-ibtn': '图标按钮演示页',
  'demo-check': '复选框演示页的勾号',
  'demo-input': '输入框演示页的前置图标',
  'demo-li': '列表行演示页的前置图标',
  'demo-arrow': '列表行演示页的尾部箭头',
  'demo-card': '卡片演示页的图标',
  'hero-cta': '首页「免费开始」按钮',
  'feature-1': '首页第 1 张卡片',
  'feature-2': '首页第 2 张卡片',
  'feature-3': '首页第 3 张卡片',
  'app-back': '应用页导航返回按钮',
  'app-bell': '应用页导航通知按钮',
  'app-search': '应用页搜索框前置图标',
  'app-row-1': '应用页第 1 行前置图标',
  'app-row-2': '应用页第 2 行前置图标',
  'app-row-3': '应用页第 3 行前置图标',
  'app-arrow': '应用页第 2 行尾部箭头',
  'demo-search': '搜索框前置图标',
  'demo-down': '下拉选择箭头'
}

const HARD_RULES = [
  '样式里的数值必须引用 `tokens.css` 的变量(`var(--变量名)`);禁止写死数值;禁止使用近似值。',
  '必须以 `page-template.html` 为起点新建页面;禁止改动其 `<head>` 中的任何一行。',
  '组件必须直接复用 `components/<组件>.css` 的全部规则;禁止改写;禁止「优化」;禁止复制 `components/_demo.css` 里的任何 class(`is-hover`、`is-active`、`is-focus`、`demo-*`)。',
  '字体必须通过 `fonts/fonts.css` 加载;禁止更换字体;禁止改用在线字体服务。',
  '图标必须内联 `icons/` 中对应 SVG 文件的原文(去掉第一行注释);禁止换图标;禁止重画;禁止改动 SVG 属性。',
  '每个元素必须使用页面规格中写明的标签、class 与属性;同级元素之间禁止依赖空格或换行产生间距。',
  '禁止添加包内没有的组件、颜色、阴影、动画、悬停效果与文案。',
  '遇到包内没写的细节,必须停下并在回复中列出疑问;禁止自行决定。'
]

const SELF_CHECK = [
  '样式中写死的数值个数(必须为 0)。',
  '每个组件的样式是否与 `components/*.css` 逐字一致。',
  '字体是否经 `fonts/fonts.css` 加载;图标是否为 `icons/` 原文。',
  '是否复制了 `components/_demo.css` 中的 class(必须为否)。',
  '结果文件夹的目录结构与引用路径是否与第 3 节一致。',
  '实现过程中所有不确定之处。'
]

const TIER_TITLE: Record<TokenTier, string> = {
  base: '基础变量',
  component: '组件变量',
  page: '页面变量'
}

function tokenTable(doc: UiFrameDoc, tier: TokenTier): string {
  const names = Object.keys(doc.tokens).filter((n) => doc.tokens[n].tier === tier)
  const themed = names.filter((n) => isThemed(doc.tokens[n].value))
  const plain = names.filter((n) => !themed.includes(n))
  const css = (n: string, t: 'light' | 'dark'): string =>
    `\`${declaredCss(doc.tokens, n, t, doc.rootFontPx)}\``
  const parts: string[] = []
  if (themed.length) {
    parts.push('| 变量 | 含义 | 亮色 | 暗色 |\n| --- | --- | --- | --- |')
    parts.push(
      themed
        .map(
          (n) => `| \`--${n}\` | ${doc.tokens[n].label} | ${css(n, 'light')} | ${css(n, 'dark')} |`
        )
        .join('\n')
    )
  }
  if (plain.length) {
    parts.push(`${themed.length ? '\n' : ''}| 变量 | 含义 | 值 |\n| --- | --- | --- |`)
    parts.push(
      plain.map((n) => `| \`--${n}\` | ${doc.tokens[n].label} | ${css(n, 'light')} |`).join('\n')
    )
  }
  return `### ${TIER_TITLE[tier]}\n\n${parts.join('\n')}`
}

/** 规格包文件索引(体检「未引用文件」以此为准) */
export function fileIndex(doc: UiFrameDoc, iconFiles: string[]): Array<[string, string]> {
  const page = pageFor(doc.platform)
  return [
    ['README-给AI.md', '本说明,必须先读'],
    ['page-template.html', '页面骨架,必须以此为起点'],
    [STYLE_FILES.tokens, '全部变量,亮暗两套'],
    [STYLE_FILES.reset, '清零浏览器默认样式'],
    [STYLE_FILES.fonts, '字体加载;字体文件位于 fonts/inter/ 与 fonts/noto-sans-sc/'],
    ...RECIPES.map((r): [string, string] => [compCssPath(r.id), `${r.label}样式,直接复用`]),
    [STYLE_FILES.demo, '仅供演示页使用,禁止复制'],
    ...RECIPES.map((r): [string, string] => [
      compHtmlPath(r.id),
      `${r.label}演示页:全部变体 × 状态 × 亮暗`
    ]),
    [page.specPath, `${page.title}页面规格:结构树与页面变量`],
    [STYLE_FILES[page.styleKey], `${page.title}布局样式`],
    [page.htmlPath, `${page.title}参考实现,浏览器打开即为标准效果`],
    ...iconFiles.map((f): [string, string] => [f, 'lucide 图标原文']),
    ['design.json', '同一份数据的 DTCG 结构化版本'],
    ['adapters/tailwind.theme.css', 'Tailwind CSS v4 @theme 主题文件(§13.5)'],
    ['adapters/uiTheme.ts', 'React Native 主题对象,数值为逻辑像素(§13.5)'],
    ['adapters/ui_theme.dart', 'Flutter ThemeData 主题,亮暗双套(§13.5)'],
    ['preview/', '组件与页面的标准外观截图(字体加载完成后截取)'],
    ['LICENSES.md', '图标与字体的许可声明']
  ]
}

export function readmeMd(doc: UiFrameDoc, iconFiles: string[]): string {
  const page = pageFor(doc.platform)
  const dev = deviceFor(doc)
  const isPhone = doc.platform === 'phone'
  const files = fileIndex(doc, iconFiles)
  const compLines = page.styles
    .filter((s) => s.startsWith('comp-'))
    .map(
      (s, i, arr) =>
        `${i === arr.length - 1 ? '│   └──' : '│   ├──'} ${s.slice(5)}.css          复制自规格包`
    )
    .join('\n')
  const recipes = RECIPES.map((r) => {
    const params = Object.keys(doc.tokens).filter((n) => doc.tokens[n].path[0] === r.group)
    return `### ${r.label}\n\n- 样式文件:\`${compCssPath(r.id)}\`;演示页:\`${compHtmlPath(r.id)}\`\n- 状态:${r.stateNames.join('、')}\n- 组件变量:${params.map((n) => `\`--${n}\``).join('、')}`
  }).join('\n\n')
  const usedIcons = (Object.keys(doc.icons) as IconSlot[])
    .map((slot) => `| \`${iconSvgRelPath(doc.icons[slot])}\` | ${SLOT_LABEL[slot]} |`)
    .join('\n')
  return `# UI 规格包 · 给 AI 的说明(必须先读)

本包是一份 UI 的精确数值规格(${doc.name})。你的任务:严格按本包实现页面;禁止参考后自由发挥。

## 1. 硬规则

${HARD_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## 2. 目标平台与技术栈

- 平台:${isPhone ? '手机端页面' : '电脑端网页'};参考视口 ${dev.width} × ${dev.height}(${dev.label})。
- 技术栈:原生 HTML + CSS。目标项目使用其他前端框架时,必须保持与 \`${page.htmlPath}\` 相同的元素结构、class 与样式文件,只改写模板语法。
- 根字号 ${doc.rootFontPx}px,尺寸单位一律为 rem(1rem = ${doc.rootFontPx}px)。
- 亮暗主题:在 \`<html>\` 上写 \`data-theme="light"\` 或 \`data-theme="dark"\`;本页面使用亮色。

## 3. 交付目录与引用方式

结果文件夹必须自包含,结构如下:

\`\`\`
结果文件夹/
├── index.html            由 page-template.html 复制而来
├── fonts/                整个文件夹复制自规格包 fonts/
├── tokens.css            复制自规格包
├── reset.css             复制自规格包
├── components/
${compLines}
└── pages/
    └── ${page.id}.css          复制自规格包
\`\`\`

- \`index.html\` 必须用相对路径引用以上文件,写法与 \`page-template.html\` 完全一致。
- 禁止把 \`components/_demo.css\`、\`components/*.html\`、\`pages/*.html\`、\`preview/\`、\`design.json\` 复制进结果文件夹。

## 4. 文件索引

| 文件 | 作用 |
| --- | --- |
${files.map(([f, d]) => `| \`${f}\` | ${d} |`).join('\n')}

## 5. 变量总表

${(['base', 'component', 'page'] as TokenTier[]).map((t) => tokenTable(doc, t)).join('\n\n')}

## 6. 组件总表

${recipes}

## 7. 页面清单

| 页面 | 规格 | 样式 | 参考实现 |
| --- | --- | --- | --- |
| ${page.title} | \`${page.specPath}\` | \`${STYLE_FILES[page.styleKey]}\` | \`${page.htmlPath}\` |

## 8. 图标清单

| 文件 | 用在哪里 |
| --- | --- |
${usedIcons}

## 9. 字体

- 界面字体:Inter Variable(西文)+ Noto Sans SC Variable(中文),均为 SIL OFL 1.1 许可的可变字体。
- 必须通过 \`fonts/fonts.css\` 加载,字体文件随包附带,无需联网。

## 10. 平台规范

- 可点击元素的点击区必须不小于 ${isPhone ? '44 × 44' : '24 × 24'} 逻辑像素(${isPhone ? 'iOS HIG;Android 为 48 × 48' : 'WCAG 2.2'})。
- 正文文字与背景的对比度必须不低于 4.5:1(WCAG AA)。

## 11. 交付前自检清单

实现完成后,必须逐项核对并在回复中列出结果:

${SELF_CHECK.map((c, i) => `${i + 1}. ${c}`).join('\n')}
`
}

function nodeLine(node: PageNode, doc: UiFrameDoc, depth: number): string[] {
  const attrs = [
    node.cls ? ` class="${node.cls}"` : '',
    ...Object.entries(node.attrs ?? {}).map(([k, val]) => (val === '' ? ` ${k}` : ` ${k}="${val}"`))
  ].join('')
  const bits = [`\`<${node.tag}${attrs}>\``]
  if (node.text) bits.push(`文案「${escapeHtml(node.text)}」`)
  if (node.icon) {
    bits.push(
      `内联 \`${iconSvgRelPath(doc.icons[node.icon])}\` 原文,位于文案${node.iconAt === 'end' ? '之后' : '之前'}`
    )
  }
  const line = `${'  '.repeat(depth)}- ${bits.join(';')}`
  return [line, ...(node.children ?? []).flatMap((c) => nodeLine(c, doc, depth + 1))]
}

export function pageMd(doc: UiFrameDoc, page: PageDef): string {
  const dev = deviceFor(doc)
  const pageTokens = Object.keys(doc.tokens).filter((n) => doc.tokens[n].tier === 'page')
  const comps = page.styles
    .filter((s) => s.startsWith('comp-'))
    .map((s) => `\`${compCssPath(s.slice(5))}\``)
    .join('、')
  return `# ${page.title} · 页面规格

- 视口:${dev.width} × ${dev.height}(${dev.label});主题:亮色(\`<html data-theme="light">\`)。
- 布局样式:\`${STYLE_FILES[page.styleKey]}\`;组件样式:${comps}。
- 参考实现:\`${page.htmlPath}\`,其结构与下方结构树逐项一致。
- 下方每一行即一个元素:标签、class 与属性必须原样使用;文案必须逐字使用;同级元素之间禁止插入任何其他元素。

## 结构树(\`<body>\` 内,自上而下)

${page.body.flatMap((n) => nodeLine(n, doc, 0)).join('\n')}

## 页面变量

| 变量 | 含义 | 值 |
| --- | --- | --- |
${pageTokens.map((n) => `| \`--${n}\` | ${doc.tokens[n].label} | \`${declaredCss(doc.tokens, n, 'light', doc.rootFontPx)}\` |`).join('\n')}
`
}

export interface LicenseTexts {
  lucide: string
  inter: string
  notoSansSc: string
}

export function licensesMd(t: LicenseTexts): string {
  return `# 许可声明

## lucide 图标(ISC License)

\`icons/\` 下的图标来自 lucide-static。

\`\`\`
${t.lucide.trim()}
\`\`\`

## Inter(SIL Open Font License 1.1)

\`fonts/inter/\` 下的字体文件。

\`\`\`
${t.inter.trim()}
\`\`\`

## Noto Sans SC(SIL Open Font License 1.1)

\`fonts/noto-sans-sc/\` 下的字体文件。

\`\`\`
${t.notoSansSc.trim()}
\`\`\`
`
}
