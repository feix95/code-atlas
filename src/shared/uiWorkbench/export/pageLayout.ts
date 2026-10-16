// 整页渲染布局(纯逻辑,无 React / DOM):画布 iframe 里画整个页面用的 CSS + 要摆的元素清单。
// 顶层画板各自按 frameDocument + artboardCss 出一份(与导出同源,画布所见即导出所得),
// 直接放在页面上的对象按页面坐标绝对定位;同级顺序 = 数组顺序,后面的盖在前面上。
// 隐藏的(含被隐藏的画板里的)不在清单里。
import { visibleNodes, type SceneNode } from '../scene.ts'
import { childrenOf } from '../tree.ts'
import { artboardCss, nodesCss } from './cssAdapter.ts'
import { frameDocument } from './frameDocument.ts'

/** 画布 iframe 里放整页内容的根容器类名(平移缩放的 transform 挂在它上面) */
export const PAGE_ROOT_CLASS = 'uwb-root'
/** 画板容器的类名前缀:同屏多个画板各用 前缀 + 画板 id,免得 .artboard 规则撞车 */
export const FRAME_BOX_PREFIX = 'frame-box-'

export interface PageLayoutItem {
  /** 顶层节点 id */
  id: string
  /** 画板的页面坐标(散放节点不用,各自的 CSS 里已带位置) */
  x: number
  y: number
  /** 画板容器类名;散放节点为 null */
  rootClass: string | null
  /** 画板内按绘制顺序排的后代 id */
  childIds: readonly string[]
}

export interface PageLayout {
  css: string
  items: readonly PageLayoutItem[]
}

export function pageLayout(nodes: readonly SceneNode[]): PageLayout {
  const visible = visibleNodes(nodes)
  const css: string[] = []
  const items: PageLayoutItem[] = []
  for (const node of childrenOf(visible, null)) {
    if (node.type !== 'frame') {
      css.push(nodesCss([node]))
      items.push({ id: node.id, x: 0, y: 0, rootClass: null, childIds: [] })
      continue
    }
    const doc = frameDocument(visible, node.id)
    if (!doc) continue
    const rootClass = `${FRAME_BOX_PREFIX}${node.id}`
    css.push(artboardCss(doc, rootClass))
    items.push({
      id: node.id,
      x: node.x,
      y: node.y,
      rootClass,
      childIds: doc.nodes.map((n) => n.id)
    })
  }
  return { css: css.join('\n\n'), items }
}
