// 自测:线索桌远景的岛间聚合线。同岛不画、跨岛每对一条、不分方向计条数、只算引用线、
// 粗细按条数在上下限之间、两端在岛心、悬空的线丢掉、结果可复现。
import assert from 'node:assert/strict'
import {
  WALL_ISLAND_LINE_MAX_PX,
  WALL_ISLAND_LINE_MIN_PX,
  wallIslandLinks
} from '../src/renderer/src/wikiWallIslandLinks.ts'
import type { WallPlacedCard } from '../src/renderer/src/wikiWallLayout.ts'
import type { WikiWallCard, WikiWallLink } from '../src/shared/wikiTypes.ts'

function placed(pageId: string, topicPath: string[], x: number, y: number): WallPlacedCard {
  const card: WikiWallCard = {
    pageId,
    kind: 'leaf',
    title: pageId,
    status: 'planned',
    summary: '',
    excerpt: '',
    file: '',
    keyFiles: [],
    memberCount: 1,
    members: [],
    topicPath
  }
  return { card, x, y, w: 100, h: 50, tilt: 0, pinX: x + 50, pinY: y + 4 }
}

const ref = (from: string, to: string, weight = 1): WikiWallLink => ({
  from,
  to,
  kind: 'reference',
  weight
})

const cards = [
  placed('a1', ['A'], 0, 0),
  placed('a2', ['A'], 200, 0),
  placed('b1', ['B'], 1000, 0),
  placed('b2', ['B'], 1000, 400),
  placed('c1', ['C'], 0, 1000)
]
const links: WikiWallLink[] = [
  ref('a1', 'a2', 9),
  ref('a1', 'b1'),
  ref('b2', 'a2', 5),
  ref('a2', 'b1'),
  ref('c1', 'a1'),
  { from: 'a1', to: 'c1', kind: 'contains', weight: 1 },
  ref('ghost', 'a1')
]

const lines = wallIslandLinks(cards, links)
assert.deepEqual(
  lines.map((line) => [line.from, line.to, line.count]),
  [
    ['A', 'B', 3],
    ['A', 'C', 1]
  ],
  '同岛不画;跨岛不分方向按条数聚合;从属线与悬空线不算'
)
const [ab, ac] = lines as [(typeof lines)[number], (typeof lines)[number]]
assert.equal(ab.width, WALL_ISLAND_LINE_MAX_PX, '条数最多的一对最粗')
assert.equal(ac.width, WALL_ISLAND_LINE_MIN_PX, '一条引用最细')
assert.deepEqual([ab.x1, ab.y1, ab.x2, ab.y2], [150, 25, 1050, 225], '两端在岛心(各卡中心平均)')
assert.match(ab.d, /^M150 25 Q/, '画成下垂的线绳')
assert.deepEqual(wallIslandLinks(cards, links), lines, '同一份数据结果一样')

// 粗细在上下限之间单调
const many = [
  placed('x', ['X'], 0, 0),
  placed('y', ['Y'], 0, 0),
  placed('z', ['Z'], 0, 0),
  placed('w', ['W'], 0, 0)
]
const graded = wallIslandLinks(many, [
  ...Array.from({ length: 9 }, () => ref('x', 'y')),
  ...Array.from({ length: 4 }, () => ref('x', 'z')),
  ref('x', 'w')
])
const widthOf = (to: string): number =>
  graded.find((line) => line.from === to || line.to === to)!.width
assert.ok(widthOf('W') < widthOf('Z') && widthOf('Z') < widthOf('Y'), '条数越多越粗')
assert.ok(
  graded.every((l) => l.width >= WALL_ISLAND_LINE_MIN_PX && l.width <= WALL_ISLAND_LINE_MAX_PX)
)

// 只有一对时取最细;没有跨岛引用时一条不画
assert.equal(wallIslandLinks(cards, [ref('a1', 'b1')])[0]!.width, WALL_ISLAND_LINE_MIN_PX)
assert.deepEqual(wallIslandLinks(cards, [ref('a1', 'a2')]), [])
assert.deepEqual(wallIslandLinks([], []), [])

console.log('selftest-wikiwallislandlinks ok')
