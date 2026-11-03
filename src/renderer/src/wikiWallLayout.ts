// 卡片墙布局:纯函数,把卡片按主题分区摆成稳定位置,连线按权重分轻重档。
// 位置即层级:根主题卡在顶部带,同区同排即并行同级;布局只由主题链决定,不受力、不弹跳。
import type { WikiWallCard, WikiWallLink } from '../../shared/wikiTypes'

export const WALL_CARD_W = 248
export const WALL_CARD_H = 138
export const WALL_HEAD_H = 168
const GAP = 22
const REGION_GAP = 44
const PAD = 28
const COLUMNS = 3

export interface WallPlacedCard {
  card: WikiWallCard
  x: number
  y: number
  w: number
  h: number
}

export interface WallRegion {
  title: string
  x: number
  y: number
  w: number
  h: number
}

export type WallLineTier = 'strong' | 'medium' | 'faint'

export interface WallPlacedLink {
  link: WikiWallLink
  x1: number
  y1: number
  x2: number
  y2: number
  tier: WallLineTier
}

export interface WikiWallLayout {
  cards: WallPlacedCard[]
  regions: WallRegion[]
  links: WallPlacedLink[]
  width: number
  height: number
}

/** 引用线轻重:权重 1 为弱、2 至 4 为中、5 起为强;从属线恒为弱档结构线 */
export function wallTierOf(link: WikiWallLink): WallLineTier {
  if (link.kind === 'contains') return 'faint'
  if (link.weight >= 5) return 'strong'
  if (link.weight >= 2) return 'medium'
  return 'faint'
}

export function layoutWikiWall(cards: WikiWallCard[], links: WikiWallLink[]): WikiWallLayout {
  const placed = new Map<string, WallPlacedCard>()
  const regions: WallRegion[] = []
  let cursorY = PAD

  const place = (card: WikiWallCard, x: number, y: number, head: boolean): void => {
    placed.set(card.pageId, {
      card,
      x,
      y,
      w: WALL_CARD_W,
      h: head ? WALL_HEAD_H : WALL_CARD_H
    })
  }

  // 顶部带:根主题卡横排
  const roots = cards.filter((card) => card.kind === 'root')
  roots.forEach((card, index) => {
    place(card, PAD + index * (WALL_CARD_W + GAP), cursorY, true)
  })
  if (roots.length > 0) cursorY += WALL_HEAD_H + REGION_GAP

  // 分区:按主题链首段分组,保持卡片出现顺序
  const regionOrder: string[] = []
  const byRegion = new Map<string, WikiWallCard[]>()
  for (const card of cards) {
    if (card.kind === 'root') continue
    const key = card.topicPath[0] ?? ''
    if (!byRegion.has(key)) {
      byRegion.set(key, [])
      regionOrder.push(key)
    }
    byRegion.get(key)!.push(card)
  }

  for (const key of regionOrder) {
    const members = byRegion.get(key)!
    const heads = members.filter((card) => card.kind === 'overview')
    const leaves = members.filter((card) => card.kind === 'leaf')
    const regionY = cursorY
    let innerY = regionY + PAD
    heads.forEach((card, index) => {
      place(card, PAD + index * (WALL_CARD_W + GAP), innerY, true)
    })
    if (heads.length > 0) innerY += WALL_HEAD_H + GAP
    leaves.forEach((card, index) => {
      const col = index % COLUMNS
      const row = Math.floor(index / COLUMNS)
      place(card, PAD + col * (WALL_CARD_W + GAP), innerY + row * (WALL_CARD_H + GAP), false)
    })
    const rows = Math.ceil(leaves.length / COLUMNS)
    const regionH = innerY - regionY + (rows > 0 ? rows * WALL_CARD_H + (rows - 1) * GAP : 0) + PAD
    const widest = Math.max(heads.length, Math.min(leaves.length, COLUMNS), 1)
    regions.push({
      title: key,
      x: 0,
      y: regionY,
      w: PAD * 2 + widest * WALL_CARD_W + (widest - 1) * GAP,
      h: regionH
    })
    cursorY = regionY + regionH + REGION_GAP
  }

  const placedCards = [...placed.values()]
  const width = Math.max(
    PAD * 2 + COLUMNS * WALL_CARD_W + (COLUMNS - 1) * GAP,
    ...regions.map((region) => region.w),
    roots.length > 0 ? PAD * 2 + roots.length * WALL_CARD_W + (roots.length - 1) * GAP : 0
  )
  const linksPlaced: WallPlacedLink[] = []
  for (const link of links) {
    const from = placed.get(link.from)
    const to = placed.get(link.to)
    if (from === undefined || to === undefined) continue
    linksPlaced.push({
      link,
      x1: from.x + from.w / 2,
      y1: from.y + from.h / 2,
      x2: to.x + to.w / 2,
      y2: to.y + to.h / 2,
      tier: wallTierOf(link)
    })
  }
  return { cards: placedCards, regions, links: linksPlaced, width, height: cursorY + PAD }
}
