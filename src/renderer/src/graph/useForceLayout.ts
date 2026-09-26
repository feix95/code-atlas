// 力导向布局(d3-force)的生命周期:同层数据更新(如引用关系晚到)时按 id 保留节点位置,
// 只做温和重排;切换层级时新节点从原点附近出生、由斥力散开。模拟只算坐标,不碰 DOM。
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

function createSimulation(onTick: () => void): Simulation<SimNode, SimLink> {
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
    .on('tick', onTick)
}

export interface ForceLayout {
  sceneRef: React.RefObject<ForceScene | null>
  /** 拖拽开始 / 结束:保持热度或让模拟自然冷却 */
  setDragging: (dragging: boolean) => void
  alpha: () => number
}

export function useForceLayout(level: LevelGraph | null, onTick: () => void): ForceLayout {
  const sceneRef = useRef<ForceScene | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const onTickRef = useRef(onTick)
  useEffect(() => {
    onTickRef.current = onTick
  })

  useEffect(() => {
    const sim = createSimulation(() => onTickRef.current())
    simRef.current = sim
    return () => {
      sim.stop()
      simRef.current = null
    }
  }, [])

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
    sim.alpha(sameLevel ? 0.3 : 1).restart()
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
