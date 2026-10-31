import assert from 'node:assert/strict'
import { forceLink, forceSimulation } from 'd3-force'
import {
  GRAPH_CONTAINER,
  GRAPH_MOTION,
  GRAPH_NODE,
  GRAPH_ZOOM
} from '../src/renderer/src/graph/graphConfig.ts'
import {
  applyContainerSlots,
  forceContainerSlots,
  growContainer,
  stepContainerGrowth,
  type SlotNode
} from '../src/renderer/src/graph/containerLayout.ts'
import {
  childBox,
  packContainerChildren,
  type LayoutChild
} from '../src/renderer/src/graph/containerPack.ts'
import {
  clampToContainers,
  forceContain,
  type ContainNode
} from '../src/renderer/src/graph/forceContain.ts'
import type { LabelMetrics } from '../src/renderer/src/graph/graphText.ts'
import {
  forceChargeOutsideContainers,
  forceLabelCollide,
  forcePairCollide
} from '../src/renderer/src/graph/forceGroups.ts'
import { boxesOverlap, farthestCorner, labelBox } from '../src/renderer/src/graph/nodeBox.ts'
import { forceCluster } from '../src/renderer/src/graph/forceCluster.ts'
import { forceOrphanGravity, isOrphanNode } from '../src/renderer/src/graph/forceOrphan.ts'
import {
  buildScene,
  createSimulation,
  type SimLink,
  type SimNode
} from '../src/renderer/src/graph/useForceLayout.ts'
import type { VisibleGraph } from '../src/shared/visibleGraph.ts'

// 容器布局自测:标签盒互不重叠且都在容器内;槽位跟随父容器;约束力兜住拖拽;
// 嵌套容器先约束外层再约束内层;布局按 parentId 接线并采用容器半径。

const METRICS: LabelMetrics = {
  fontPx: 12,
  fontFamily: 'sans-serif',
  labelHeight: 15,
  measure: (text) => text.length * 7
}

/** 出生抖动与 d3 的 jiggle 都走 Math.random:固定序列,让依赖初始位置的回归可复现 */
function seedRandom(seed: number): () => void {
  const original = Math.random
  let state = seed >>> 0
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  return () => {
    Math.random = original
  }
}

// 长文件名按实际标签宽度占位:任意两盒不重叠,四角都在容器内,排布可复现
{
  const children: LayoutChild[] = Array.from({ length: 40 }, (_, i) => ({
    id: `file-${i}.ts`,
    radius: 8,
    labelWidth: 180
  }))
  const layout = packContainerChildren(children, 15, 40)
  assert.equal(layout.slots.size, children.length)
  const boxes = children.map((child) => {
    const slot = layout.slots.get(child.id)
    assert.ok(slot, `${child.id} 应有槽位`)
    return { child, box: childBox(slot.dx, slot.dy, child, 15) }
  })
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]
      assert.ok(
        a.box.left >= b.box.right ||
          a.box.right <= b.box.left ||
          a.box.top >= b.box.bottom ||
          a.box.bottom <= b.box.top,
        `${a.child.id} 与 ${b.child.id} 的标签盒重叠`
      )
    }
    for (const [x, y] of [
      [a.box.left, a.box.top],
      [a.box.right, a.box.top],
      [a.box.left, a.box.bottom],
      [a.box.right, a.box.bottom]
    ]) {
      assert.ok(Math.hypot(x, y) <= layout.radius + 1e-6, `${a.child.id} 的标签盒越出容器`)
    }
  }
  const again = packContainerChildren(children, 15, 40)
  for (const child of children) {
    assert.deepEqual(
      again.slots.get(child.id),
      layout.slots.get(child.id),
      '同一组子项排布应可复现'
    )
  }
  assert.ok(layout.radius > 100, '长标签应把容器撑开,而不是叠在一起')
}

// 容器名称也要占位置:名称越宽、内容越靠上,半径越大;名称下方留出空白
{
  const one: LayoutChild[] = [{ id: 'a.ts', radius: 8, labelWidth: 60 }]
  const narrowName = packContainerChildren(one, 15, 20)
  const wideName = packContainerChildren(one, 15, 300)
  assert.ok(wideName.radius > narrowName.radius, '容器名更宽时半径应随之增大')

  const children: LayoutChild[] = Array.from({ length: 12 }, (_, i) => ({
    id: `f${i}.ts`,
    radius: 8,
    labelWidth: 180
  }))
  const layout = packContainerChildren(children, 15, 40)
  let contentTop = Infinity
  for (const child of children) {
    const slot = layout.slots.get(child.id)
    assert.ok(slot)
    contentTop = Math.min(contentTop, childBox(slot.dx, slot.dy, child, 15).top)
  }
  const nameBottom = -layout.radius + GRAPH_CONTAINER.labelGap + 15
  assert.ok(contentTop >= nameBottom, '容器名称下方应留出空间')

  const empty = packContainerChildren([], 15, 80)
  assert.ok(empty.radius >= 40, '空容器的半径要装下容器名')
  assert.equal(empty.slots.size, 0)
}

// 随机撒点排布:子项铺满各个方向,没有固定的行列;半径由内容预算,不失控
{
  const many: LayoutChild[] = Array.from({ length: 40 }, (_, i) => ({
    id: `long-file-${i}.ts`,
    radius: 8,
    labelWidth: 180
  }))
  const layout = packContainerChildren(many, 15, 40)
  assert.ok(layout.radius < 520, `40 个长标签的容器半径不应失控(实测 ${layout.radius.toFixed(1)})`)
  const sectors = new Set<number>()
  for (const slot of layout.slots.values()) {
    if (Math.hypot(slot.dx, slot.dy) < 1) continue
    const sector = Math.floor(((Math.atan2(slot.dy, slot.dx) + Math.PI) / (Math.PI * 2)) * 8)
    sectors.add(Math.min(7, sector))
  }
  assert.equal(sectors.size, 8, '子项应铺满各个方向,而不是叠成一列')

  const few: LayoutChild[] = Array.from({ length: 5 }, (_, i) => ({
    id: `f${i}.ts`,
    radius: 8,
    labelWidth: 70
  }))
  const small = packContainerChildren(few, 15, 40)
  assert.ok(small.radius < 140, `5 个短标签的容器半径不应失控(实测 ${small.radius.toFixed(1)})`)
  assert.ok(small.radius < layout.radius, '内容更多更大时容器应更大')
}

// 槽位只在生长动画期间生效:展开时子项按进度从中心散开;动画结束就放手,交给力自由游走
{
  interface SlotTestNode extends SlotNode {
    id: string
    r: number
  }
  const parent: SlotTestNode = {
    id: 'p',
    x: 100,
    y: 50,
    r: 120,
    depth: 1,
    parent: null,
    slot: null,
    fx: null,
    fy: null
  }
  const child: SlotTestNode = {
    id: 'c',
    x: 5,
    y: 5,
    r: 10,
    depth: 2,
    parent,
    slot: { dx: 20, dy: -10 },
    fx: null,
    fy: null
  }
  const force = forceContainerSlots<SlotTestNode>()
  force.initialize([child, parent])
  force(1)
  assert.equal(child.x, 5, '容器没在生长时槽位不钉住子项')
  assert.equal(child.y, 5)

  growContainer(parent, 18, 0)
  force(1)
  assert.equal(child.x, 100, '生长起点子项贴在容器中心')
  assert.equal(child.y, 50)

  stepContainerGrowth([parent, child], GRAPH_MOTION.containerGrowMs / 2)
  force(1)
  assert.ok(child.x > 100 && child.x < 120, '生长中子项按进度散开')
  assert.ok(child.y < 50 && child.y > 40)

  stepContainerGrowth([parent, child], GRAPH_MOTION.containerGrowMs)
  child.x = 33
  child.y = 44
  force(1)
  assert.equal(child.x, 33, '生长结束后槽位不再钉住子项')
  assert.equal(child.y, 44)
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

// 标签盒也要在圈内:宽标签按四角最远处夹;顶部横带留给容器名,子项不压名字
{
  const makeChild = (
    id: string,
    x: number,
    y: number,
    r: number,
    labelWidth: number,
    parent: TestNode
  ): TestNode => ({ id, x, y, r, depth: parent.depth + 1, parent, labelWidth })
  const parent = node('app', 0, 0, 200, 1)
  const wide = makeChild('app/a-long-name.ts', 400, 0, 8, 180, parent)
  clampToContainers([parent, wide], METRICS.labelHeight)
  const wideBox = labelBox(wide.x, wide.y, wide.r, wide.labelWidth ?? 0, METRICS.labelHeight)
  assert.ok(
    farthestCorner(wideBox) <= parent.r - GRAPH_ZOOM.containMargin + 1e-6,
    '宽标签整盒留在圈内(按四角最远处夹)'
  )
  assert.ok(wide.x < 400, '越界的宽标签子项被拉回')

  const narrow = makeChild('app/b.ts', 0, -300, 12, 0, parent)
  clampToContainers([parent, narrow], METRICS.labelHeight)
  const nameTop =
    -parent.r + GRAPH_CONTAINER.labelGap + METRICS.labelHeight + GRAPH_ZOOM.containerPadding
  assert.ok(narrow.y - narrow.r >= nameTop - 1e-6, '子项让开顶部容器名')
  assert.ok(
    Math.hypot(narrow.x - parent.x, narrow.y - parent.y) + narrow.r <= parent.r + 1e-6,
    '让位后仍在圈内'
  )
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
  const scene = buildScene(level, null, METRICS)
  const outer = scene.nodes.find((n) => n.id === 'outer')
  const inner = scene.nodes.find((n) => n.id === 'outer/inner')
  const leaf = scene.nodes.find((n) => n.id === 'outer/inner/a.ts')
  assert.ok(outer && inner && leaf)
  assert.equal(outer.parent, null)
  assert.equal(inner.parent, outer)
  assert.equal(leaf.parent, inner)
  for (const node of scene.nodes) {
    if (!node.parent) continue
    assert.ok(node.slot, `${node.id} 应有相对父容器的槽位`)
  }
  assert.ok(inner.r > GRAPH_NODE.folderRadiusMax, '容器半径来自子项标签盒,不是文件夹基础半径')
  assert.ok(outer.r > inner.r, '父容器半径包含子容器')
}

// 成对碰撞:祖先与后代紧挨着也不互相推;无亲缘关系的两圆按半径加间隙分开;容器只推普通节点
{
  const parent = node('p', 0, 0, 50, 1)
  const child = node('c', 4, 0, 10, 2)
  child.parent = parent
  const nested = forcePairCollide<TestNode>(6, () => false)
  nested.initialize([parent, child], () => 0.5)
  nested(1)
  assert.equal(parent.x, 0, '父容器不被子项推动')
  assert.equal(child.x, 4, '子项不被父容器推出')

  const a = node('a', 0, 0, 10)
  const b = node('b', 5, 0, 10)
  const apart = forcePairCollide<TestNode>(6, () => false)
  apart.initialize([a, b], () => 0.5)
  apart(1)
  const gap = Math.hypot(b.x - a.x, b.y - a.y)
  assert.ok(gap >= 10 + 10 + 12 - 1e-6, `无关节点要分开(实测 ${gap.toFixed(1)})`)

  // 容器与普通节点:只挪普通节点,容器留在原地,否则展开的文件夹会被四周一路挤走
  const box = node('box', 0, 0, 50)
  const file = node('file', 40, 0, 10)
  const pushed = forcePairCollide<TestNode>(6, (n) => n.id === 'box')
  pushed.initialize([box, file], () => 0.5)
  pushed(1)
  assert.equal(box.x, 0, '容器不被普通节点推动')
  assert.ok(file.x >= 50 + 10 + 12 - 1e-6, `普通节点让出容器(实测 ${file.x.toFixed(1)})`)
}

// 标签防挤:圆没碰但标签叠在一起的节点沿重叠较浅的轴让开;容器与被拖拽的节点不动;
// 容器与子项天然重叠,必须跳过祖先与后代
{
  interface LabelTestNode extends ContainNode {
    id: string
    labelWidth: number
  }
  const labeled = (
    id: string,
    x: number,
    y: number,
    r: number,
    labelWidth: number
  ): LabelTestNode => ({ id, x, y, r, depth: 0, parent: null, labelWidth })
  const isContainer = (n: LabelTestNode): boolean => n.labelWidth === 0
  const boxesApart = (a: LabelTestNode, b: LabelTestNode): boolean =>
    !boxesOverlap(
      labelBox(a.x, a.y, a.r, a.labelWidth, 15),
      labelBox(b.x, b.y, b.r, b.labelWidth, 15),
      0
    )

  const a = labeled('a.ts', 0, 0, 8, 120)
  const b = labeled('b.ts', 30, 0, 8, 120)
  const spread = forceLabelCollide<LabelTestNode>(15, 4, isContainer)
  spread.initialize([a, b])
  spread(1)
  assert.ok(boxesApart(a, b), '标签叠在一起的两个节点应被推开')
  assert.equal(a.x, 0, '横向空间够用时只沿纵向让位')
  assert.equal(b.x, 30)
  assert.ok(a.y < 0 && b.y > 0, '两个可动节点对称让位')

  const container = labeled('app', 0, 0, 50, 0)
  const file = labeled('file.ts', 0, 40, 8, 120)
  const against = forceLabelCollide<LabelTestNode>(15, 4, isContainer)
  against.initialize([container, file])
  against(1)
  assert.ok(container.x === 0 && container.y === 0, '容器不被标签防挤推动')
  assert.ok(file.y > 40, `容器旁的标签往外让位(实测 ${file.y.toFixed(1)})`)

  // 回归:子项本来就在父容器圆里,标签防挤跳过祖先与后代,不能把子项推出去
  const parent = labeled('app', 0, 0, 50, 0)
  const child = labeled('app/file.ts', 0, 20, 8, 120)
  child.parent = parent
  const inside = forceLabelCollide<LabelTestNode>(15, 4, isContainer)
  inside.initialize([parent, child])
  inside(1)
  assert.equal(child.x, 0, '父容器不能通过标签防挤推动子项')
  assert.equal(child.y, 20)

  // 回归:容器按圆参与防挤,方盒四角不算实体,圈外节点不会被空角顶开
  const circle = labeled('app2', 0, 0, 50, 0)
  const corner = labeled('corner.ts', 48, 48, 5, 10)
  const circleForce = forceLabelCollide<LabelTestNode>(15, 4, isContainer)
  circleForce.initialize([circle, corner])
  circleForce(1)
  assert.equal(corner.x, 48, '圆圈外、方盒角内的节点不应被推')
  assert.equal(corner.y, 48)

  // 拖拽中的节点由指针钉着,防挤力不能把它拽走,只能推旁边可动的节点
  const dragged = labeled('app/a.ts', 0, 0, 8, 120)
  dragged.fx = 0
  dragged.fy = 0
  const outsider = labeled('b.ts', 30, 0, 8, 120)
  const dragForce = forceLabelCollide<LabelTestNode>(15, 4, isContainer)
  dragForce.initialize([dragged, outsider])
  dragForce(1)
  assert.ok(dragged.x === 0 && dragged.y === 0, '拖拽中的节点不被标签防挤推动')
  assert.ok(outsider.y !== 0, '可动的节点让位')
}

// 生长动画:半径从原文件夹小圆长到装箱半径,子项槽位按同一进度从中心散开
{
  interface GrowthTestNode extends SlotNode {
    id: string
    r: number
  }
  const parent: GrowthTestNode = { id: 'p', x: 0, y: 0, r: 120, depth: 1, parent: null, slot: null }
  const child: GrowthTestNode = {
    id: 'c',
    x: 0,
    y: 0,
    r: 10,
    depth: 2,
    parent,
    slot: { dx: 100, dy: 0 }
  }
  growContainer(parent, 18, 0)
  assert.equal(parent.r, 18, '起点是原文件夹半径')
  assert.equal(parent.grow?.progress, 0, '起点进度为零')
  applyContainerSlots([parent, child])
  assert.equal(child.x, 0, '起点子项贴在容器中心')

  stepContainerGrowth([parent, child], GRAPH_MOTION.containerGrowMs / 2)
  assert.ok(parent.r > 18 && parent.r < 120, `中途半径在两端之间(实测 ${parent.r.toFixed(1)})`)
  applyContainerSlots([parent, child])
  assert.ok(child.x > 0 && child.x < 100, `中途槽位按进度散开(实测 ${child.x.toFixed(1)})`)

  stepContainerGrowth([parent, child], GRAPH_MOTION.containerGrowMs)
  assert.equal(parent.r, 120, '结束后等于装箱半径')
  assert.equal(parent.grow, null, '结束后不再生长')
  const lastPinned = child.x
  applyContainerSlots([parent, child])
  assert.equal(child.x, lastPinned, '动画结束后槽位不再钉住子项')
  assert.notEqual(child.x, 100, '子项停在动画最后一帧,而不是被拉到最终槽位')
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
  const scene = buildScene(level, null, METRICS)
  const orphan = scene.nodes.find((n) => n.id === 'README.md')
  assert.ok(orphan, '场景里有外围文件')
  orphan.x = 500
  orphan.y = 0
  const sim = createSimulation(
    () => {},
    forceCluster<SimNode>(() => null, 0),
    METRICS.labelHeight
  )
  sim.nodes(scene.nodes)
  const link = sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>
  link.links(scene.links)
  sim.stop().alpha(1)
  for (let i = 0; i < 300; i++) sim.tick()
  const distance = Math.hypot(orphan.x, orphan.y)
  assert.ok(distance < 200, `远处散户应被收回主体附近(实测 ${distance.toFixed(0)})`)
}

// 回归:展开容器后布局静止.子项在圈内自由受力,若碰撞推着容器,容器会无限漂移;
// 同时子项整盒必须留在圈内,不能被链接拉出墙外
{
  const restoreRandom = seedRandom(7)
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
  const scene = buildScene(level, null, METRICS)
  const sim = createSimulation(
    () => {},
    forceCluster<SimNode>(() => null, 0),
    METRICS.labelHeight
  )
  sim.nodes(scene.nodes)
  const link = sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>
  link.links(scene.links)
  sim.stop().alpha(1)
  for (let i = 0; i < 300; i++) {
    sim.tick()
    clampToContainers(scene.nodes, METRICS.labelHeight)
    applyContainerSlots(scene.nodes)
  }
  assert.ok(sim.force('labels'), '模拟里应挂上标签防挤力')
  const children = scene.nodes.filter((node) => node.parent)
  assert.ok(children.length > 0, '场景里有容器子项')
  let released = 0
  for (const node of children) {
    const parent = node.parent
    assert.ok(parent)
    if (
      node.slot &&
      (Math.abs(node.x - parent.x - node.slot.dx) > 1e-3 ||
        Math.abs(node.y - parent.y - node.slot.dy) > 1e-3)
    ) {
      released++
    }
    const box = labelBox(
      node.x - parent.x,
      node.y - parent.y,
      node.r,
      node.labelWidth,
      METRICS.labelHeight
    )
    assert.ok(
      farthestCorner(box) <= parent.r + 1e-6,
      `${node.id} 的整盒应在容器圈内(实测 ${farthestCorner(box).toFixed(1)} / ${parent.r.toFixed(1)})`
    )
  }
  assert.ok(released > 0, '生长结束后子项应交还给力,不再钉在槽位上')
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i]
      const b = children[j]
      assert.ok(
        !boxesOverlap(
          labelBox(a.x, a.y, a.r, a.labelWidth, METRICS.labelHeight),
          labelBox(b.x, b.y, b.r, b.labelWidth, METRICS.labelHeight),
          0
        ),
        `${a.id} 与 ${b.id} 的标签盒不应重叠`
      )
    }
  }
  const app = scene.nodes.find((n) => n.data.isContainer)
  assert.ok(app, '场景里有展开容器')
  const before = { x: app.x, y: app.y }
  sim.alpha(0.3)
  for (let i = 0; i < 300; i++) {
    sim.tick()
    clampToContainers(scene.nodes, METRICS.labelHeight)
    applyContainerSlots(scene.nodes)
  }
  const drift = Math.hypot(app.x - before.x, app.y - before.y)
  assert.ok(drift < 1, `重组后容器应原地不动(实测漂移 ${drift.toFixed(1)})`)
  restoreRandom()
}

console.log('selftest-graphcontain: 全部通过')
