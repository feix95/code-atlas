// 规格包里的样式与 HTML 文档:tokens.css、reset.css、页面骨架、组件演示页、页面参考实现。
// 画布与导出用同一批函数生成(所见即所导出):画布把样式内联进 <style>,导出写成 <link>。
import { demoBody, demoRules, wallBody } from './demo.ts'
import { nodeHtml, type MarkupContext } from './markup.ts'
import { HOME_PAGE, HOME_RULES } from './page.ts'
import { componentCss, rulesCss } from './recipes/kit.ts'
import { RECIPES } from './recipes/index.ts'
import { declaredCss, isThemed } from './resolve.ts'
import type { PageNode, ThemeName, TokenTier, UiFrameDoc } from './types.ts'

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

/** reset.css:清零浏览器默认样式(§13.2 规则 7);数值只有 0 */
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
  'dd'
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
  home: 'pages/home.css'
}

type StyleKey = string

/** 每个样式文件的正文(字体 CSS 由调用方提供,导出与画布的字体地址不同) */
export function styleTexts(doc: UiFrameDoc, fontsCss: string): Record<StyleKey, string> {
  const texts: Record<StyleKey, string> = {
    fonts: fontsCss,
    tokens: tokensCss(doc),
    reset: RESET_CSS,
    demo: `/* _demo.css · 仅供演示页使用:禁止复制进正式页面 */\n\n${rulesCss(demoRules())}\n`,
    home: `/* 首页 · 页面布局样式 */\n\n${rulesCss(HOME_RULES)}\n`
  }
  for (const r of RECIPES) texts[compStyleKey(r.id)] = componentCss(r)
  return texts
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

/** page-template.html:页面骨架,<head> 全部写死,agent 只往 <body> 里填结构(规则 10) */
export function pageTemplateHtml(): string {
  const links = PAGE_STYLES.map((k) => `<link rel="stylesheet" href="${STYLE_FILES[k]}">`)
  return [
    '<!doctype html>',
    '<html lang="zh-CN" data-theme="light">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${HOME_PAGE.title}</title>`,
    ...links,
    '</head>',
    '<body>',
    '<!-- 在此填入页面结构:见 pages/home.md -->',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}
