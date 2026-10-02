// 底板拼装的页面结构(M3-a):doc.placed 里的零件实例 → 绝对定位的看板。
// 画布与导出共用这份生成;坐标来自 PlacedPart(未缩放内容坐标),缩放交给画布舞台层。
import type { CssRule } from './recipes/kit.ts'
import { partNode } from './parts.ts'
import type { PageNode, UiFrameDoc } from './types.ts'

/** 底板内容结构:一个相对定位的板子,每个零件包一层绝对定位的 .uf-placed 壳 */
export function benchBody(doc: UiFrameDoc): PageNode {
  const children: PageNode[] = []
  for (const p of doc.placed) {
    const node = partNode(p.recipe)
    if (!node) continue
    children.push({
      tag: 'div',
      cls: 'uf-placed',
      attrs: {
        'data-uf-placed': p.id,
        style: `left:${p.x}px;top:${p.y}px`
      },
      children: [node]
    })
  }
  return { tag: 'div', cls: 'uf-board', children }
}

/** 底板样式(画布专属):板面相对定位充满内容区,零件壳绝对定位 + 抓取光标提示可拖 */
export const BENCH_RULES: CssRule[] = [
  {
    sel: '.uf-board',
    decls: [
      ['position', 'relative'],
      ['width', '100%'],
      // 板高吃满 iframe 视口:父级(body/html)没有定高,height:100% 会塌成 0,
      // 配 overflow:hidden 会把绝对定位的零件整个裁掉(看得见框、点不中)
      ['min-height', '100vh'],
      ['box-sizing', 'border-box'],
      ['overflow', 'hidden']
    ]
  },
  {
    sel: '.uf-placed',
    decls: [
      ['position', 'absolute'],
      // 零件不撑满板子:宽度随内容,拖动时按左上角坐标定位
      ['width', 'max-content'],
      ['cursor', 'grab']
    ]
  },
  {
    sel: '.uf-placed:active',
    decls: [['cursor', 'grabbing']]
  },
  {
    sel: '.uf-placed :where(input, button, a, label)',
    decls: [['cursor', 'grab']]
  }
]
