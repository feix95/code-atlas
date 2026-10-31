// 单层视图(drill-down)的兼容入口:P2 起内部改用可见图,展开集合恒为空。
// 可见图模型与纯函数在 visibleGraph.ts;本文件只保留旧签名,供现有调用与自测使用。
import type { DepEdge, ScanDirNode } from './types.ts'
import { folderTree } from './hierarchy.ts'
import { buildVisibleGraph, type VisibleGraph } from './visibleGraph.ts'

export {
  GRAPH_PREVIEW_NODES,
  OVERFLOW_ID_SUFFIX,
  type LevelEdge,
  type LevelGraph,
  type LevelNode,
  type LevelNodeKind,
  type VisibleGraph,
  type VisibleNode
} from './visibleGraph.ts'

const NO_EXPANSION: ReadonlySet<string> = new Set()

/**
 * 计算目录 dirRel 的单层视图;目录不在扫描树里返回 null。
 * 没有原地展开:焦点页直接子项全量呈现,预览额度不参与。
 */
export function buildLevelGraph(
  tree: ScanDirNode,
  depEdges: DepEdge[],
  dirRel: string
): VisibleGraph | null {
  return buildVisibleGraph(folderTree(tree), depEdges, dirRel, NO_EXPANSION)
}
