// 卡片墙布局:纯函数,把卡片摆成「线索桌」——按主题成团、团内错落网格,每张卡带种子决定的小角度与抖动。
// 位置只由卡片标识与主题链决定:同一份数据每次摆出来都一样,不受力、不弹跳;
// 抖动幅度小于卡间距的一半,保证卡片互不压盖。连线从图钉到图钉,画成自然下垂的线绳。
import type { WikiWallCard, WikiWallLink } from '../../shared/wikiTypes'

export const WALL_LEAF_W = 214
export const WALL_LEAF_H = 150
export const WALL_HEAD_W = 268
export const WALL_HEAD_H = 172
export const WALL_ROOT_W = 246
export const WALL_ROOT_H = 162
const GAP_X = 34
const GAP_Y = 44
const REGION_GAP = 76
export const WALL_PAD = 56
/** 区名胶带占的高度:胶带贴在团块左上角,卡片从它下方开始摆 */
const TAPE_H = 44
/** 抖动上限(像素):必须小于 GAP 的一半,卡片才不会互相压住 */
const JITTER = 10
/** 最大倾角(度) */
const TILT = 3
/** 根主题区的固定名字;根主题卡没有主题链 */
export const WALL_ROOT_REGION = '总览'
/** 成团取主题链的前几段 */
export const WALL_GROUP_DEPTH = 2

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

/** 稳定的 0 到 1 伪随机数:同一字符串永远得到同一个值(FNV-1a) */
export function wallSeed(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 100000) / 100000
}

function sizeOf(card: WikiWallCard): { w: number; h: number } {
  if (card.kind === 'root') return { w: WALL_ROOT_W, h: WALL_ROOT_H }
  if (card.kind === 'overview') return { w: WALL_HEAD_W, h: WALL_HEAD_H }
  return { w: WALL_LEAF_W, h: WALL_LEAF_H }
}

interface Block {
  title: string
  heads: WikiWallCard[]
  leaves: WikiWallCard[]
  cols: number
  w: number
  h: number
}

/** 团内叶子列数:让团块大致横长,单张卡的小团不会被拉成一长条 */
function columnsFor(leafCount: number): number {
  if (leafCount <= 1) return 1
  return Math.max(2, Math.min(6, Math.ceil(Math.sqrt(leafCount * 1.6))))
}

function measureBlock(title: string, members: WikiWallCard[]): Block {
  const heads = members.filter((card) => card.kind !== 'leaf')
  const leaves = members.filter((card) => card.kind === 'leaf')
  const cols = columnsFor(leaves.length)
  const rows = Math.ceil(leaves.length / cols)
  let headsW = 0
  let headsH = 0
  for (const head of heads) {
    const size = sizeOf(head)
    headsW += (headsW > 0 ? GAP_X : 0) + size.w
    headsH = Math.max(headsH, size.h)
  }
  // 奇数行右错半个间距,网格看着不那么规整
  const leavesW =
    leaves.length > 0 ? cols * WALL_LEAF_W + (cols - 1) * GAP_X + (rows > 1 ? GAP_X : 0) : 0
  const leavesH = rows > 0 ? rows * WALL_LEAF_H + (rows - 1) * GAP_Y : 0
  return {
    title,
    heads,
    leaves,
    cols,
    w: Math.max(headsW, leavesW, 160),
    h: TAPE_H + headsH + (headsH > 0 && leavesH > 0 ? GAP_Y : 0) + leavesH
  }
}

function sagPath(
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

/** 卡片所在团的名字:根主题归「总览」,其余取主题链前两段;列表视图按它分组,与桌面成团一致 */
export function wallGroupTitle(card: WikiWallCard): string {
  if (card.kind === 'root') return WALL_ROOT_REGION
  return card.topicPath.slice(0, WALL_GROUP_DEPTH).join(' / ') || '未归类'
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
  // 分团:根主题单独一团放最前,其余按主题链分组,保持卡片出现顺序
  const order: string[] = []
  const groups = new Map<string, WikiWallCard[]>()
  const push = (key: string, card: WikiWallCard): void => {
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(card)
  }
  const roots = cards.filter((card) => card.kind === 'root')
  for (const card of roots) push(`\u0000${WALL_ROOT_REGION}`, card)
  // 按主题链前两段成团:只按第一段会把整个 src 堆成一大团,按最深一段又会碎成很多单卡小团
  for (const card of cards) {
    if (card.kind === 'root') continue
    push(card.topicPath.slice(0, WALL_GROUP_DEPTH).join(' / '), card)
  }
  const blocks = order.map((key) =>
    measureBlock(key.startsWith('\u0000') ? key.slice(1) : key, groups.get(key)!)
  )

  // 货架式排团:目标宽度取总面积的横长比,放不下就换行;团的先后保持主题顺序
  const area = blocks.reduce(
    (sum, block) => sum + (block.w + REGION_GAP) * (block.h + REGION_GAP),
    0
  )
  const widest = blocks.reduce((max, block) => Math.max(max, block.w), 0)
  const targetW = Math.max(widest, Math.sqrt(area * 1.7))

  const placed = new Map<string, WallPlacedCard>()
  const regions: WallRegion[] = []
  let shelfX = WALL_PAD
  let shelfY = WALL_PAD
  let shelfH = 0
  let boardW = 0

  const place = (card: WikiWallCard, baseX: number, baseY: number): void => {
    const { w, h } = sizeOf(card)
    const id = card.pageId
    const x = Math.round(baseX + (wallSeed(`${id}:x`) * 2 - 1) * JITTER)
    const y = Math.round(baseY + (wallSeed(`${id}:y`) * 2 - 1) * JITTER)
    const tilt =
      Math.round((wallSeed(`${id}:r`) * 2 - 1) * TILT * (card.kind === 'leaf' ? 1 : 0.6) * 100) /
      100
    placed.set(id, { card, x, y, w, h, tilt, pinX: x + w / 2, pinY: y + 4 })
  }

  for (const block of blocks) {
    if (shelfX > WALL_PAD && shelfX + block.w > WALL_PAD + targetW) {
      shelfX = WALL_PAD
      shelfY += shelfH + REGION_GAP
      shelfH = 0
    }
    const bx = shelfX
    const by = shelfY
    let cursorY = by + TAPE_H
    let headX = bx
    let headsH = 0
    for (const head of block.heads) {
      const size = sizeOf(head)
      place(head, headX, cursorY)
      headX += size.w + GAP_X
      headsH = Math.max(headsH, size.h)
    }
    if (headsH > 0 && block.leaves.length > 0) cursorY += headsH + GAP_Y
    block.leaves.forEach((card, index) => {
      const col = index % block.cols
      const row = Math.floor(index / block.cols)
      const stagger = row % 2 === 1 ? GAP_X : 0
      place(card, bx + stagger + col * (WALL_LEAF_W + GAP_X), cursorY + row * (WALL_LEAF_H + GAP_Y))
    })
    regions.push({
      title: block.title,
      count: block.heads.length + block.leaves.length,
      x: bx,
      y: by,
      w: block.w,
      h: block.h,
      tilt: Math.round((wallSeed(`region:${block.title}`) * 2 - 1) * 2.5 * 100) / 100
    })
    shelfX = bx + block.w + REGION_GAP
    shelfH = Math.max(shelfH, block.h)
    boardW = Math.max(boardW, bx + block.w)
  }

  const linksPlaced = placeWallLinks(placed, links)
  const bottom = blocks.length > 0 ? shelfY + shelfH : WALL_PAD
  return {
    cards: [...placed.values()],
    regions,
    links: linksPlaced,
    width: Math.round(boardW + WALL_PAD + JITTER),
    height: Math.round(bottom + WALL_PAD + 120)
  }
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
