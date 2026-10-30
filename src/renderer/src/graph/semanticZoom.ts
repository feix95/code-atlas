// 语义缩放的纯判定:节点屏幕直径跨过阈值时决定原地展开或收起容器。
// 只做几何与深度判定;lazy 扫描与节点上限由展开状态 hook 处理。
import { GRAPH_VIEW, GRAPH_ZOOM } from './graphConfig.ts'
import type { ForceScene } from './useForceLayout.ts'

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
  /** 视口缩放下限:到限后继续往小滚视为回到总览,已展开容器一律收起 */
  minScale: number
}

export interface ZoomDecision {
  expand: string[]
  collapse: string[]
}

const DEFAULT_RULES: ZoomRules = { ...GRAPH_ZOOM, minScale: GRAPH_VIEW.minScale }

/** 当前场景里可参与判定的节点快照:已展开容器的 r 就是容器半径 */
export function zoomNodesOf(scene: ForceScene | null): ZoomNode[] {
  return (scene?.nodes ?? []).map((node) => ({
    id: node.id,
    r: node.r,
    depth: node.depth,
    isFolder: node.data.kind === 'folder'
  }))
}

export function zoomDecisions(
  nodes: readonly ZoomNode[],
  scale: number,
  expanded: ReadonlySet<string>,
  rules: ZoomRules = DEFAULT_RULES
): ZoomDecision {
  const expand: string[] = []
  const collapse: string[] = []
  // 大容器的半径 × 最小比例仍可能高于 collapsePx:不加这条,缩到底也收不回来
  const atFloor = scale <= rules.minScale + 1e-6
  for (const node of nodes) {
    if (!node.isFolder) continue
    const diameter = 2 * node.r * scale
    if (expanded.has(node.id)) {
      if (atFloor || diameter < rules.collapsePx) collapse.push(node.id)
      continue
    }
    // 自动展开只到焦点下 autoExpandDepth 级:再深就靠双击或进入文件夹
    if (node.depth >= rules.autoExpandDepth) continue
    if (diameter > rules.expandPx) expand.push(node.id)
  }
  return { expand, collapse }
}
