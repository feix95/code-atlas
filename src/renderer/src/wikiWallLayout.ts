// 卡片墙布局:纯函数,把卡片摆成「线索桌」——按主题结成一座座小岛,横屏比例一屏看全,
// 岛与岛高低错落、线绳相连,岛上的卡大多留缝、少数轻轻叠压,每张卡带种子决定的小角度。
// 位置只由卡片标识、主题链与连线决定:同一份数据每次摆出来都一样。连线从图钉到图钉,画成自然下垂的线绳。
// 摆岛的算法在 wikiWallIslands.ts;这里负责卡片尺寸、角度、叠放次序、区名胶带与连线。
import type { WikiWallCard, WikiWallLink } from '../../shared/wikiTypes'
import { wallGroupTitles } from './wikiWallGroups.ts'
import { layoutIslands, type IslandEdge } from './wikiWallIslands.ts'
import { wallSeed } from './wikiWallSettle.ts'

export { wallSeed }
export { WALL_ROOT_REGION, wallGroupTitles } from './wikiWallGroups.ts'

/** 主题页卡按包含文件数分大、中、小三档,桌面上自然有高低差 */
export const WALL_LEAF_W = 214
export const WALL_LEAF_H = 146
const LEAF_BIG = { w: 244, h: 160 }
const LEAF_SMALL = { w: 190, h: 124 }
/** 文件数到这个数就用大卡,不超过 LEAF_SMALL_MAX 用小卡 */
const LEAF_BIG_FROM = 8
const LEAF_SMALL_MAX = 2
export const WALL_HEAD_W = 268
export const WALL_HEAD_H = 172
export const WALL_ROOT_W = 246
export const WALL_ROOT_H = 162
export const WALL_PAD = 56
/** 区名胶带高度:板面顶部要给最上面一座岛的胶带留位置 */
const TAPE_H = 44
/** 最大倾角(度) */
const TILT = 3

export interface WallPlacedCard {
  card: WikiWallCard
  x: number
  y: number
  w: number
  h: number
  /** 卡片倾角(度),以卡片顶边中点为轴 */
  tilt: number
  /** 图钉位置(板面坐标),线绳挂在这里 */
  pinX: number
  pinY: number
}

export interface WallRegion {
  title: string
  /** 团内卡片数 */
  count: number
  x: number
  y: number
  w: number
  h: number
  /** 区名胶带的位置:贴在岛上最靠上那张卡的左上方 */
  tapeX: number
  tapeY: number
  /** 区名胶带的倾角(度) */
  tilt: number
}

export type WallLineTier = 'strong' | 'medium' | 'faint'

export interface WallPlacedLink {
  link: WikiWallLink
  x1: number
  y1: number
  x2: number
  y2: number
  /** 下垂曲线的控制点 */
  cx: number
  cy: number
  /** 现成的 SVG path:二次贝塞尔,从起点图钉垂到终点图钉 */
  d: string
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

function sizeOf(card: WikiWallCard): { w: number; h: number } {
  if (card.kind === 'root') return { w: WALL_ROOT_W, h: WALL_ROOT_H }
  if (card.kind === 'overview') return { w: WALL_HEAD_W, h: WALL_HEAD_H }
  if (card.memberCount >= LEAF_BIG_FROM) return LEAF_BIG
  if (card.memberCount <= LEAF_SMALL_MAX) return LEAF_SMALL
  return { w: WALL_LEAF_W, h: WALL_LEAF_H }
}

/** 连线换成摆岛用的亲密度:跨页引用按条数,主题内从属只算半条,免得目录卡把整团拽成一坨 */
function edgesOf(cards: WikiWallCard[], links: WikiWallLink[]): IslandEdge[] {
  const index = new Map(cards.map((card, i) => [card.pageId, i]))
  const out: IslandEdge[] = []
  for (const link of links) {
    const a = index.get(link.from)
    const b = index.get(link.to)
    if (a === undefined || b === undefined || a === b) continue
    out.push({ a, b, weight: link.kind === 'contains' ? 0.5 : link.weight })
  }
  return out
}

export function sagPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { cx: number; cy: number; d: string } {
  const dist = Math.hypot(x2 - x1, y2 - y1)
  const sag = Math.min(120, dist * 0.18) + 10
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2 + sag
  const r = (n: number): number => Math.round(n * 10) / 10
  return { cx, cy, d: `M${r(x1)} ${r(y1)} Q${r(cx)} ${r(cy)} ${r(x2)} ${r(y2)}` }
}

/** 按卡片当前位置把连线挂到图钉上;两端有一端不在板上的线丢掉 */
export function placeWallLinks(
  placed: ReadonlyMap<string, WallPlacedCard>,
  links: WikiWallLink[]
): WallPlacedLink[] {
  const out: WallPlacedLink[] = []
  for (const link of links) {
    const from = placed.get(link.from)
    const to = placed.get(link.to)
    if (from === undefined || to === undefined || from === to) continue
    const curve = sagPath(from.pinX, from.pinY, to.pinX, to.pinY)
    out.push({
      link,
      x1: from.pinX,
      y1: from.pinY,
      x2: to.pinX,
      y2: to.pinY,
      ...curve,
      tier: wallTierOf(link)
    })
  }
  return out
}

export function layoutWikiWall(cards: WikiWallCard[], links: WikiWallLink[]): WikiWallLayout {
  // 根主题排最前,其余保持卡片出现顺序:分岛与区名胶带都按这个顺序来
  const ordered = [
    ...cards.filter((card) => card.kind === 'root'),
    ...cards.filter((card) => card.kind !== 'root')
  ]
  const sizes = ordered.map(sizeOf)
  const groupOf = wallGroupTitles(ordered)
  const groupTitle = (card: WikiWallCard): string => groupOf.get(card.pageId)!
  const { centers, islands } = layoutIslands(
    ordered.map((card, i) => ({
      id: card.pageId,
      group: groupTitle(card),
      head: card.kind !== 'leaf',
      w: sizes[i].w,
      h: sizes[i].h
    })),
    edgesOf(ordered, links)
  )
  let minX = Infinity
  let minY = Infinity
  centers.forEach((c, i) => {
    minX = Math.min(minX, c.x - sizes[i].w / 2)
    minY = Math.min(minY, c.y - sizes[i].h / 2)
  })
  const placed = new Map<string, WallPlacedCard>()
  let width = 0
  let height = 0
  ordered.forEach((card, i) => {
    const { w, h } = sizes[i]
    const x = Math.round(centers[i].x - w / 2 - minX + WALL_PAD)
    const y = Math.round(centers[i].y - h / 2 - minY + WALL_PAD + TAPE_H)
    const tilt =
      Math.round(
        (wallSeed(`${card.pageId}:r`) * 2 - 1) * TILT * (card.kind === 'leaf' ? 1 : 0.6) * 100
      ) / 100
    placed.set(card.pageId, { card, x, y, w, h, tilt, pinX: x + w / 2, pinY: y + 4 })
    width = Math.max(width, x + w + WALL_PAD)
    height = Math.max(height, y + h + WALL_PAD)
  })

  // 区名胶带贴在每座主岛最靠上那张卡的左上方;卫星岛不另贴
  const regions: WallRegion[] = []
  const groupCount = new Map<string, number>()
  for (const card of ordered)
    groupCount.set(groupTitle(card), (groupCount.get(groupTitle(card)) ?? 0) + 1)
  for (const island of islands) {
    if (!island.tape) continue
    const members = island.members.map((i) => placed.get(ordered[i].pageId)!)
    const x = Math.min(...members.map((m) => m.x))
    const y = Math.min(...members.map((m) => m.y))
    const top = members.reduce((a, b) => (b.y < a.y ? b : a))
    regions.push({
      title: island.group,
      count: groupCount.get(island.group) ?? members.length,
      x,
      y,
      tapeX: top.x - 8,
      tapeY: top.y - TAPE_H + 6,
      w: Math.max(...members.map((m) => m.x + m.w)) - x,
      h: Math.max(...members.map((m) => m.y + m.h)) - y,
      tilt: Math.round((wallSeed(`region:${island.group}`) * 2 - 1) * 2.5 * 100) / 100
    })
  }

  // 叠放次序:越靠右下越在上面,叠压时只压住别人的右下边角,标题与图钉总露在外面
  const stacked = [...placed.values()].sort((a, b) => a.y + a.x * 0.5 - (b.y + b.x * 0.5))
  return { cards: stacked, regions, links: placeWallLinks(placed, links), width, height }
}

/** 与某张卡直接相连的卡(含自身):悬停或选中时只把这些卡与它们之间的线点亮 */
export function wallNeighbors(links: WikiWallLink[], pageId: string): Set<string> {
  const near = new Set<string>([pageId])
  for (const link of links) {
    if (link.from === pageId) near.add(link.to)
    if (link.to === pageId) near.add(link.from)
  }
  return near
}
