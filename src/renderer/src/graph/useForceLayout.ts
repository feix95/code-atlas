// 力导向布局(d3-force)的生命周期:同层数据更新(如引用关系晚到)时按 id 保留节点位置,
// 只做温和重排;切换层级时新节点从原点附近出生,首帧之前同步预跑到接近稳定。模拟只算坐标,不碰 DOM。
import { useCallback, useEffect, useRef } from 'react'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum
} from 'd3-force'
import type { LevelGraph, LevelNode } from '@shared/graphView'
import { GRAPH_FORCE, GRAPH_NODE } from './graphConfig'
import { forceCluster, type ClusterForce } from './forceCluster'
import { settleLayout } from './settleLayout'

export interface SimNode extends SimulationNodeDatum {
  id: string
  data: LevelNode
  r: number
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

function buildScene(level: LevelGraph, prev: ForceScene | null): ForceScene {
  const keep =
    prev && prev.dirRel === level.dirRel ? new Map(prev.nodes.map((n) => [n.id, n])) : null
  const nodes: SimNode[] = level.nodes.map((data) => {
    const old = keep?.get(data.id)
    return {
      id: data.id,
      data,
      r: nodeRadius(data),
      x: old?.x ?? spawn(),
      y: old?.y ?? spawn(),
      vx: old?.vx,
      vy: old?.vy
    }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links: SimLink[] = []
  for (const e of level.edges) {
    const source = byId.get(e.from)
    const target = byId.get(e.to)
    if (source && target) links.push({ source, target, weight: e.weight })
  }
  return { dirRel: level.dirRel, nodes, links }
}

function createSimulation(
  onTick: () => void,
  cluster: ClusterForce<SimNode>
): Simulation<SimNode, SimLink> {
  return forceSimulation<SimNode, SimLink>()
    .velocityDecay(GRAPH_FORCE.velocityDecay)
    .force(
      'charge',
      forceManyBody<SimNode>()
        .strength(GRAPH_FORCE.charge)
        .distanceMax(GRAPH_FORCE.chargeMaxDistance)
    )
    .force(
      'link',
      forceLink<SimNode, SimLink>()
        .id((n) => n.id)
        .distance(GRAPH_FORCE.linkDistance)
        .strength(GRAPH_FORCE.linkStrength)
    )
    .force('x', forceX<SimNode>(0).strength(GRAPH_FORCE.gravity))
    .force('y', forceY<SimNode>(0).strength(GRAPH_FORCE.gravity))
    .force(
      'collide',
      forceCollide<SimNode>((n) => n.r + GRAPH_FORCE.collidePadding)
    )
    .force('cluster', cluster)
    .on('tick', onTick)
}

export interface ForceLayout {
  sceneRef: React.RefObject<ForceScene | null>
  /** 拖拽开始 / 结束:保持热度或让模拟自然冷却 */
  setDragging: (dragging: boolean) => void
  alpha: () => number
}

/** 节点 id → 聚类力所用的模块 id;null = 关闭聚类力(无模块数据或关闭「模块着色」) */
export type ClusterMap = ReadonlyMap<string, string> | null

export function useForceLayout(
  level: LevelGraph | null,
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
    const cluster = forceCluster<SimNode>((n) => clustersRef.current?.get(n.id) ?? null, 0)
    clusterRef.current = cluster
    const sim = createSimulation(() => onTickRef.current(), cluster)
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
    const scene = buildScene(level, sceneRef.current)
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
    sim.restart()
  }, [level])

  const setDragging = useCallback((dragging: boolean) => {
    const sim = simRef.current
    if (!sim) return
    sim.alphaTarget(dragging ? GRAPH_FORCE.dragAlphaTarget : 0)
    if (dragging) sim.restart()
  }, [])

  const alpha = useCallback(() => simRef.current?.alpha() ?? 0, [])

  return { sceneRef, setDragging, alpha }
}
