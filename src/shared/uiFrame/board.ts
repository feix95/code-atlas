// 变量板(§5.5):基础变量按分组可视化排布——色板、字号阶梯、间距尺、圆角样、阴影阶梯等。
// 每个条目挂 data-uf-part="tok:<变量名>",点选后属性面板直接改值;
// 只在画布出现,不进规格包(样式用 var() 引用变量,所见即所导出)。
import type { CssRule } from './recipes/types.ts'
import { literalCss, resolveValue } from './resolve.ts'
import type { PageNode, UiFrameDoc } from './types.ts'
import { describePx } from './units.ts'

const v = (name: string): string => `var(--${name})`

type BoardKind =
  | 'color'
  | 'family'
  | 'type'
  | 'weight'
  | 'leading'
  | 'ruler'
  | 'radius'
  | 'barh'
  | 'box'
  | 'stroke'
  | 'ring'
  | 'opacity'
  | 'shadow'

/** 基础变量分组 → 变量板分区(顺序即展示顺序;kind 决定视觉样式) */
const GROUPS: Array<[group: string, title: string, kind: BoardKind]> = [
  ['color', '颜色', 'color'],
  ['font', '字体', 'family'],
  ['font-size', '字号', 'type'],
  ['font-weight', '字重', 'weight'],
  ['line-height', '行高', 'leading'],
  ['space', '间距', 'ruler'],
  ['radius', '圆角', 'radius'],
  ['control', '控件高度', 'barh'],
  ['icon', '图标尺寸', 'box'],
  ['border-width', '描边宽度', 'stroke'],
  ['focus-ring', '焦点环', 'ring'],
  ['opacity', '透明度', 'opacity'],
  ['shadow', '阴影', 'shadow']
]

/** 变量在板上的读数(维度变量给 rem + px,颜色给亮暗两值);画布提交后也用它原地刷新 */
export function boardValueText(doc: UiFrameDoc, name: string): string {
  const def = doc.tokens[name]
  if (!def) return ''
  const resolved = resolveValue(doc.tokens, name)
  if (resolved.kind === 'color') return `${resolved.light} / ${resolved.dark}`
  if (resolved.kind === 'dimension') return describePx(resolved.px, doc.rootFontPx)
  if (resolved.kind === 'fontFamily') return resolved.families.join(', ')
  return literalCss(resolved, 'light', doc.rootFontPx)
}

/** 每种 kind 的可视化小样:用内联 style 把变量值喂给固定样式类 */
function visual(kind: BoardKind, name: string): PageNode {
  const style = (s: string): PageNode => ({ tag: 'span', attrs: { style: s } })
  switch (kind) {
    case 'color':
      return {
        tag: 'span',
        cls: 'vb-sw',
        children: [
          { tag: 'span', attrs: { 'data-theme': 'light', style: `background: ${v(name)}` } },
          { tag: 'span', attrs: { 'data-theme': 'dark', style: `background: ${v(name)}` } }
        ]
      }
    case 'family':
      return {
        tag: 'span',
        cls: 'vb-type',
        attrs: { style: `font-family: ${v(name)}` },
        text: 'Aa 界面字体'
      }
    case 'type':
      return {
        tag: 'span',
        cls: 'vb-type',
        attrs: { style: `font-size: ${v(name)}` },
        text: 'Aa 字'
      }
    case 'weight':
      return {
        tag: 'span',
        cls: 'vb-type',
        attrs: { style: `font-weight: ${v(name)}` },
        text: 'Aa 字重'
      }
    case 'leading':
      return {
        tag: 'p',
        cls: 'vb-para',
        attrs: { style: `line-height: ${v(name)}` },
        children: [
          { tag: 'span', cls: 'vb-para-line', text: '行高示例' },
          { tag: 'span', cls: 'vb-para-line', text: '第二行文字' }
        ]
      }
    case 'ruler':
      return { tag: 'span', cls: 'vb-ruler', children: [style(`width: ${v(name)}`)] }
    case 'radius':
      return { tag: 'span', cls: 'vb-box', attrs: { style: `border-radius: ${v(name)}` } }
    case 'barh':
      return { tag: 'span', cls: 'vb-hbar', attrs: { style: `height: ${v(name)}` } }
    case 'box':
      return {
        tag: 'span',
        cls: 'vb-box',
        attrs: { style: `width: ${v(name)}; height: ${v(name)}` }
      }
    case 'stroke':
      return { tag: 'span', cls: 'vb-box', attrs: { style: `border-width: ${v(name)}` } }
    case 'ring':
      return {
        tag: 'span',
        cls: 'vb-box',
        attrs: {
          style: `outline: ${v('focus-ring-width')} solid ${v('color-focus')}; outline-offset: ${v('focus-ring-offset')}`
        }
      }
    case 'opacity':
      return {
        tag: 'span',
        cls: 'vb-box vb-op',
        attrs: { style: `opacity: ${v(name)}` }
      }
    case 'shadow':
      return { tag: 'span', cls: 'vb-box', attrs: { style: `box-shadow: ${v(name)}` } }
  }
}

/** 变量板 body:按分区排布全部基础变量 */
export function boardBody(doc: UiFrameDoc): PageNode[] {
  const sections: PageNode[] = []
  for (const [group, title, kind] of GROUPS) {
    const names = Object.keys(doc.tokens).filter(
      (n) => doc.tokens[n].tier === 'base' && doc.tokens[n].path[0] === group
    )
    if (!names.length) continue
    sections.push({
      tag: 'section',
      cls: 'vb-sec',
      children: [
        { tag: 'h2', cls: 'vb-title', text: title },
        {
          tag: 'div',
          cls: 'vb-grid',
          children: names.map((name): PageNode => {
            const def = doc.tokens[name]
            return {
              tag: 'div',
              cls: 'vb-item',
              part: `tok:${name}`,
              children: [
                { tag: 'div', cls: 'vb-visual', children: [visual(kind, name)] },
                {
                  tag: 'div',
                  cls: 'vb-meta',
                  children: [
                    { tag: 'span', cls: 'vb-name', text: def.label },
                    { tag: 'code', cls: 'vb-var', text: `--${name}` },
                    { tag: 'span', cls: 'vb-val', text: boardValueText(doc, name) }
                  ]
                }
              ]
            }
          })
        }
      ]
    })
  }
  return [{ tag: 'div', cls: 'vb', children: sections }]
}

/** 变量板样式(只进画布,不进规格包) */
export function boardCss(): CssRule[] {
  const d = (decls: Array<[string, string]>): [string, string][] => decls
  return [
    {
      sel: '.vb',
      decls: d([
        ['padding', v('space-6')],
        ['background', v('color-bg')],
        ['color', v('color-text')],
        ['font-family', v('font-family')]
      ])
    },
    { sel: '.vb-sec', decls: d([['margin', `0 0 ${v('space-8')}`]]) },
    {
      sel: '.vb-title',
      decls: d([
        ['margin', `0 0 ${v('space-3')}`],
        ['font-size', v('font-size-md')],
        ['font-weight', v('font-weight-semibold')],
        ['line-height', v('line-height-normal')]
      ])
    },
    {
      sel: '.vb-grid',
      decls: d([
        ['display', 'flex'],
        ['flex-wrap', 'wrap'],
        ['gap', v('space-6')]
      ])
    },
    {
      sel: '.vb-item',
      decls: d([
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['gap', v('space-2')],
        ['min-width', v('space-24')],
        ['cursor', 'pointer']
      ])
    },
    {
      sel: '.vb-visual',
      decls: d([
        ['display', 'flex'],
        ['align-items', 'center'],
        ['min-height', v('control-lg')],
        ['color', v('color-text')]
      ])
    },
    {
      sel: '.vb-sw',
      decls: d([
        ['display', 'flex'],
        ['width', v('space-24')],
        ['height', v('space-10')],
        ['overflow', 'hidden'],
        ['border', `${v('border-width-1')} solid ${v('color-border')}`],
        ['border-radius', v('radius-sm')]
      ])
    },
    { sel: '.vb-sw > span', decls: d([['flex', '1']]) },
    {
      sel: '.vb-box',
      decls: d([
        ['display', 'block'],
        ['width', v('space-10')],
        ['height', v('space-10')],
        ['box-sizing', 'border-box'],
        ['background', v('color-surface')],
        ['border', `${v('border-width-1')} solid ${v('color-border-strong')}`]
      ])
    },
    {
      sel: '.vb-hbar',
      decls: d([
        ['display', 'block'],
        ['width', v('space-24')],
        ['background', v('color-hover-bg')],
        ['border', `${v('border-width-1')} solid ${v('color-border')}`]
      ])
    },
    {
      sel: '.vb-ruler',
      decls: d([
        ['display', 'block'],
        ['width', v('space-24')]
      ])
    },
    {
      sel: '.vb-ruler > span',
      decls: d([
        ['display', 'block'],
        ['height', v('space-2')],
        ['background', v('color-primary')],
        ['border-radius', v('radius-sm')]
      ])
    },
    {
      sel: '.vb-op',
      decls: d([
        ['background', v('color-primary')],
        ['border-color', v('color-primary')]
      ])
    },
    {
      sel: '.vb-para',
      decls: d([
        ['margin', '0'],
        ['padding', v('space-2')],
        ['width', v('space-24')],
        ['font-size', v('font-size-sm')],
        ['background', v('color-surface')],
        ['border', `${v('border-width-1')} solid ${v('color-border')}`]
      ])
    },
    { sel: '.vb-para-line', decls: d([['display', 'block']]) },
    {
      sel: '.vb-type',
      decls: d([
        ['line-height', v('line-height-normal')],
        ['white-space', 'nowrap']
      ])
    },
    {
      sel: '.vb-name',
      decls: d([
        ['display', 'block'],
        ['font-size', v('font-size-sm')],
        ['line-height', v('line-height-tight')]
      ])
    },
    {
      sel: '.vb-var',
      decls: d([
        ['display', 'block'],
        ['font-size', v('font-size-sm')],
        ['line-height', v('line-height-tight')],
        ['color', v('color-text-secondary')]
      ])
    },
    {
      sel: '.vb-val',
      decls: d([
        ['display', 'block'],
        ['font-size', v('font-size-sm')],
        ['line-height', v('line-height-tight')],
        ['color', v('color-text-secondary')]
      ])
    }
  ]
}
