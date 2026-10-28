// 社区发现:文件级导入图 + 同目录偏置锚点 → Louvain → 一组组文件。
// 输入先排序再建图,graphology 按插入顺序遍历,配合固定种子保证结果与输入顺序无关。
import { UndirectedGraph } from 'graphology'
import louvain from 'graphology-communities-louvain'
import type { DepEdge, ModuleParams } from '../shared/types.ts'
import { byCodeUnit, dirOf } from './pathOrder.ts'
import { createSeededRandom } from './seededRandom.ts'

/**
 * 图内节点键一律带前缀:文件 'f:',目录锚点 'd:'。两类键永不撞名;也避开 graphology 内部用普通对象存键时
 * '__proto__' 这类文件名引发的冲突。
 */
const fileKey = (relPath: string): string => `f:${relPath}`
const anchorKey = (dir: string): string => `d:${dir}`

/** 无向加权边:两个方向的引用各记 1;自引用不算 */
function pairWeights(edges: DepEdge[], members: Set<string>): [string, string, number][] {
  const weights = new Map<string, [string, string, number]>()
  for (const { from, to } of edges) {
    if (from === to || !members.has(from) || !members.has(to)) continue
    const [a, b] = from < to ? [from, to] : [to, from]
    const key = JSON.stringify([a, b])
    const entry = weights.get(key)
    if (entry) entry[2] += 1
    else weights.set(key, [a, b, 1])
  }
  return [...weights.values()].sort((x, y) => byCodeUnit(x[0], y[0]) || byCodeUnit(x[1], y[1]))
}

function addFolderAnchors(graph: UndirectedGraph, members: string[], affinity: number): void {
  const byDir = new Map<string, string[]>()
  for (const file of members) {
    const dir = dirOf(file)
    byDir.set(dir, [...(byDir.get(dir) ?? []), file])
  }
  for (const dir of [...byDir.keys()].sort(byCodeUnit)) {
    const files = byDir.get(dir) ?? []
    if (files.length < 2) continue
    const anchor = anchorKey(dir)
    graph.addNode(anchor)
    for (const file of files) graph.addEdge(anchor, fileKey(file), { weight: affinity })
  }
}

/**
 * 切出社区。members 为参与切分的文件(已排序、至少有一条项目内导入边);
 * 返回每个社区的成员(组内排序,组间按首个成员排序),虚拟锚点已移除。
 */
export function detectCommunities(
  members: string[],
  edges: DepEdge[],
  params: ModuleParams
): string[][] {
  if (members.length === 0) return []
  const graph = new UndirectedGraph()
  for (const file of members) graph.addNode(fileKey(file))
  for (const [a, b, weight] of pairWeights(edges, new Set(members))) {
    graph.addEdge(fileKey(a), fileKey(b), { weight })
  }
  addFolderAnchors(graph, members, params.folderAffinity)
  const mapping = louvain(graph, {
    getEdgeWeight: 'weight',
    resolution: params.resolution,
    rng: createSeededRandom(params.seed)
  })
  const groups = new Map<number, string[]>()
  for (const file of members) {
    const community = mapping[fileKey(file)]
    groups.set(community, [...(groups.get(community) ?? []), file])
  }
  return [...groups.values()].sort((x, y) => byCodeUnit(x[0], y[0]))
}
