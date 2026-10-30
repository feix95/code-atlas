// 可见图的边归并:把引用端点映射到屏幕上可见的最近祖先,焦点外的端点映射为外部节点。
// 两端的映射规则各自独立;聚合与度数计算也在这里,供可见图组装复用。
import type { DepEdge } from './types.ts'
import type { GroupTree } from './hierarchy.ts'
import type { LevelEdge, LevelNode, VisibleEntry, VisibleNode } from './visibleGraph.ts'

interface Endpoint {
  id: string
  inside: boolean
  target: 'file' | 'folder'
}

/** 焦点内:沿路径下钻到最深的可见节点;中间的展开容器会把端点留在自己或更深一级 */
function insideEndpoint(
  filePath: string,
  prefix: string,
  visible: ReadonlyMap<string, VisibleEntry>
): Endpoint {
  const parts = filePath.slice(prefix.length).split('/')
  let id = prefix + parts[0]
  for (let i = 1; i < parts.length; i++) {
    const next = `${id}/${parts[i]}`
    if (!visible.has(next)) break
    id = next
  }
  return { id, inside: true, target: id === filePath ? 'file' : 'folder' }
}

/** 焦点外:映射到与焦点最近公共祖先的下一级(现行层外规则) */
function outsideEndpoint(filePath: string, focus: string): Endpoint {
  const dirParts = focus === '' ? [] : focus.split('/')
  const parts = filePath.split('/')
  let common = 0
  while (common < dirParts.length && common < parts.length - 1) {
    if (dirParts[common] !== parts[common]) break
    common++
  }
  const id = parts.slice(0, common + 1).join('/')
  return { id, inside: false, target: id === filePath ? 'file' : 'folder' }
}

function mapEndpoint(
  filePath: string,
  focus: string,
  visible: ReadonlyMap<string, VisibleEntry>
): Endpoint {
  const prefix = focus === '' ? '' : focus + '/'
  return filePath.startsWith(prefix)
    ? insideEndpoint(filePath, prefix, visible)
    : outsideEndpoint(filePath, focus)
}

function isAncestor(
  visible: ReadonlyMap<string, VisibleEntry>,
  ancestorId: string,
  id: string
): boolean {
  let parentId = visible.get(id)?.parentId ?? null
  while (parentId) {
    if (parentId === ancestorId) return true
    parentId = visible.get(parentId)?.parentId ?? null
  }
  return false
}

function externalNode(endpoint: Endpoint): VisibleNode {
  return {
    id: endpoint.id,
    kind: 'external',
    label: endpoint.id.split('/').pop() ?? endpoint.id,
    degree: 0,
    descendantFiles: 0,
    target: endpoint.target,
    depth: 0
  }
}

export interface ResolvedPairs {
  pairs: Array<[string, string]>
  externals: VisibleNode[]
}

export function resolvePairs(
  tree: GroupTree,
  depEdges: readonly DepEdge[],
  focus: string,
  visible: ReadonlyMap<string, VisibleEntry>
): ResolvedPairs {
  const known = tree.allFiles()
  const externals = new Map<string, VisibleNode>()
  const pairs: Array<[string, string]> = []
  for (const edge of depEdges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue
    const a = mapEndpoint(edge.from, focus, visible)
    const b = mapEndpoint(edge.to, focus, visible)
    if (!a.inside && !b.inside) continue
    // 端点落在自己的祖先容器上:这是容器与自身内容的包含关系,不是引用
    if (
      a.inside &&
      b.inside &&
      (isAncestor(visible, a.id, b.id) || isAncestor(visible, b.id, a.id))
    )
      continue
    for (const endpoint of [a, b]) {
      if (endpoint.inside || externals.has(endpoint.id)) continue
      externals.set(endpoint.id, externalNode(endpoint))
    }
    pairs.push([a.id, b.id])
  }
  return { pairs, externals: [...externals.values()] }
}

export function aggregate(pairs: ReadonlyArray<[string, string]>): LevelEdge[] {
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

export function computeDegrees(nodes: LevelNode[], edges: LevelEdge[]): void {
  const deg = new Map<string, number>()
  for (const edge of edges) {
    deg.set(edge.from, (deg.get(edge.from) ?? 0) + edge.weight)
    deg.set(edge.to, (deg.get(edge.to) ?? 0) + edge.weight)
  }
  for (const node of nodes) node.degree = deg.get(node.id) ?? 0
}
