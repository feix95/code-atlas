import assert from 'node:assert/strict'
import { forceSimulation } from 'd3-force'
import { GRAPH_NODE, GRAPH_ZOOM } from '../src/renderer/src/graph/graphConfig.ts'
import {
  clampToContainers,
  containerRadius,
  forceContain,
  type ContainNode
} from '../src/renderer/src/graph/forceContain.ts'
import { buildScene } from '../src/renderer/src/graph/useForceLayout.ts'
import type { VisibleGraph } from '../src/shared/visibleGraph.ts'

// 容器布局自测:半径随子项单调不减;约束力把越界子项拉回父容器;
// 嵌套容器先约束外层再约束内层;布局按 parentId 接线并采用容器半径。

// 半径随子项增加单调不减,空容器仍可点中
{
  let prev = -Infinity
  for (let count = 0; count <= 12; count++) {
    const radius = containerRadius(Array.from({ length: count }, () => ({ r: 10 })))
    assert.ok(radius >= prev, `${count} 个子项的容器半径不应变小`)
    prev = radius
  }
  assert.ok(containerRadius([]) >= GRAPH_NODE.folderRadiusMin, '空容器仍可点中')
  assert.ok(containerRadius([{ r: 8 }, { r: 8 }]) > containerRadius([{ r: 8 }]))
}

interface TestNode extends ContainNode {
  id: string
}

function node(id: string, x: number, y: number, r: number, depth = 0): TestNode {
  return { id, x, y, r, depth, parent: null }
}

// 约束力:越界子项被拉回;嵌套时内层容器先被外层夹住,子项再夹进内层
{
  const outer = node('outer', 0, 0, 200, 1)
  const inner = node('inner', 0, 0, 60, 2)
  inner.parent = outer
  const leafA = node('leafA', 500, 0, 10, 3)
  const leafB = node('leafB', -500, 400, 10, 3)
  leafA.parent = inner
  leafB.parent = inner
  const all = [outer, inner, leafA, leafB]
  const sim = forceSimulation(all).force('contain', forceContain()).stop()
  for (let i = 0; i < 30; i++) sim.tick()
  clampToContainers(all)
  const outerDist = Math.hypot(inner.x - outer.x, inner.y - outer.y)
  assert.ok(outerDist + inner.r <= outer.r + 1e-6, '内层容器落在父容器内')
  for (const leaf of [leafA, leafB]) {
    const dist = Math.hypot(leaf.x - inner.x, leaf.y - inner.y)
    assert.ok(dist + leaf.r <= inner.r + 1e-6, `${leaf.id} 落在容器内`)
  }
}

// 切向速度让积分后出界:约束力之后的夹取保证画出来的仍在容器内
{
  const parent = node('p', 0, 0, 100)
  const child = node('c', 0, 0, 10)
  child.parent = parent
  child.x = parent.r - child.r - GRAPH_ZOOM.containMargin
  child.vy = 40
  const sim = forceSimulation([parent, child]).force('contain', forceContain()).stop()
  sim.tick()
  clampToContainers([parent, child])
  const dist = Math.hypot(child.x - parent.x, child.y - parent.y)
  assert.ok(dist + child.r <= parent.r + 1e-6, '积分后补夹一次,子项仍在容器内')
}

// 布局接线:parentId 连到容器节点,容器半径自下而上累加
{
  const level: VisibleGraph = {
    dirRel: '',
    lazy: false,
    edges: [],
    nodes: [
      {
        id: 'outer',
        kind: 'folder',
        label: 'outer',
        degree: 0,
        descendantFiles: 5,
        depth: 1,
        isContainer: true
      },
      {
        id: 'outer/inner',
        kind: 'folder',
        label: 'inner',
        degree: 0,
        descendantFiles: 3,
        depth: 2,
        parentId: 'outer',
        isContainer: true
      },
      {
        id: 'outer/inner/a.ts',
        kind: 'file',
        label: 'a.ts',
        degree: 0,
        descendantFiles: 0,
        depth: 3,
        parentId: 'outer/inner'
      },
      {
        id: 'outer/inner/b.ts',
        kind: 'file',
        label: 'b.ts',
        degree: 0,
        descendantFiles: 0,
        depth: 3,
        parentId: 'outer/inner'
      },
      {
        id: 'outer/inner/c.ts',
        kind: 'file',
        label: 'c.ts',
        degree: 0,
        descendantFiles: 0,
        depth: 3,
        parentId: 'outer/inner'
      },
      {
        id: 'outer/d.ts',
        kind: 'file',
        label: 'd.ts',
        degree: 0,
        descendantFiles: 0,
        depth: 2,
        parentId: 'outer'
      }
    ]
  }
  const scene = buildScene(level, null)
  const outer = scene.nodes.find((n) => n.id === 'outer')
  const inner = scene.nodes.find((n) => n.id === 'outer/inner')
  const leaf = scene.nodes.find((n) => n.id === 'outer/inner/a.ts')
  assert.ok(outer && inner && leaf)
  assert.equal(outer.parent, null)
  assert.equal(inner.parent, outer)
  assert.equal(leaf.parent, inner)
  assert.ok(inner.r > GRAPH_NODE.folderRadiusMax, '容器半径来自子项,不是文件夹基础半径')
  assert.ok(outer.r > inner.r, '父容器半径包含子容器')
}

console.log('selftest-graphcontain: 全部通过')
