import assert from 'node:assert/strict'
import { forceLink, forceSimulation } from 'd3-force'
import { GRAPH_NODE, GRAPH_ZOOM } from '../src/renderer/src/graph/graphConfig.ts'
import {
  clampToContainers,
  containerRadius,
  forceContain,
  type ContainNode
} from '../src/renderer/src/graph/forceContain.ts'
import {
  forceChargeOutsideContainers,
  forcePairCollide
} from '../src/renderer/src/graph/forceGroups.ts'
import { forceCluster } from '../src/renderer/src/graph/forceCluster.ts'
import { forceOrphanGravity, isOrphanNode } from '../src/renderer/src/graph/forceOrphan.ts'
import {
  buildScene,
  createSimulation,
  type SimLink,
  type SimNode
} from '../src/renderer/src/graph/useForceLayout.ts'
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

// 成对碰撞:祖先与后代紧挨着也不互相推;无亲缘关系的两圆按半径加间隙分开
{
  const parent = node('p', 0, 0, 50, 1)
  const child = node('c', 4, 0, 10, 2)
  child.parent = parent
  const nested = forcePairCollide<TestNode>(6)
  nested.initialize([parent, child], () => 0.5)
  nested(1)
  assert.equal(parent.x, 0, '父容器不被子项推动')
  assert.equal(child.x, 4, '子项不被父容器推出')

  const a = node('a', 0, 0, 10)
  const b = node('b', 5, 0, 10)
  const apart = forcePairCollide<TestNode>(6)
  apart.initialize([a, b], () => 0.5)
  apart(1)
  const gap = Math.hypot(b.x - a.x, b.y - a.y)
  assert.ok(gap >= 10 + 10 + 12 - 1e-6, `无关节点要分开(实测 ${gap.toFixed(1)})`)
}

// 点电荷斥力:容器不参与,文件之间照常互斥
{
  const box = node('box', 0, 0, 50)
  const a = node('a', 1, 0, 6)
  const b = node('b', -1, 0, 6)
  const charge = forceChargeOutsideContainers<TestNode>(-280, 900, (n) => n.id === 'box')
  const sim = forceSimulation([box, a, b]).force('charge', charge).stop()
  sim.tick()
  assert.equal(box.vx, 0, '容器不受点电荷斥力')
  assert.equal(box.vy, 0)
  assert.notEqual(a.vx, 0, '文件之间仍有斥力')
}

// 外围散户引力:只拉焦点层无引用的非容器节点;有引用、容器与容器内子项速度不变
{
  interface OrphanTestNode {
    id: string
    parent: unknown
    data: { degree: number; isContainer?: boolean }
    x: number
    y: number
  }
  const make = (
    id: string,
    parent: unknown,
    degree: number,
    isContainer = false
  ): OrphanTestNode => ({ id, parent, data: { degree, isContainer }, x: 100, y: 0 })
  const container = make('box', null, 0, true)
  const orphan = make('README.md', null, 0)
  const linked = make('main.ts', null, 2)
  const child = make('box/README.md', container, 0)
  const pull = forceOrphanGravity<OrphanTestNode>(0.3, isOrphanNode)
  pull.initialize([container, orphan, linked, child])
  pull(1)
  assert.ok(orphan.vx !== undefined && orphan.vx < 0, '焦点层无引用节点被拉向原点')
  assert.equal(linked.vx, undefined, '有引用的节点不受额外拉力')
  assert.equal(container.vx, undefined, '容器不受额外拉力')
  assert.equal(child.vx, undefined, '容器内子项不受额外拉力')

  const flatOrphan = make('flat/README.md', null, 0)
  const flatLinked = make('flat/main.ts', null, 2)
  const flat = forceOrphanGravity<OrphanTestNode>(0.3, isOrphanNode)
  flat.initialize([flatOrphan, flatLinked])
  flat(1)
  assert.equal(flatOrphan.vx, undefined, '没有展开容器的平铺总览不拉散户')
}

// 接线回归:createSimulation 挂上散户引力,展开容器后远处的无引用文件被收回主体附近
{
  const level: VisibleGraph = {
    dirRel: '',
    lazy: false,
    edges: [{ from: 'app/a.ts', to: 'app/b.ts', weight: 1 }],
    nodes: [
      {
        id: 'app',
        kind: 'folder',
        label: 'app',
        degree: 0,
        descendantFiles: 2,
        depth: 1,
        isContainer: true
      },
      {
        id: 'app/a.ts',
        kind: 'file',
        label: 'a.ts',
        degree: 1,
        descendantFiles: 0,
        depth: 2,
        parentId: 'app'
      },
      {
        id: 'app/b.ts',
        kind: 'file',
        label: 'b.ts',
        degree: 1,
        descendantFiles: 0,
        depth: 2,
        parentId: 'app'
      },
      { id: 'README.md', kind: 'file', label: 'README.md', degree: 0, descendantFiles: 0, depth: 1 }
    ]
  }
  const scene = buildScene(level, null)
  const orphan = scene.nodes.find((n) => n.id === 'README.md')
  assert.ok(orphan, '场景里有外围文件')
  orphan.x = 500
  orphan.y = 0
  const sim = createSimulation(
    () => {},
    forceCluster<SimNode>(() => null, 0)
  )
  sim.nodes(scene.nodes)
  const link = sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>
  link.links(scene.links)
  sim.stop().alpha(1)
  for (let i = 0; i < 300; i++) sim.tick()
  const distance = Math.hypot(orphan.x, orphan.y)
  assert.ok(distance < 200, `远处散户应被收回主体附近(实测 ${distance.toFixed(0)})`)
}

// 回归:展开容器后布局静止.子项被夹在容器里,若照常互斥会推着容器无限漂移
{
  const files = ['a', 'b', 'c', 'd', 'style'].map((name) => ({
    id: `app/${name}.ts`,
    kind: 'file' as const,
    label: `${name}.ts`,
    degree: 1,
    descendantFiles: 0,
    depth: 2,
    parentId: 'app'
  }))
  const level: VisibleGraph = {
    dirRel: '',
    lazy: false,
    edges: [
      { from: 'app/a.ts', to: 'lib1.ts', weight: 1 },
      { from: 'app/b.ts', to: 'lib1.ts', weight: 1 },
      { from: 'app/c.ts', to: 'lib2.ts', weight: 1 },
      { from: 'app/d.ts', to: 'lib2.ts', weight: 1 }
    ],
    nodes: [
      {
        id: 'app',
        kind: 'folder',
        label: 'app',
        degree: 0,
        descendantFiles: 5,
        depth: 1,
        isContainer: true
      },
      ...files,
      { id: 'lib1.ts', kind: 'file', label: 'lib1.ts', degree: 2, descendantFiles: 0, depth: 1 },
      { id: 'lib2.ts', kind: 'file', label: 'lib2.ts', degree: 2, descendantFiles: 0, depth: 1 }
    ]
  }
  const scene = buildScene(level, null)
  const sim = createSimulation(
    () => {},
    forceCluster<SimNode>(() => null, 0)
  )
  sim.nodes(scene.nodes)
  const link = sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>
  link.links(scene.links)
  sim.stop().alpha(1)
  for (let i = 0; i < 300; i++) {
    sim.tick()
    clampToContainers(scene.nodes)
  }
  const app = scene.nodes.find((n) => n.data.isContainer)
  assert.ok(app, '场景里有展开容器')
  const before = { x: app.x, y: app.y }
  sim.alpha(0.3)
  for (let i = 0; i < 300; i++) {
    sim.tick()
    clampToContainers(scene.nodes)
  }
  const drift = Math.hypot(app.x - before.x, app.y - before.y)
  assert.ok(drift < 20, `重组后容器应留在原地(实测漂移 ${drift.toFixed(1)})`)
}

console.log('selftest-graphcontain: 全部通过')
