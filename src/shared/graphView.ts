// 关系图谱的单层视图模型(drill-down):画布一次只呈现一个目录的直接子项。
// 引用边按归并规则(edge aggregation)映射到直接子项;一端在当前目录外的边,
// 外部端点映射为外部节点(与当前目录最近公共祖先的下一级路径)。纯函数,不依赖 DOM。
import type { DepEdge, ScanDirNode, ScanTreeNode } from './types.ts'

/** 单层节点上限(不含外部节点):超限时按度数保留前 N-1 个,其余归并为一个 overflow 节点 */
export const GRAPH_LEVEL_MAX_NODES = 150

/** overflow 节点 id 的后缀:含冒号,Windows 文件名不可能出现,不会与 relPath 撞车 */
export const OVERFLOW_ID_SUFFIX = '::overflow'

export type LevelNodeKind = 'folder' | 'file' | 'external' | 'overflow'

export interface LevelNode {
  /** relPath;overflow 节点为 `${dirRel}${OVERFLOW_ID_SUFFIX}` */
  id: string
  kind: LevelNodeKind
  /** 标签文字:取路径最后一段(外部节点的完整路径即 id) */
  label: string
  /** 归并后相连边的权重之和 */
  degree: number
  /** 文件夹:已扫描的后代文件数;其余为 0 */
  descendantFiles: number
  /** 文件夹尚未扫描(扫描器 lazy 目录) */
  lazy?: boolean
  /** 外部节点指向的是文件还是目录 */
  target?: 'file' | 'folder'
  /** overflow 节点收纳的子项数 */
  hiddenCount?: number
}

export interface LevelEdge {
  from: string
  to: string
  /** 归并进这条边的原始引用条数 */
  weight: number
}

export interface LevelGraph {
  dirRel: string
  /** 当前目录本身尚未扫描:界面应先扫描再展示 */
  lazy: boolean
  nodes: LevelNode[]
  edges: LevelEdge[]
}

function findDirNode(root: ScanDirNode, relPath: string): ScanDirNode | null {
  if (root.relPath === relPath) return root
  for (const child of root.children) {
    if (child.type !== 'directory') continue
    if (relPath === child.relPath || relPath.startsWith(child.relPath + '/')) {
      return findDirNode(child, relPath)
    }
  }
  return null
}

function collectFilePaths(node: ScanTreeNode, into: Set<string>): number {
  if (node.type === 'file') {
    into.add(node.relPath)
    return 1
  }
  let count = 0
  for (const child of node.children) count += collectFilePaths(child, into)
  return count
}

interface Endpoint {
  id: string
  inside: boolean
  target: 'file' | 'folder'
}

/** 把一个文件 relPath 映射到当前视角下的节点 id(见文件头归并规则) */
function mapEndpoint(filePath: string, dirRel: string): Endpoint {
  const prefix = dirRel === '' ? '' : dirRel + '/'
  if (filePath.startsWith(prefix)) {
    const id = prefix + filePath.slice(prefix.length).split('/')[0]
    return { id, inside: true, target: id === filePath ? 'file' : 'folder' }
  }
  const dirParts = dirRel.split('/')
  const parts = filePath.split('/')
  let common = 0
  while (common < dirParts.length && common < parts.length - 1) {
    if (dirParts[common] !== parts[common]) break
    common++
  }
  const id = parts.slice(0, common + 1).join('/')
  return { id, inside: false, target: id === filePath ? 'file' : 'folder' }
}

function aggregate(pairs: Array<[string, string]>): LevelEdge[] {
  const byKey = new Map<string, LevelEdge>()
  for (const [from, to] of pairs) {
    if (from === to) continue
    const key = JSON.stringify([from, to])
    const hit = byKey.get(key)
    if (hit) hit.weight++
    else byKey.set(key, { from, to, weight: 1 })
  }
  return [...byKey.values()]
}

function computeDegrees(nodes: LevelNode[], edges: LevelEdge[]): void {
  const deg = new Map<string, number>()
  for (const e of edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + e.weight)
    deg.set(e.to, (deg.get(e.to) ?? 0) + e.weight)
  }
  for (const n of nodes) n.degree = deg.get(n.id) ?? 0
}

function childNodes(dirNode: ScanDirNode, known: Set<string>): LevelNode[] {
  const folders: LevelNode[] = []
  const files: LevelNode[] = []
  for (const child of dirNode.children) {
    if (child.type === 'directory') {
      folders.push({
        id: child.relPath,
        kind: 'folder',
        label: child.name,
        degree: 0,
        descendantFiles: collectFilePaths(child, known),
        ...(child.lazy ? { lazy: true } : {})
      })
    } else {
      known.add(child.relPath)
      files.push({
        id: child.relPath,
        kind: 'file',
        label: child.name,
        degree: 0,
        descendantFiles: 0
      })
    }
  }
  return [...folders, ...files]
}

/** 超限时按度数(并列保持原顺序)保留前 max-1 个子项,其余收进 overflow 节点;返回被收纳的 id */
function applyOverflow(children: LevelNode[], dirRel: string, max: number): Set<string> {
  const hidden = new Set<string>()
  if (children.length <= max) return hidden
  const ranked = children
    .map((n, i) => ({ n, i }))
    .sort((a, b) => b.n.degree - a.n.degree || a.i - b.i)
  const keep = new Set(ranked.slice(0, max - 1).map((r) => r.n.id))
  for (const n of children) if (!keep.has(n.id)) hidden.add(n.id)
  const kept = children.filter((n) => keep.has(n.id))
  children.length = 0
  children.push(...kept, {
    id: dirRel + OVERFLOW_ID_SUFFIX,
    kind: 'overflow',
    label: `其余 ${hidden.size} 项`,
    degree: 0,
    descendantFiles: 0,
    hiddenCount: hidden.size
  })
  return hidden
}

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
  const dirNode = findDirNode(tree, dirRel)
  if (!dirNode) return null
  const known = new Set<string>()
  collectFilePaths(tree, known)
  const children = childNodes(dirNode, known)
  const externals = new Map<string, LevelNode>()
  const pairs: Array<[string, string]> = []
  for (const e of depEdges) {
    if (!known.has(e.from) || !known.has(e.to)) continue
    const a = mapEndpoint(e.from, dirRel)
    const b = mapEndpoint(e.to, dirRel)
    if (!a.inside && !b.inside) continue
    for (const p of [a, b]) {
      if (p.inside || externals.has(p.id)) continue
      externals.set(p.id, {
        id: p.id,
        kind: 'external',
        label: p.id.split('/').pop() ?? p.id,
        degree: 0,
        descendantFiles: 0,
        target: p.target
      })
    }
    pairs.push([a.id, b.id])
  }
  let edges = aggregate(pairs)
  computeDegrees(children, edges)
  const hidden = applyOverflow(children, dirRel, maxNodes)
  if (hidden.size > 0) {
    const overflowId = dirRel + OVERFLOW_ID_SUFFIX
    const remap = (id: string): string => (hidden.has(id) ? overflowId : id)
    edges = aggregate(
      edges.flatMap((e) => Array<[string, string]>(e.weight).fill([remap(e.from), remap(e.to)]))
    )
  }
  const nodes = [...children, ...externals.values()]
  computeDegrees(nodes, edges)
  return { dirRel, lazy: dirNode.lazy ?? false, nodes, edges }
}
