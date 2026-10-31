// 展开容器里子项的出生位置与展开动画:子项按槽位落位,展开时按同一进度从容器中心
// 散到槽位;动画结束后槽位失效,子项交给力模拟自由游走,只受容器边界约束。
// 槽位本身的排布见 containerPack.ts。
import { GRAPH_MOTION } from './graphConfig.ts'
import type { Slot } from './containerPack.ts'

export interface SlotNode {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  depth: number
  parent: SlotNode | null
  slot: Slot | null
  /** 新展开容器的生长动画;null / 缺省 = 已定型 */
  grow?: Growth | null
}

/** 原地展开时的生长动画:进度按时间推进,槽位按进度从容器中心散开 */
export interface Growth {
  start: number
  /** 0..1,缓动后的进度 */
  progress: number
  fromRadius: number
  targetRadius: number
}

/** 给新展开的容器挂上生长:半径从原文件夹那样的小圆起步,子项暂时贴回中心 */
export function growContainer<N extends SlotNode & { r: number }>(
  container: N,
  fromRadius: number,
  now: number
): void {
  container.grow = {
    start: now,
    progress: 0,
    fromRadius,
    targetRadius: container.r
  }
  container.r = fromRadius
}

/** 推进生长动画;返回是否还有容器没长完 */
export function stepContainerGrowth<N extends SlotNode & { r: number }>(
  nodes: readonly N[],
  now: number
): boolean {
  let growing = false
  for (const node of nodes) {
    const grow = node.grow
    if (!grow) continue
    const t = Math.min(1, Math.max(0, (now - grow.start) / GRAPH_MOTION.containerGrowMs))
    const eased = 1 - (1 - t) ** 3
    grow.progress = eased
    node.r = grow.fromRadius + (grow.targetRadius - grow.fromRadius) * eased
    if (t >= 1) node.grow = null
    else growing = true
  }
  return growing
}

export interface SlotForce<N extends SlotNode> {
  (alpha: number): void
  initialize: (nodes: readonly N[]) => void
}

function pinSlots<N extends SlotNode>(ordered: readonly N[]): void {
  for (const node of ordered) {
    const { parent, slot } = node
    if (!parent || !slot || node.fx != null || node.fy != null) continue
    // 只认槽位的末班车:生长动画期间子项按进度从中心散开,动画一结束就放手交给力
    const grow = parent.grow
    if (!grow) continue
    node.x = (parent.fx ?? parent.x) + slot.dx * grow.progress
    node.y = (parent.fy ?? parent.y) + slot.dy * grow.progress
    node.vx = 0
    node.vy = 0
  }
}

/** 积分结束后再钉一次:父容器这一帧自己也在长大,只在受力阶段钉会迟一帧 */
export function applyContainerSlots<N extends SlotNode>(nodes: readonly N[]): void {
  pinSlots([...nodes].sort((a, b) => a.depth - b.depth))
}

/** 生长动画期间把子项钉在按进度散开的槽位上:展开时从容器中心散出去,期间不受力 */
export function forceContainerSlots<N extends SlotNode>(): SlotForce<N> {
  let ordered: readonly N[] = []
  const force = ((_alpha: number): void => {
    pinSlots(ordered)
  }) as SlotForce<N>
  force.initialize = (nodes) => {
    ordered = [...nodes].sort((a, b) => a.depth - b.depth)
  }
  return force
}
