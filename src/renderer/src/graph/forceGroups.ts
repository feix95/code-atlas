// 展开容器参与布局时的几处力修正:
// 子项被约束在容器内、始终离父容器很近,若照常互斥就永远消不掉,会把整张图一路推走。
// 所以成对碰撞跳过祖先与后代;容器本身不参与点电荷斥力。
// 容器与普通节点相撞时只推普通节点:容器代表一整块展开区域,推它等于让整个文件夹带着子项逃跑。
// 自由游走的节点还要按「圆 + 下方标签」的外框防挤:只按圆互斥挡不住又宽又扁的标签。
import { forceManyBody } from 'd3-force'
import { labelBox } from './nodeBox.ts'
import type { ContainNode } from './forceContain.ts'

export interface ContainPairForce<N extends ContainNode> {
  (alpha: number): void
  initialize: (nodes: readonly N[], random: () => number) => void
}

function isAncestor(ancestor: ContainNode, node: ContainNode): boolean {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

/** d3 forceCollide 的成对版本:两圆相交时按比例推开,祖先与后代之间跳过,容器不被普通节点推动 */
export function forcePairCollide<N extends ContainNode>(
  padding: number,
  isContainer: (node: N) => boolean
): ContainPairForce<N> {
  let nodes: readonly N[] = []
  const force = ((_alpha: number): void => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        if (isAncestor(a, b) || isAncestor(b, a)) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.hypot(dx, dy)
        const min = a.r + b.r + padding * 2
        if (distance >= min) continue
        const total = min - distance
        let aShare = 0.5
        if (isContainer(a) !== isContainer(b)) aShare = isContainer(a) ? 0 : 1
        const ux = distance > 1e-9 ? dx / distance : 1
        const uy = distance > 1e-9 ? dy / distance : 0
        a.x -= ux * total * aShare
        a.y -= uy * total * aShare
        b.x += ux * total * (1 - aShare)
        b.y += uy * total * (1 - aShare)
      }
    }
  }) as ContainPairForce<N>
  force.initialize = (next) => {
    nodes = next
  }
  return force
}

/** 点电荷斥力,但容器节点不参与:被容器罩住的子项离它太近,互斥只会把容器推成无休止漂移 */
export function forceChargeOutsideContainers<N extends ContainNode>(
  strength: number,
  distanceMax: number,
  isContainer: (node: N) => boolean
): ContainPairForce<N> {
  const inner = forceManyBody<N>().strength(strength).distanceMax(distanceMax)
  const force = ((alpha: number): void => inner(alpha)) as ContainPairForce<N>
  force.initialize = (nodes, random) => {
    inner.initialize(
      nodes.filter((node) => !isContainer(node)),
      random
    )
  }
  return force
}

export interface LabelBoxNode extends ContainNode {
  /** 节点下方标签的宽度;0 = 没有下方标签(容器名画在圆内) */
  labelWidth: number
}

export interface LabelCollideForce<N extends LabelBoxNode> {
  (alpha: number): void
  initialize: (nodes: readonly N[]) => void
}

/** 盒子相对节点中心的尺寸:外框不随节点移动变化,初始化时量一次 */
interface LabelExtent {
  halfWidth: number
  top: number
  bottom: number
  center: number
}

/**
 * 容器没有下方标签,占地就是圆本身。和圈外节点的标签盒相撞时按圆对盒算:
 * 方包围盒的四个空角会被当成实体,把圈外节点多顶出一截,离容器壁忽远忽近。
 */
function pushBoxOutOfCircle(
  container: LabelBoxNode,
  node: LabelBoxNode,
  extent: LabelExtent,
  padding: number
): void {
  const left = node.x - extent.halfWidth
  const right = node.x + extent.halfWidth
  const top = node.y + extent.top
  const bottom = node.y + extent.bottom
  const nearestX = Math.max(left, Math.min(container.x, right))
  const nearestY = Math.max(top, Math.min(container.y, bottom))
  const dx = nearestX - container.x
  const dy = nearestY - container.y
  const distance = Math.hypot(dx, dy)
  // 容器半径随展开动画在长,读实时半径
  const min = container.r + padding * 2
  if (distance >= min) return
  let ux: number
  let uy: number
  if (distance > 1e-9) {
    ux = dx / distance
    uy = dy / distance
  } else {
    ux = node.x >= container.x ? 1 : -1
    uy = 0
  }
  node.x += ux * (min - distance)
  node.y += uy * (min - distance)
}

/**
 * 「圆 + 下方标签」整盒防挤:圆碰撞挡不住又宽又扁的标签,节点一挤,字就叠在一起。
 * 沿重叠较浅的轴把两盒推开;容器和正在拖拽的节点不动,只让可动的让位。
 * 容器与子项天然重叠,必须像圆碰撞一样跳过祖先与后代,否则子项会被永远推着走。
 */
export function forceLabelCollide<N extends LabelBoxNode>(
  labelHeight: number,
  padding: number,
  isContainer: (node: N) => boolean
): LabelCollideForce<N> {
  let nodes: readonly N[] = []
  let extents: LabelExtent[] = []
  const force = ((_alpha: number): void => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        if (isAncestor(a, b) || isAncestor(b, a)) continue
        const aContainer = isContainer(a)
        const bContainer = isContainer(b)
        const aFixed = aContainer || a.fx != null || a.fy != null
        const bFixed = bContainer || b.fx != null || b.fy != null
        if (aFixed && bFixed) continue
        // 容器只用圆占地:圈外节点贴着圆壁让开,不被方盒四角顶飞
        if (aContainer || bContainer) {
          const container = aContainer ? a : b
          const free = aContainer ? b : a
          pushBoxOutOfCircle(container, free, aContainer ? extents[j] : extents[i], padding)
          continue
        }
        const extentA = extents[i]
        const extentB = extents[j]
        const overlapX =
          Math.min(a.x + extentA.halfWidth, b.x + extentB.halfWidth) -
          Math.max(a.x - extentA.halfWidth, b.x - extentB.halfWidth) +
          padding * 2
        if (overlapX <= 0) continue
        const overlapY =
          Math.min(a.y + extentA.bottom, b.y + extentB.bottom) -
          Math.max(a.y + extentA.top, b.y + extentB.top) +
          padding * 2
        if (overlapY <= 0) continue
        const aShare = aFixed ? 0 : bFixed ? 1 : 0.5
        if (overlapX <= overlapY) {
          const dir = b.x >= a.x ? 1 : -1
          a.x -= dir * overlapX * aShare
          b.x += dir * overlapX * (1 - aShare)
        } else {
          // 容器不会走到这里;普通节点按整盒中心判上下,免得标签把中心拉偏
          const dir = b.y + extentB.center >= a.y + extentA.center ? 1 : -1
          a.y -= dir * overlapY * aShare
          b.y += dir * overlapY * (1 - aShare)
        }
      }
    }
  }) as LabelCollideForce<N>
  force.initialize = (next) => {
    nodes = next
    extents = next.map((node) => {
      const box = labelBox(0, 0, node.r, isContainer(node) ? 0 : node.labelWidth, labelHeight)
      return {
        halfWidth: box.right,
        top: box.top,
        bottom: box.bottom,
        center: (box.top + box.bottom) / 2
      }
    })
  }
  return force
}
