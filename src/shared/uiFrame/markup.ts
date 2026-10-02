// 结构 → HTML:页面结构树、图标 SVG 原文。
// 画布模式给可选中的元素挂 data-uf-part;导出模式不挂,规格包里不出现任何编辑器痕迹。
import type { IconLookup, IconNode, IconSlot, PageNode } from './types.ts'

/** 与 package.json 锁定的 lucide-static 版本一致(自测校验) */
export const LUCIDE_VERSION = '1.48.0'

export type MarkupMode = 'export' | 'canvas'

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 图标 SVG 原文(icons/*.svg 与页面内联共用同一份,规则 5) */
export function svgText(node: IconNode): string {
  const children = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, val]) => ` ${k}="${escapeHtml(val)}"`)
        .join('')
      return `<${tag}${a} />`
    })
    .join('')
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true">${children}</svg>`
  )
}

/** icons/<名>.svg 文件内容:许可注释 + 原文 */
export function svgFile(name: string, node: IconNode): string {
  return `<!-- lucide-static v${LUCIDE_VERSION} · ${name} · ISC License -->\n${svgText(node)}\n`
}

export interface MarkupContext {
  mode: MarkupMode
  icons: Record<IconSlot, string>
  lookup: IconLookup
}

function iconHtml(slot: IconSlot, ctx: MarkupContext): string {
  const name = ctx.icons[slot]
  const node = ctx.lookup(name)
  if (!node) throw new Error(`图标不存在:${name}(槽位 ${slot})`)
  const svg = svgText(node)
  return ctx.mode === 'canvas'
    ? svg.replace('<svg ', `<svg data-uf-part="${partOfIcon(slot)}" data-uf-icon="${slot}" `)
    : svg
}

function partOfIcon(slot: IconSlot): string {
  return slot === 'hero-cta' || slot === 'demo-button' ? 'btn-icon' : 'card-icon'
}

/** 一个节点 → HTML(子节点依次拼接,不插入任何空白:规则 13) */
export function nodeHtml(node: PageNode, ctx: MarkupContext): string {
  const attrs: string[] = []
  if (node.cls) attrs.push(`class="${escapeHtml(node.cls)}"`)
  for (const [k, val] of Object.entries(node.attrs ?? {})) {
    attrs.push(val === '' ? k : `${k}="${escapeHtml(val)}"`)
  }
  if (ctx.mode === 'canvas' && node.part) attrs.push(`data-uf-part="${node.part}"`)
  const open = `<${node.tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`
  const icon = node.icon ? iconHtml(node.icon, ctx) : ''
  const text = node.text ? escapeHtml(node.text) : ''
  const kids = (node.children ?? []).map((c) => nodeHtml(c, ctx)).join('')
  const inner = node.iconAt === 'end' ? `${text}${icon}${kids}` : `${icon}${text}${kids}`
  return `${open}${inner}</${node.tag}>`
}

/** 结构树里用到的全部图标槽位(去重,保持出现顺序) */
export function iconSlotsOf(nodes: PageNode[]): IconSlot[] {
  const out: IconSlot[] = []
  const walk = (n: PageNode): void => {
    if (n.icon && !out.includes(n.icon)) out.push(n.icon)
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

/** 结构树里用到的全部标签名(体检「默认样式依赖」用) */
export function tagsOf(nodes: PageNode[]): string[] {
  const out = new Set<string>()
  const walk = (n: PageNode): void => {
    out.add(n.tag)
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
  return [...out]
}
