// SVG 适配器:WorkbenchDocument → 矢量图。画板 = viewBox(自动裁切画板外内容);
// 四角同值用 <rect rx>,不同值用路径逐角画圆弧;旋转用 transform="rotate(角度 中心x 中心y)"。
// 描边与 CSS border 同为「内描边」口径:SVG 原生描边居中于轮廓,故用 2 倍宽 + clipPath 裁出内半。
import type { LineNode } from '../line.ts'
import type { BoxNode } from '../frame.ts'
import { uniformRadius } from '../node.ts'
import type { SceneNode } from '../scene.ts'
import { rectCenter } from '../geometry.ts'
import { ARTBOARD_BACKGROUND } from './cssAdapter.ts'
import type { ExportFormat, WorkbenchDocument } from './types.ts'

function roundedRectPath(node: BoxNode): string {
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

function shapeMarkup(node: BoxNode, extra: string): string {
  const uniform = uniformRadius(node.radii)
  if (uniform === null) return `<path d="${roundedRectPath(node)}"${extra}/>`
  const rx = uniform > 0 ? ` rx="${uniform}"` : ''
  return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"${rx}${extra}/>`
}

/** 直线:原生 <line>,描边居中于线段;端点样式 = stroke-linecap,虚线同矩形口径(3 倍线宽实 + 2 倍线宽空) */
function lineElement(node: LineNode): string[] {
  const { color, width, style } = node.stroke
  const dash = style === 'dashed' ? ` stroke-dasharray="${width * 3} ${width * 2}"` : ''
  return [
    `  <line id="${node.id}" x1="${node.x1}" y1="${node.y1}" x2="${node.x2}" y2="${node.y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="${node.cap}"${dash}/>`
  ]
}

function nodeElements(node: SceneNode): string[] {
  if (node.type === 'line') return lineElement(node)
  const c = rectCenter(node)
  const transform = node.rotation !== 0 ? ` transform="rotate(${node.rotation} ${c.x} ${c.y})"` : ''
  const lines: string[] = []
  if (node.stroke !== null)
    lines.push(`  <defs><clipPath id="clip-${node.id}">${shapeMarkup(node, '')}</clipPath></defs>`)
  lines.push(`  ${shapeMarkup(node, ` id="${node.id}" fill="${node.fill ?? 'none'}"${transform}`)}`)
  if (node.stroke !== null) {
    const { color, width, style } = node.stroke
    const dash = style === 'dashed' ? ` stroke-dasharray="${width * 3} ${width * 2}"` : ''
    lines.push(
      `  ${shapeMarkup(node, ` fill="none" stroke="${color}" stroke-width="${width * 2}" clip-path="url(#clip-${node.id})"${transform}${dash}`)}`
    )
  }
  return lines
}

export function toSvg(doc: WorkbenchDocument): string {
  const { width, height } = doc.artboard
  const fill = doc.artboardFill === undefined ? ARTBOARD_BACKGROUND : doc.artboardFill
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...(fill === null ? [] : [`  <rect width="${width}" height="${height}" fill="${fill}"/>`]),
    ...doc.nodes.flatMap(nodeElements),
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
