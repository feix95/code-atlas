// 力导向布局(d3-force)的生命周期:同层数据更新(如引用关系晚到)时按 id 保留节点位置,
// 只做温和重排;切换层级时新节点从原点附近出生,首帧之前同步预跑到接近稳定。模拟只算坐标,不碰 DOM。
// 展开容器的子项只在生长动画期间钉在槽位上,之后和圈外节点一样自由受力,只受容器边界约束。
import { useCallback, useEffect, useRef } from 'react'
import {
  forceLink,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum
} from 'd3-force'
import type { LevelNode, VisibleGraph, VisibleNode } from '@shared/graphView'
import { GRAPH_FORCE, GRAPH_NODE } from './graphConfig.ts'
import { forceCluster, type ClusterForce } from './forceCluster.ts'
import {
  applyContainerSlots,
  forceContainerSlots,
  growContainer,
  stepContainerGrowth
} from './containerLayout.ts'
import { packContainerChildren, type Slot } from './containerPack.ts'
import { clampToContainers, forceContain } from './forceContain.ts'
import { forceChargeOutsideContainers, forceLabelCollide, forcePairCollide } from './forceGroups.ts'
import { forceOrphanGravity, isOrphanNode } from './forceOrphan.ts'
import { createLabelMetrics, truncateLabel, type LabelMetrics } from './graphText.ts'

import { settleLayout } from './settleLayout.ts'

export interface SimNode extends SimulationNodeDatum {
  id: string
  data: VisibleNode
  /** 离焦点的层数:容器约束按它从外到内排序 */
  depth: number
  r: number
  /** 下方标签的宽度(世界坐标);容器名画在圆内,为 0 */
  labelWidth: number
  /** 直接上级容器;焦点直接子项为 null */
  parent: SimNode | null
  /** 出生站位与展开动画用的槽位;生长结束后失效,不参与后续布局 */
  slot: Slot | null
  x: number
  y: number
}

export interface SimLink {
  source: SimNode
  target: SimNode
  weight: number
}

export interface ForceScene {
  dirRel: string
  nodes: SimNode[]
  links: SimLink[]
}

export function nodeRadius(n: LevelNode): number {
  switch (n.kind) {
    case 'folder':
      return Math.min(
        GRAPH_NODE.folderRadiusMax,
        GRAPH_NODE.folderRadiusMin + Math.sqrt(n.descendantFiles) * GRAPH_NODE.folderRadiusStep
      )
    case 'file':
      return Math.min(
        GRAPH_NODE.fileRadiusMax,
        GRAPH_NODE.fileRadiusMin + Math.sqrt(n.degree) * GRAPH_NODE.fileRadiusStep
      )
    case 'external':
      return GRAPH_NODE.externalRadius
    case 'overflow':
      return GRAPH_NODE.overflowRadius
  }
}

function spawn(): number {
  return (Math.random() - 0.5) * 2 * GRAPH_FORCE.spawnJitter
}

export function buildScene(
  level: VisibleGraph,
  prev: ForceScene | null,
  metrics: LabelMetrics
): ForceScene {
  const keep =
    prev && prev.dirRel === level.dirRel ? new Map(prev.nodes.map((n) => [n.id, n])) : null
  const fresh: SimNode[] = []
  const nodes: SimNode[] = level.nodes.map((data) => {
    const old = keep?.get(data.id)
    const node: SimNode = {
      id: data.id,
      data,
      depth: data.depth,
      r: nodeRadius(data),
      labelWidth: data.isContainer === true ? 0 : metrics.measure(truncateLabel(data.label)),
      parent: null,
      slot: null,
      x: old?.x ?? spawn(),
      y: old?.y ?? spawn(),
      vx: old?.vx,
      vy: old?.vy
    }
    if (!old) fresh.push(node)
    return node
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const node of nodes) {
    const parentId = node.data.parentId
    node.parent = parentId ? (byId.get(parentId) ?? null) : null
  }
  // 容器内部按标签盒排布:槽位相对父容器,半径由实际盒子边界反推。
  // 自下而上,内层容器先定半径,外层才装得下它
  const containers = nodes.filter((node) => node.data.isContainer).sort((a, b) => b.depth - a.depth)
  for (const container of containers) {
    const children = nodes.filter((node) => node.parent === container)
    const layout = packContainerChildren(
      children.map((child) => ({
        id: child.id,
        radius: child.r,
        labelWidth: child.labelWidth
      })),
      metrics.labelHeight,
      metrics.measure(truncateLabel(container.data.label))
    )
    for (const child of children) child.slot = layout.slots.get(child.id) ?? null
    container.r = layout.radius
  }
  // 新子项落在自己的槽位上;父节点可能也是新节点,按层数从外到内落位。
  // 槽位只决定出生站位与展开动画,之后子项交给力自由游走
  for (const node of fresh.sort((a, b) => a.depth - b.depth)) {
    if (!node.parent || !node.slot) continue
    node.x = node.parent.x + node.slot.dx
    node.y = node.parent.y + node.slot.dy
  }
  const links: SimLink[] = []
  for (const e of level.edges) {
    const source = byId.get(e.from)
    const target = byId.get(e.to)
    if (source && target) links.push({ source, target, weight: e.weight })
  }
  return { dirRel: level.dirRel, nodes, links }
}

export function createSimulation(
  onTick: () => void,
  cluster: ClusterForce<SimNode>,
  labelHeight: number
): Simulation<SimNode, SimLink> {
  // 容器代表一整块展开区域:它只随用户拖拽移动,不受引力、斥力、碰撞推移,
  // 否则整块区域会被四周的节点一路挤走
  const isContainer = (node: SimNode): boolean => node.data.isContainer === true
  // 圈外节点拉向全图原点;容器内的子项拉向自己的容器中心,免得被圈外节点一路推到墙边
  const anchorX = (node: SimNode): number => node.parent?.x ?? 0
  const anchorY = (node: SimNode): number => node.parent?.y ?? 0
  const gravity = (node: SimNode): number => (isContainer(node) ? 0 : GRAPH_FORCE.gravity)
  return (
    forceSimulation<SimNode, SimLink>()
      .velocityDecay(GRAPH_FORCE.velocityDecay)
      .force(
        'charge',
        forceChargeOutsideContainers<SimNode>(
          GRAPH_FORCE.charge,
          GRAPH_FORCE.chargeMaxDistance,
          isContainer
        )
      )
      .force(
        'link',
        forceLink<SimNode, SimLink>()
          .id((n) => n.id)
          .distance(GRAPH_FORCE.linkDistance)
          .strength(GRAPH_FORCE.linkStrength)
      )
      .force('x', forceX<SimNode>(anchorX).strength(gravity))
      .force('y', forceY<SimNode>(anchorY).strength(gravity))
      .force('orphan', forceOrphanGravity<SimNode>(GRAPH_FORCE.orphanGravity, isOrphanNode))
      .force('collide', forcePairCollide<SimNode>(GRAPH_FORCE.collidePadding, isContainer))
      .force('cluster', cluster)
      .force('contain', forceContain<SimNode>(labelHeight))
      .force('slots', forceContainerSlots<SimNode>())
      // 最后再按标签盒收一次:前面的力可能把字又挤回一起
      .force(
        'labels',
        forceLabelCollide<SimNode>(labelHeight, GRAPH_FORCE.labelPadding, isContainer)
      )
      .on('tick', onTick)
  )
}

export interface ForceLayout {
  sceneRef: React.RefObject<ForceScene | null>
  /** 拖拽开始 / 结束:保持热度或让模拟自然冷却 */
  setDragging: (dragging: boolean) => void
}

/** 给本次新展开的容器挂生长动画;同层重建时才动画,切层由淡入淡出负责 */
function markContainerGrowth(scene: ForceScene, prev: ForceScene | null, now: number): boolean {
  if (!prev || prev.dirRel !== scene.dirRel) return false
  const wasContainer = new Set(
    prev.nodes.filter((node) => node.data.isContainer === true).map((node) => node.id)
  )
  let started = false
  for (const node of scene.nodes) {
    if (node.data.isContainer !== true || wasContainer.has(node.id)) continue
    growContainer(node, nodeRadius(node.data), now)
    started = true
  }
  return started
}

/** 节点 id → 聚类力所用的模块 id;null = 关闭聚类力(无模块数据或关闭「模块着色」) */
export type ClusterMap = ReadonlyMap<string, string> | null

export function useForceLayout(
  level: VisibleGraph | null,
  onTick: () => void,
  clusters: ClusterMap
): ForceLayout {
  const sceneRef = useRef<ForceScene | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const clusterRef = useRef<ClusterForce<SimNode> | null>(null)
  const clustersRef = useRef<ClusterMap>(clusters)
  const onTickRef = useRef(onTick)
  useEffect(() => {
    onTickRef.current = onTick
  })

  useEffect(() => {
    // 容器不参与聚类力:整块展开区域不该被模块质心拖着走;容器内子项也不参与,
    // 它们已被容器分组,拉向圆外的模块质心只会让它们贴着墙
    const cluster = forceCluster<SimNode>(
      (n) =>
        n.data.isContainer === true || n.parent !== null
          ? null
          : (clustersRef.current?.get(n.id) ?? null),
      0
    )
    clusterRef.current = cluster
    const labelHeight = createLabelMetrics().labelHeight
    const sim = createSimulation(
      () => {
        // 积分在力之后:向外的速度可能把子项带出容器边缘,画之前补夹一次;
        // 生长动画中的父容器这帧也在长,槽位要按它的新进度重新钉
        if (sceneRef.current) {
          stepContainerGrowth(sceneRef.current.nodes, performance.now())
          clampToContainers(sceneRef.current.nodes, labelHeight)
          applyContainerSlots(sceneRef.current.nodes)
        }
        onTickRef.current()
      },
      cluster,
      labelHeight
    )
    simRef.current = sim
    return () => {
      sim.stop()
      simRef.current = null
    }
  }, [])

  // 开关「模块着色」等同层分组变化:换聚类分组并温和重排。写在层级 effect 之前:
  // 切换层级时两者同轮触发,先换好分组,再由层级 effect 带着新分组同步预跑
  useEffect(() => {
    clustersRef.current = clusters
    clusterRef.current?.strength(clusters ? GRAPH_FORCE.clusterStrength : 0)
    const sim = simRef.current
    if (sim && sceneRef.current) sim.alpha(Math.max(sim.alpha(), 0.3)).restart()
  }, [clusters])

  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    if (!level) {
      sceneRef.current = null
      sim.nodes([]).stop()
      onTickRef.current()
      return
    }
    const sameLevel = sceneRef.current?.dirRel === level.dirRel
    const prevScene = sceneRef.current
    const metrics = createLabelMetrics()
    const scene = buildScene(level, prevScene, metrics)
    // 新展开的容器先摆好生长起点,首帧就是从中心散开的起点而不是已经铺满
    if (sameLevel && markContainerGrowth(scene, prevScene, performance.now())) {
      applyContainerSlots(scene.nodes)
    }
    sceneRef.current = scene
    sim.nodes(scene.nodes)
    sim.force<ReturnType<typeof forceLink<SimNode, SimLink>>>('link')?.links(scene.links)
    if (sameLevel) {
      sim.alpha(0.3).restart()
      return
    }
    // 新层级:首帧之前同步预跑到接近稳定,打开即是最终布局,不再边散开边自动缩放
    sim.stop().alpha(1)
    settleLayout(sim, GRAPH_FORCE.settleAlpha, GRAPH_FORCE.settleMaxTicks)
    clampToContainers(scene.nodes, metrics.labelHeight)
    applyContainerSlots(scene.nodes)
    sim.restart()
  }, [level])

  const setDragging = useCallback((dragging: boolean) => {
    const sim = simRef.current
    if (!sim) return
    sim.alphaTarget(dragging ? GRAPH_FORCE.dragAlphaTarget : 0)
    if (dragging) sim.restart()
  }, [])

  return { sceneRef, setDragging }
}
