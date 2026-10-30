// 语义缩放的纯判定:节点屏幕直径跨过阈值时决定原地展开或收起容器。
// 只做几何与深度判定;lazy 扫描与节点上限由展开状态 hook 处理。
import { GRAPH_ZOOM } from './graphConfig.ts'

export interface ZoomNode {
  id: string
  /** 世界坐标半径(已展开容器用容器半径) */
  r: number
  /** 离焦点的层数:焦点直接子项为 1 */
  depth: number
  /** 文件夹才可展开;文件不参与 */
  isFolder: boolean
}

export interface ZoomRules {
  expandPx: number
  collapsePx: number
  autoExpandDepth: number
}

export interface ZoomDecision {
  expand: string[]
  collapse: string[]
}

export function zoomDecisions(
  nodes: readonly ZoomNode[],
  scale: number,
  expanded: ReadonlySet<string>,
  rules: ZoomRules = GRAPH_ZOOM
): ZoomDecision {
  const expand: string[] = []
  const collapse: string[] = []
  for (const node of nodes) {
    if (!node.isFolder) continue
    const diameter = 2 * node.r * scale
    if (expanded.has(node.id)) {
      if (diameter < rules.collapsePx) collapse.push(node.id)
      continue
    }
    // 自动展开只到焦点下 autoExpandDepth 级:再深就靠双击或进入文件夹
    if (node.depth >= rules.autoExpandDepth) continue
    if (diameter > rules.expandPx) expand.push(node.id)
  }
  return { expand, collapse }
}
