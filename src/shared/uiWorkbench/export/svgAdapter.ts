// SVG 适配器:WorkbenchDocument → 矢量图。画板 = viewBox(自动裁切画板外内容);
// 四角同值用 <rect rx>,不同值用路径逐角画圆弧;旋转用 transform="rotate(角度 中心x 中心y)"。
import { uniformRadius, type RectNode } from '../node.ts'
import { rectCenter } from '../geometry.ts'
import { ARTBOARD_BACKGROUND } from './cssAdapter.ts'
import type { ExportFormat, WorkbenchDocument } from './types.ts'

function roundedRectPath(node: RectNode): string {
  const { x, y, width: w, height: h } = node
  const [tl, tr, br, bl] = node.radii
  return [
    `M${x + tl} ${y}`,
    `H${x + w - tr}`,
    `A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}`,
    `V${y + h - br}`,
    `A${br} ${br} 0 0 1 ${x + w - br} ${y + h}`,
    `H${x + bl}`,
    `A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}`,
    `V${y + tl}`,
    `A${tl} ${tl} 0 0 1 ${x + tl} ${y}`,
    'Z'
  ].join(' ')
}

function nodeElement(node: RectNode): string {
  const c = rectCenter(node)
  const transform = node.rotation !== 0 ? ` transform="rotate(${node.rotation} ${c.x} ${c.y})"` : ''
  const common = `id="${node.id}" fill="${node.fill}"${transform}`
  const uniform = uniformRadius(node.radii)
  if (uniform === null) return `  <path ${common} d="${roundedRectPath(node)}"/>`
  const rx = uniform > 0 ? ` rx="${uniform}"` : ''
  return `  <rect ${common} x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"${rx}/>`
}

export function toSvg(doc: WorkbenchDocument): string {
  const { width, height } = doc.artboard
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <rect width="${width}" height="${height}" fill="${ARTBOARD_BACKGROUND}"/>`,
    ...doc.nodes.map(nodeElement),
    '</svg>',
    ''
  ].join('\n')
}

export const SVG_FORMAT: ExportFormat = {
  id: 'svg',
  label: '矢量图 SVG',
  tip: '整张画板的矢量图,可放进其他设计软件或网页',
  fileName: 'ui-workbench.svg',
  mimeType: 'image/svg+xml',
  serialize: toSvg
}
