// 单层视图(drill-down)的兼容入口:P2 起内部改用可见图,展开集合恒为空。
// 可见图模型与纯函数在 visibleGraph.ts;本文件只保留旧签名,供现有调用与自测使用。
import type { DepEdge, ScanDirNode } from './types.ts'
import { folderTree } from './hierarchy.ts'
import {
  GRAPH_LEVEL_MAX_NODES,
  buildVisibleGraph,
  isVisibleGraphRejection,
  type LevelGraph
} from './visibleGraph.ts'

export {
  GRAPH_LEVEL_MAX_NODES,
  OVERFLOW_ID_SUFFIX,
  type LevelEdge,
  type LevelGraph,
  type LevelNode,
  type LevelNodeKind,
  type VisibleGraph,
  type VisibleGraphRejection,
  type VisibleNode
} from './visibleGraph.ts'

const NO_EXPANSION: ReadonlySet<string> = new Set()

/**
 * 计算目录 dirRel 的单层视图;目录不在扫描树里返回 null。
 * 引用端点不在扫描树里(关系分析比扫描树新)的边直接跳过,不凭空造节点。
 */
export function buildLevelGraph(
  tree: ScanDirNode,
  depEdges: DepEdge[],
  dirRel: string,
  maxNodes: number = GRAPH_LEVEL_MAX_NODES
): LevelGraph | null {
  const graph = buildVisibleGraph(folderTree(tree), depEdges, dirRel, NO_EXPANSION, maxNodes)
  // 没有展开的容器:焦点层超限会收进 overflow 节点,不会走到拒绝分支
  return graph && !isVisibleGraphRejection(graph) ? graph : null
}
