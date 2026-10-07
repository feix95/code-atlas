// 规格包里的样式与 HTML 文档:tokens.css、reset.css、页面骨架、组件演示页、页面参考实现。
// 画布与导出用同一批函数生成(所见即所导出):画布把样式内联进 <style>,导出写成 <link>。
import { APP_PAGE, APP_RULES } from './appPage.ts'
import { demoBody, demoRules, wallBody } from './demo.ts'
import { nodeHtml, type MarkupContext } from './markup.ts'
import { HOME_PAGE, HOME_RULES } from './page.ts'
import {
  FORM_PAGE,
  FORM_RULES,
  LIST_PAGE,
  LIST_RULES,
  SETTINGS_PAGE,
  SETTINGS_RULES
} from './pages.ts'
import { componentCss, rulesCss } from './recipes/kit.ts'
import type { CssRule } from './recipes/types.ts'
import { RECIPES } from './recipes/index.ts'
import { declaredCss, isThemed } from './resolve.ts'
import type { PageNode, ThemeName, TokenTier, UiFrameDoc, UiPlatform } from './types.ts'

const TIER_TITLE: Record<TokenTier, string> = {
  base: '基础变量',
  component: '组件变量(默认引用基础变量)',
  page: '页面变量(示例页布局)'
}

function declLines(doc: UiFrameDoc, names: string[], theme: ThemeName): string {
  return names
    .map((n) => `  --${n}: ${declaredCss(doc.tokens, n, theme, doc.rootFontPx)};`)
    .join('\n')
}

/** tokens.css。非主题变量在每个 data-theme 容器上重新声明:
 *  引用了颜色/阴影的组件变量(如 --card-shadow)才能随所在容器的亮暗重新取值 */
export function tokensCss(doc: UiFrameDoc): string {
  const names = Object.keys(doc.tokens)
  const themed = names.filter((n) => isThemed(doc.tokens[n].value))
  const tiers: TokenTier[] = ['base', 'component', 'page']
  const plainBlocks = tiers
    .map((tier) => {
      const list = names.filter((n) => doc.tokens[n].tier === tier && !themed.includes(n))
      return list.length ? `  /* ${TIER_TITLE[tier]} */\n${declLines(doc, list, 'light')}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
  return [
    `/* tokens.css · 全部设计变量 · 根字号 ${doc.rootFontPx}px(1rem = ${doc.rootFontPx}px)`,
    '   亮暗切换:在 <html> 上写 data-theme="light" 或 data-theme="dark" */',
    '',
    `:root,\n[data-theme='light'] {\n${declLines(doc, themed, 'light')}\n}`,
    '',
    `[data-theme='dark'] {\n${declLines(doc, themed, 'dark')}\n}`,
    '',
    `:root,\n[data-theme] {\n${plainBlocks}\n}`,
    ''
  ].join('\n')
}

/** reset.css:清零浏览器默认样式(第 13.2 节 规则 7);数值只有 0 */
export const RESET_CSS = `/* reset.css · 清零浏览器默认样式:页面里的间距一律由显式变量写出 */

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
h1,
h2,
h3,
h4,
h5,
h6,
p,
ul,
ol,
li,
figure,
blockquote,
dl,
dd {
  margin: 0;
  padding: 0;
}

h1,
h2,
h3,
h4,
h5,
h6 {
  font-size: inherit;
  font-weight: inherit;
}

ul,
ol {
  list-style: none;
}

a {
  color: inherit;
  text-decoration: none;
}

button,
input,
select,
textarea {
  margin: 0;
  font: inherit;
  color: inherit;
}

button {
  padding: 0;
  border: 0;
  background: none;
}

table {
  border-collapse: collapse;
  border-spacing: 0;
}

th,
td {
  padding: 0;
  font-weight: inherit;
  text-align: inherit;
}
`

/** reset.css 清零过默认样式的标签(体检「默认样式依赖」对照用) */
export const RESET_TAGS = [
  'html',
  'body',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'figure',
  'blockquote',
  'dl',
  'dd',
  'table',
  'th',
  'td'
]

/** 组件样式文件的键与路径:键 comp-<id> → components/<id>.css */
export const compStyleKey = (id: string): string => `comp-${id}`
export const compCssPath = (id: string): string => `components/${id}.css`
export const compHtmlPath = (id: string): string => `components/${id}.html`

/** 规格包里的样式文件(相对规格包根目录);导出与画布按这个顺序加载 */
export const STYLE_FILES: Record<string, string> = {
  fonts: 'fonts/fonts.css',
  tokens: 'tokens.css',
  reset: 'reset.css',
  ...Object.fromEntries(RECIPES.map((r) => [compStyleKey(r.id), compCssPath(r.id)])),
  demo: 'components/_demo.css',
  home: 'pages/home.css',
  app: 'pages/app.css',
  list: 'pages/list.css',
  settings: 'pages/settings.css',
  form: 'pages/form.css'
}

type StyleKey = string

/** 每个样式文件的正文(字体 CSS 由调用方提供,导出与画布的字体地址不同) */
export function styleTexts(doc: UiFrameDoc, fontsCss: string): Record<StyleKey, string> {
  const texts: Record<StyleKey, string> = {
    fonts: fontsCss,
    tokens: tokensCss(doc),
    reset: RESET_CSS,
    demo: `/* _demo.css · 仅供演示页使用:禁止复制进正式页面 */\n\n${rulesCss(demoRules())}\n`,
    home: `/* 首页 · 页面布局样式 */\n\n${rulesCss(HOME_RULES)}\n`,
    app: `/* 示例应用页 · 手机端页面布局样式 */\n\n${rulesCss(APP_RULES)}\n`,
    list: `/* 列表页 · 页面布局样式(第 5.5 节 典型页) */\n\n${rulesCss(LIST_RULES)}\n${pgMedia(doc)}`,
    settings: `/* 设置页 · 页面布局样式(第 5.5 节 典型页) */\n\n${rulesCss(SETTINGS_RULES)}\n${pgMedia(doc)}`,
    form: `/* 表单页 · 页面布局样式(第 5.5 节 典型页) */\n\n${rulesCss(FORM_RULES)}\n${pgMedia(doc)}`
  }
  for (const r of RECIPES) texts[compStyleKey(r.id)] = componentCss(r)
  return texts
}

/** 典型页响应式块:断点数值取自 --bp-* 变量(第 7.2 节),改断点即改媒体查询 */
export function pgMedia(doc: UiFrameDoc): string {
  const bp = (name: string): string => declaredCss(doc.tokens, name, 'light', doc.rootFontPx)
  return [
    `/* 响应式:≤${bp('bp-md')} 工具行纵向堆叠,≤${bp('bp-sm')} 页面留白收窄 */`,
    `@media (max-width: ${bp('bp-md')}) {`,
    '  .pg-toolbar {',
    '    flex-direction: column;',
    '    align-items: stretch;',
    '  }',
    '',
    '  .pg-toolbar .srch {',
    '    width: auto;',
    '  }',
    '',
    '  .pg-spacer {',
    '    display: none;',
    '  }',
    '}',
    '',
    `@media (max-width: ${bp('bp-sm')}) {`,
    '  .pg {',
    '    padding-right: var(--app-gutter);',
    '    padding-left: var(--app-gutter);',
    '  }',
    '}',
    ''
  ].join('\n')
}

export interface HtmlDocOptions {
  title: string
  body: PageNode[]
  styles: StyleKey[]
  ctx: MarkupContext
  /** link = 写 <link>(href 以 hrefBase 为前缀);inline = 把样式正文内联(画布) */
  styleMode:
    { kind: 'link'; hrefBase: string } | { kind: 'inline'; texts: Record<StyleKey, string> }
}

export function htmlDocument(opts: HtmlDocOptions): string {
  const head = opts.styles
    .map((key) =>
      opts.styleMode.kind === 'link'
        ? `<link rel="stylesheet" href="${opts.styleMode.hrefBase}${STYLE_FILES[key]}">`
        : `<style data-uf-style="${key}">\n${opts.styleMode.texts[key]}</style>`
    )
    .join('\n')
  return [
    '<!doctype html>',
    `<html lang="zh-CN" data-theme="light">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${opts.title}</title>`,
    head,
    '</head>',
    `<body>${opts.body.map((n) => nodeHtml(n, opts.ctx)).join('')}</body>`,
    '</html>',
    ''
  ].join('\n')
}

/** 正式页面要加载的样式(不含 _demo.css);示例页用到按钮与卡片 */
export const PAGE_STYLES: StyleKey[] = [
  'fonts',
  'tokens',
  'reset',
  compStyleKey('button'),
  compStyleKey('card'),
  'home'
]

/** 手机端示例页用到的组件样式 */
export const APP_STYLES: StyleKey[] = [
  'fonts',
  'tokens',
  'reset',
  compStyleKey('button'),
  compStyleKey('icon-button'),
  compStyleKey('input'),
  compStyleKey('tabs'),
  compStyleKey('list-row'),
  compStyleKey('switch'),
  'app'
]

/** 典型页(第 5.5 节)要加载的组件样式 */
export const LIST_STYLES: StyleKey[] = [
  'fonts',
  'tokens',
  'reset',
  compStyleKey('appbar'),
  compStyleKey('button'),
  compStyleKey('search'),
  compStyleKey('list-row'),
  compStyleKey('pagination'),
  'list'
]

export const SETTINGS_STYLES: StyleKey[] = [
  'fonts',
  'tokens',
  'reset',
  compStyleKey('appbar'),
  compStyleKey('button'),
  compStyleKey('avatar'),
  compStyleKey('list-row'),
  compStyleKey('switch'),
  compStyleKey('divider'),
  'settings'
]

export const FORM_STYLES: StyleKey[] = [
  'fonts',
  'tokens',
  'reset',
  compStyleKey('appbar'),
  compStyleKey('button'),
  compStyleKey('input'),
  compStyleKey('textarea'),
  compStyleKey('select'),
  compStyleKey('radio'),
  compStyleKey('checkbox'),
  'form'
]

export interface PageDef {
  id: string
  title: string
  body: PageNode[]
  /** 页面样式文件键(对应 STYLE_FILES)与规格包内路径 */
  styleKey: string
  /** 页面规格文档相对路径 */
  specPath: string
  /** 参考实现相对路径 */
  htmlPath: string
  styles: StyleKey[]
}

/** 当前平台的示例页(所见即所导出:画布与规格包用同一个页面) */
export function pageFor(platform: UiPlatform): PageDef {
  if (platform === 'phone') {
    return {
      id: APP_PAGE.id,
      title: APP_PAGE.title,
      body: APP_PAGE.body,
      styleKey: 'app',
      specPath: 'pages/app.md',
      htmlPath: 'pages/app.html',
      styles: APP_STYLES
    }
  }
  return {
    id: HOME_PAGE.id,
    title: HOME_PAGE.title,
    body: HOME_PAGE.body,
    styleKey: 'home',
    specPath: 'pages/home.md',
    htmlPath: 'pages/home.html',
    styles: PAGE_STYLES
  }
}

/** 平台无关的典型页(第 5.5 节):桌面与手机的规格包都会带上 */
const TYPICAL_PAGES: PageDef[] = [
  {
    id: LIST_PAGE.id,
    title: LIST_PAGE.title,
    body: LIST_PAGE.body,
    styleKey: 'list',
    specPath: 'pages/list.md',
    htmlPath: 'pages/list.html',
    styles: LIST_STYLES
  },
  {
    id: SETTINGS_PAGE.id,
    title: SETTINGS_PAGE.title,
    body: SETTINGS_PAGE.body,
    styleKey: 'settings',
    specPath: 'pages/settings.md',
    htmlPath: 'pages/settings.html',
    styles: SETTINGS_STYLES
  },
  {
    id: FORM_PAGE.id,
    title: FORM_PAGE.title,
    body: FORM_PAGE.body,
    styleKey: 'form',
    specPath: 'pages/form.md',
    htmlPath: 'pages/form.html',
    styles: FORM_STYLES
  }
]

/** 规格包要导出的全部页面:平台示例页 + 三个典型页 */
export function pagesFor(platform: UiPlatform): PageDef[] {
  return [pageFor(platform), ...TYPICAL_PAGES]
}

/** 页面样式键 → 布局规则(pageMd 提取「本页用到的页面变量」用) */
export const PAGE_RULES: Record<string, CssRule[]> = {
  home: HOME_RULES,
  app: APP_RULES,
  list: LIST_RULES,
  settings: SETTINGS_RULES,
  form: FORM_RULES
}

/** 组件演示页要加载的样式:本组件 + 演示结构里复用的其他组件(demoDeps)+ _demo.css */
export function demoStyles(id: string): StyleKey[] {
  const recipe = RECIPES.find((r) => r.id === id)
  if (!recipe) throw new Error(`未注册的组件:${id}`)
  const deps = (recipe.demoDeps ?? []).map(compStyleKey)
  return ['fonts', 'tokens', 'reset', ...deps, compStyleKey(id), 'demo']
}

export const WALL_STYLES: StyleKey[] = [
  'fonts',
  'tokens',
  'reset',
  ...RECIPES.map((r) => compStyleKey(r.id)),
  'demo'
]

export { demoBody }

export { wallBody, HOME_PAGE }

export { APP_PAGE }

/** page-template.html:页面骨架,<head> 全部写死,agent 只往 <body> 里填结构(规则 10) */
export function pageTemplateHtml(doc: Pick<UiFrameDoc, 'platform'>): string {
  const page = pageFor(doc.platform)
  const links = page.styles.map((k) => `<link rel="stylesheet" href="${STYLE_FILES[k]}">`)
  return [
    '<!doctype html>',
    '<html lang="zh-CN" data-theme="light">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${page.title}</title>`,
    ...links,
    '</head>',
    '<body>',
    `<!-- 在此填入页面结构:见 ${page.specPath} -->`,
    '</body>',
    '</html>',
    ''
  ].join('\n')
}
