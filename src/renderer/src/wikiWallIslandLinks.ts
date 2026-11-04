// 线索桌远景的岛间连线:纯函数。缩远时卡与卡之间的引用线成百上千条,画出来只是一团红线、还拖慢合成;
// 改成每对有引用的岛只画一条,统一粗细(条数只进悬停提示)。近景照旧画卡与卡的线,不经这里。
import type { WikiWallLink } from '../../shared/wikiTypes'
import { wallGroupTitles } from './wikiWallGroups.ts'
import { sagPath, type WallPlacedCard } from './wikiWallLayout.ts'

/** 岛间线的屏幕粗细(像素):与近景 1:1 时的常规引用红线(wiki-wall-board.css 的 is-strong 档)一样粗,
 * 不按条数加粗 —— 粗细不一在远景里像主次之分,其实只是条数差 */
export const WALL_ISLAND_LINE_PX = 2.2

export interface WallIslandLink {
  /** 两端岛名,按字典序排好,from < to */
  from: string
  to: string
  /** 两岛之间的卡片引用线条数(不分方向) */
  count: number
  x1: number
  y1: number
  x2: number
  y2: number
  d: string
}

/** 岛心:岛上各卡中心的平均点,跟着手摆位置走 */
function islandCenters(
  cards: readonly WallPlacedCard[],
  islandOf: Map<string, string>
): Map<string, { x: number; y: number }> {
  const sums = new Map<string, { x: number; y: number; n: number }>()
  for (const placed of cards) {
    const island = islandOf.get(placed.card.pageId)!
    const sum = sums.get(island) ?? { x: 0, y: 0, n: 0 }
    sum.x += placed.x + placed.w / 2
    sum.y += placed.y + placed.h / 2
    sum.n += 1
    sums.set(island, sum)
  }
  const centers = new Map<string, { x: number; y: number }>()
  for (const [island, sum] of sums) centers.set(island, { x: sum.x / sum.n, y: sum.y / sum.n })
  return centers
}

/**
 * 把卡与卡的引用线按岛聚合:同岛的不画,跨岛的每对岛一条,从岛心连到岛心。
 * 只看引用线;从属线讲的是「这张属于那一组」,远景里岛本身已经交代了。
 */
export function wallIslandLinks(
  cards: readonly WallPlacedCard[],
  links: readonly WikiWallLink[]
): WallIslandLink[] {
  const islandOf = wallGroupTitles(cards.map((placed) => placed.card))
  const counts = new Map<string, { from: string; to: string; count: number }>()
  for (const link of links) {
    if (link.kind !== 'reference') continue
    const a = islandOf.get(link.from)
    const b = islandOf.get(link.to)
    if (a === undefined || b === undefined || a === b) continue
    const [from, to] = a < b ? [a, b] : [b, a]
    const key = `${from}\n${to}`
    const entry = counts.get(key) ?? { from, to, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  const centers = islandCenters(cards, islandOf)
  return [...counts.values()]
    .sort((p, q) => (p.from === q.from ? (p.to < q.to ? -1 : 1) : p.from < q.from ? -1 : 1))
    .map(({ from, to, count }) => {
      const a = centers.get(from)!
      const b = centers.get(to)!
      const { d } = sagPath(a.x, a.y, b.x, b.y)
      return {
        from,
        to,
        count,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        d
      }
    })
}
