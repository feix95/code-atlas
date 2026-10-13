// CSS 适配器:WorkbenchDocument → CSS 规则 / 完整 HTML 页面。
// 画布 iframe 渲染用的也是 artboardCss 这一份输出,画布所见即导出所得。
// 画板 = 定位容器(position: relative + 裁切);节点 = 绝对定位,旋转用 transform(默认绕中心)。
import { uniformRadius, type RectNode } from '../node.ts'
import type { ExportFormat, WorkbenchDocument } from './types.ts'

export const ARTBOARD_CLASS = 'artboard'
export const ARTBOARD_BACKGROUND = '#ffffff'

function px(value: number): string {
  return value === 0 ? '0' : `${value}px`
}

function borderRadius(node: RectNode): string {
  const uniform = uniformRadius(node.radii)
  return uniform !== null ? px(uniform) : node.radii.map(px).join(' ')
}

function rule(selector: string, decls: readonly [string, string][]): string {
  return `${selector} {\n${decls.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`
}

function nodeRule(node: RectNode): string {
  // border-box:描边画在节点内侧,外接框恒等于 x/y/宽/高,各平台按同一口径复刻
  const decls: [string, string][] = [
    ['position', 'absolute'],
    ['box-sizing', 'border-box'],
    ['left', px(node.x)],
    ['top', px(node.y)],
    ['width', px(node.width)],
    ['height', px(node.height)]
  ]
  if (node.fill !== null) decls.push(['background', node.fill])
  if (node.stroke !== null)
    decls.push(['border', `${px(node.stroke.width)} ${node.stroke.style} ${node.stroke.color}`])
  if (node.radii.some((r) => r > 0)) decls.push(['border-radius', borderRadius(node)])
  if (node.rotation !== 0) decls.push(['transform', `rotate(${node.rotation}deg)`])
  return rule(`.${node.id}`, decls)
}

export function artboardCss(doc: WorkbenchDocument): string {
  const board = rule(`.${ARTBOARD_CLASS}`, [
    ['position', 'relative'],
    ['width', px(doc.artboard.width)],
    ['height', px(doc.artboard.height)],
    ['overflow', 'hidden'],
    ['background', ARTBOARD_BACKGROUND]
  ])
  return [board, ...doc.nodes.map(nodeRule)].join('\n\n')
}

export function toHtml(doc: WorkbenchDocument): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<style>',
    'body { margin: 0; }',
    artboardCss(doc),
    '</style>',
    '</head>',
    '<body>',
    `  <div class="${ARTBOARD_CLASS}">`,
    ...doc.nodes.map((n) => `    <div class="${n.id}"></div>`),
    '  </div>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

export const HTML_FORMAT: ExportFormat = {
  id: 'html',
  label: '网页 HTML + CSS',
  tip: '单个 HTML 文件(样式内嵌),用浏览器打开即可核对效果',
  fileName: 'ui-workbench.html',
  mimeType: 'text/html',
  serialize: toHtml
}
