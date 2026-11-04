// 自测:线索桌远景的岛间聚合线。同岛不画、跨岛每对一条、不分方向计条数、只算引用线、
// 线不带按条数的粗细(统一粗细由组件画)、两端在岛心、悬空的线丢掉、结果可复现。
import assert from 'node:assert/strict'
import { wallIslandLinks } from '../src/renderer/src/wikiWallIslandLinks.ts'
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
assert.ok(!('width' in ab) && !('width' in ac), '粗细不随条数变:结果里不带粗细')
assert.deepEqual([ab.x1, ab.y1, ab.x2, ab.y2], [150, 25, 1050, 225], '两端在岛心(各卡中心平均)')
assert.match(ab.d, /^M150 25 Q/, '画成下垂的线绳')
assert.deepEqual(wallIslandLinks(cards, links), lines, '同一份数据结果一样')

// 只有一对时也画一条;没有跨岛引用时一条不画
assert.equal(wallIslandLinks(cards, [ref('a1', 'b1')]).length, 1)
assert.deepEqual(wallIslandLinks(cards, [ref('a1', 'a2')]), [])
assert.deepEqual(wallIslandLinks([], []), [])

console.log('selftest-wikiwallislandlinks ok')
