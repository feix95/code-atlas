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

/** 图标槽位 → 画布部件名(选中后属性面板按这个名字找手柄与图标选择器) */
const ICON_PART: Record<IconSlot, string> = {
  'demo-button': 'btn-icon',
  'hero-cta': 'btn-icon',
  'demo-ibtn': 'ibtn-icon',
  'demo-check': 'chk-mark',
  'demo-input': 'ipt-icon',
  'demo-li': 'li-lead-icon',
  'demo-arrow': 'li-trail-icon',
  'demo-card': 'card-icon',
  'feature-1': 'card-icon',
  'feature-2': 'card-icon',
  'feature-3': 'card-icon',
  'app-back': 'ibtn-icon',
  'app-bell': 'ibtn-icon',
  'app-search': 'ipt-icon',
  'app-row-1': 'li-lead-icon',
  'app-row-2': 'li-lead-icon',
  'app-row-3': 'li-lead-icon',
  'app-arrow': 'li-trail-icon',
  'demo-search': 'srch-ic',
  'demo-down': 'sel-ic'
}

function partOfIcon(slot: IconSlot): string {
  return ICON_PART[slot]
}

/** HTML 空元素:只写开标签,不写闭合标签 */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr'
])

/** 一个节点 → HTML(子节点依次拼接,不插入任何空白:规则 13) */
export function nodeHtml(node: PageNode, ctx: MarkupContext): string {
  const attrs: string[] = []
  if (node.cls) attrs.push(`class="${escapeHtml(node.cls)}"`)
  for (const [k, val] of Object.entries(node.attrs ?? {})) {
    attrs.push(val === '' ? k : `${k}="${escapeHtml(val)}"`)
  }
  if (ctx.mode === 'canvas' && node.part) attrs.push(`data-uf-part="${node.part}"`)
  const open = `<${node.tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`
  if (VOID_TAGS.has(node.tag)) return open
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
