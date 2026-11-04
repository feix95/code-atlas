// 卡片墙「小岛」排法:纯函数,只管把一堆矩形摆成横屏比例、成团错落的群岛。
// 1. 分岛:同主题一座岛;大岛里被三张以上同伴引用的叶子带着它的同伴自成卫星岛。
// 2. 岛内:中心卡居中,其余卡沿黄金角螺线散开后向心收拢,大多数卡之间留缝,约四分之一的卡对轻轻叠压。
// 3. 落岛:最大的岛放中间,其余按与已放岛的关系依次找位置,选整体最接近横屏、最紧凑、离亲近的岛最近的那个。
// 所有「随机」都来自卡片标识的种子:同一份数据每次摆出来都一样。

import { settle, wallSeed, type Box } from './wikiWallSettle.ts'

/** 板面目标横竖比:一屏横屏看全 */
export const WALL_ASPECT = 1.6
/** 岛与岛之间留的海 */
const SEA = 56
/** 叠压的卡对:两张卡在横竖两个方向上最多各穿插合宽高的这一比例 */
const TUCK = 0.86
/** 不叠压的卡对:彼此留出的缝,按合宽高的比例 */
const BREATH = 1.12
/** 约这一比例的同岛卡对允许叠压 */
const TUCK_SHARE = 0.25
/** 大于这个张数的岛才考虑拆出卫星岛 */
const SPLIT_FROM = 8

const GOLDEN = 2.39996
const TAU = Math.PI * 2

export interface IslandItem {
  /** 稳定标识,决定种子 */
  id: string
  /** 所属主题团 */
  group: string
  /** 主题卡(目录概览或根主题):岛心优先放它 */
  head: boolean
  w: number
  h: number
}

/** 两张卡之间的亲密度:a、b 为下标 */
export interface IslandEdge {
  a: number
  b: number
  weight: number
}

export interface IslandResult {
  /** 每张卡的中心点,与输入同序 */
  centers: Array<{ x: number; y: number }>
  /** 每座岛的成员下标;卫星岛 tape 为 false,不另贴区名 */
  islands: Array<{ group: string; members: number[]; tape: boolean }>
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** 分岛:先按主题成团,大团里的枢纽叶子带走与它最亲的同伴 */
function planIslands(
  items: IslandItem[],
  weightOf: (a: number, b: number) => number
): IslandResult['islands'] {
  const order: string[] = []
  const byGroup = new Map<string, number[]>()
  items.forEach((item, i) => {
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, [])
      order.push(item.group)
    }
    byGroup.get(item.group)!.push(i)
  })
  const out: IslandResult['islands'] = []
  for (const group of order) {
    const ids = byGroup.get(group)!
    const head = ids.find((i) => items[i].head)
    const leaves = ids.filter((i) => !items[i].head)
    const hubs =
      ids.length >= SPLIT_FROM
        ? leaves.filter((h) => leaves.filter((o) => o !== h && weightOf(h, o) > 0).length >= 3)
        : []
    const sats = hubs.map((hub) => ({ hub, members: [hub] }))
    const main: number[] = []
    for (const i of ids) {
      if (items[i].head || hubs.includes(i)) {
        if (!hubs.includes(i)) main.push(i)
        continue
      }
      let best: (typeof sats)[number] | null = null
      let bestW = head === undefined ? 0 : weightOf(i, head)
      for (const sat of sats) {
        const w = weightOf(i, sat.hub)
        if (w > 0 && w >= bestW) {
          best = sat
          bestW = w
        }
      }
      if (best) best.members.push(i)
      else main.push(i)
    }
    // 没带走同伴的枢纽回到主岛
    for (const sat of sats) if (sat.members.length === 1) main.push(sat.hub)
    if (main.length > 0) out.push({ group, members: main, tape: true })
    // 主岛空了(没有主题卡、叶子全被卫星带走)时,第一座卫星岛替它贴区名
    let taped = main.length > 0
    for (const sat of sats) {
      if (sat.members.length < 2) continue
      out.push({ group, members: sat.members, tape: !taped })
      taped = true
    }
  }
  return out
}

/** 岛内摆放:返回相对岛心的中心点,以及岛的外框 */
function arrangeIsland(
  items: IslandItem[],
  members: number[],
  weightOf: (a: number, b: number) => number
): { local: Map<number, { x: number; y: number }>; w: number; h: number; ox: number; oy: number } {
  const center = members.find((i) => items[i].head) ?? members[0]
  const rest = members
    .filter((i) => i !== center)
    .sort(
      (a, b) =>
        weightOf(b, center) - weightOf(a, center) || wallSeed(items[a].id) - wallSeed(items[b].id)
    )
  const order = [center, ...rest]
  const turn = wallSeed(`island:${items[center].id}`) * TAU
  const boxes: Box[] = order.map((i, r) => {
    const ang = turn + r * GOLDEN
    const rad = r === 0 ? 0 : 118 * Math.sqrt(r)
    return {
      x: Math.cos(ang) * rad * 1.35,
      y: Math.sin(ang) * rad * 0.95,
      w: items[i].w,
      h: items[i].h
    }
  })
  const tuck = (i: number, j: number): number => {
    const a = items[order[i]].id
    const b = items[order[j]].id
    return wallSeed(a < b ? a + b : b + a) < TUCK_SHARE ? TUCK : BREATH
  }
  // 向心收拢,让岛抱成团;大岛少收几轮,省时间
  const pulls = order.length > 80 ? 12 : 40
  for (let k = 0; k < pulls; k += 1) {
    for (const box of boxes) {
      box.x *= 0.97
      box.y *= 0.97
    }
    settle(boxes, tuck, 30)
  }
  const local = new Map<number, { x: number; y: number }>()
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  boxes.forEach((box, r) => {
    local.set(order[r], { x: box.x, y: box.y })
    x0 = Math.min(x0, box.x - box.w / 2)
    y0 = Math.min(y0, box.y - box.h / 2)
    x1 = Math.max(x1, box.x + box.w / 2)
    y1 = Math.max(y1, box.y + box.h / 2)
  })
  return { local, w: x1 - x0, h: y1 - y0, ox: -(x0 + x1) / 2, oy: -(y0 + y1) / 2 }
}

/** 落岛:返回每座岛外框的中心 */
function packIslands(
  sizes: Array<{ w: number; h: number }>,
  affinity: number[][],
  tag: string[]
): Box[] {
  const n = sizes.length
  const boxes = sizes.map((size) => ({ x: 0, y: 0, w: size.w + SEA, h: size.h + SEA }))
  const done: number[] = []
  const free = (k: number, x: number, y: number): boolean =>
    done.every(
      (j) =>
        Math.abs(boxes[j].x - x) >= (boxes[k].w + boxes[j].w) / 2 ||
        Math.abs(boxes[j].y - y) >= (boxes[k].h + boxes[j].h) / 2
    )
  const bySize = [...sizes.keys()].sort(
    (a, b) => sizes[b].w * sizes[b].h - sizes[a].w * sizes[a].h || a - b
  )
  while (done.length < n) {
    let k = bySize.find((i) => !done.includes(i))!
    if (done.length > 0) {
      let best = -1
      for (const c of bySize) {
        if (done.includes(c)) continue
        const score =
          done.reduce((sum, j) => sum + affinity[c][j], 0) * 1e6 + sizes[c].w * sizes[c].h
        if (score > best) {
          best = score
          k = c
        }
      }
    }
    if (done.length === 0) {
      done.push(k)
      continue
    }
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const j of done) {
      x0 = Math.min(x0, boxes[j].x - boxes[j].w / 2)
      x1 = Math.max(x1, boxes[j].x + boxes[j].w / 2)
      y0 = Math.min(y0, boxes[j].y - boxes[j].h / 2)
      y1 = Math.max(y1, boxes[j].y + boxes[j].h / 2)
    }
    // 只绕最亲近(其次最大)的若干座岛找位置,岛多时也不至于太慢
    const anchors = [...done]
      .sort(
        (a, b) =>
          affinity[k][b] - affinity[k][a] || boxes[b].w * boxes[b].h - boxes[a].w * boxes[a].h
      )
      .slice(0, 12)
    let bestX = 0
    let bestY = 0
    let bestScore = Infinity
    for (const j of anchors) {
      for (let t = 0; t < 36; t += 1) {
        const ang = (t / 36) * TAU + wallSeed(`${tag[k]}:${t}`) * 0.15
        const rx = (boxes[k].w + boxes[j].w) / 4
        const ry = (boxes[k].h + boxes[j].h) / 4
        for (let d = 0; d < 6000; d += 24) {
          const x = boxes[j].x + Math.cos(ang) * (rx + d)
          const y = boxes[j].y + Math.sin(ang) * (ry + d)
          if (!free(k, x, y)) continue
          const W = Math.max(x1, x + boxes[k].w / 2) - Math.min(x0, x - boxes[k].w / 2)
          const H = Math.max(y1, y + boxes[k].h / 2) - Math.min(y0, y - boxes[k].h / 2)
          const area = Math.max(W, H * WALL_ASPECT) * Math.max(H, W / WALL_ASPECT)
          let pull = 0
          for (const q of done) pull += affinity[k][q] * Math.hypot(boxes[q].x - x, boxes[q].y - y)
          const score = area + pull * 40
          if (score < bestScore) {
            bestScore = score
            bestX = x
            bestY = y
          }
          break
        }
      }
    }
    boxes[k].x = bestX
    boxes[k].y = bestY
    done.push(k)
  }
  return boxes
}

export function layoutIslands(items: IslandItem[], edges: IslandEdge[]): IslandResult {
  const weights = new Map<string, number>()
  for (const edge of edges) {
    if (edge.a === edge.b) continue
    const key = pairKey(edge.a, edge.b)
    weights.set(key, (weights.get(key) ?? 0) + edge.weight)
  }
  const weightOf = (a: number, b: number): number => weights.get(pairKey(a, b)) ?? 0
  const islands = planIslands(items, weightOf)
  const shapes = islands.map((island) => arrangeIsland(items, island.members, weightOf))
  const islandOf = new Map<number, number>()
  islands.forEach((island, k) => island.members.forEach((i) => islandOf.set(i, k)))
  const affinity = islands.map(() => islands.map(() => 0))
  for (const [key, w] of weights) {
    const [a, b] = key.split('|').map(Number)
    const ka = islandOf.get(a)!
    const kb = islandOf.get(b)!
    if (ka === kb) continue
    affinity[ka][kb] += w
    affinity[kb][ka] += w
  }
  const spots = packIslands(
    shapes,
    affinity,
    islands.map((island) => `${island.group}:${items[island.members[0]].id}`)
  )
  const centers = items.map(() => ({ x: 0, y: 0 }))
  shapes.forEach((shape, k) => {
    for (const [i, p] of shape.local)
      centers[i] = { x: spots[k].x + shape.ox + p.x, y: spots[k].y + shape.oy + p.y }
  })
  return { centers, islands }
}
