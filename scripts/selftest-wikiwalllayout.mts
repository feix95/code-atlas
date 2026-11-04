// 自测:卡片墙布局(线索桌)。根卡成团在最前、同团叶子换行、卡片与团块互不压盖、
// 位置与角度由卡片标识决定且可复现、连线挂在图钉上并下垂、连线分档、悬空连线丢弃。
import assert from 'node:assert/strict'
import {
  layoutWikiWall,
  wallNeighbors,
  wallSeed,
  wallTierOf,
  WALL_ROOT_REGION
} from '../src/renderer/src/wikiWallLayout.ts'
import type { WikiWallCard, WikiWallLink } from '../src/shared/wikiTypes.ts'

function card(pageId: string, kind: WikiWallCard['kind'], topicPath: string[]): WikiWallCard {
  return {
    pageId,
    kind,
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
}

const cards: WikiWallCard[] = [
  card('root-1', 'root', []),
  card('ov-a', 'overview', ['甲主题']),
  card('leaf-a1', 'leaf', ['甲主题']),
  card('leaf-a2', 'leaf', ['甲主题']),
  card('leaf-a3', 'leaf', ['甲主题']),
  card('leaf-a4', 'leaf', ['甲主题']),
  card('leaf-b1', 'leaf', ['乙主题'])
]

const links: WikiWallLink[] = [
  { from: 'ov-a', to: 'leaf-a1', kind: 'contains', weight: 1 },
  { from: 'leaf-a1', to: 'leaf-b1', kind: 'reference', weight: 6 },
  { from: 'leaf-a2', to: 'leaf-b1', kind: 'reference', weight: 1 },
  { from: 'ghost', to: 'leaf-b1', kind: 'reference', weight: 3 }
]

const layout = layoutWikiWall(cards, links)
const at = (id: string) => layout.cards.find((placed) => placed.card.pageId === id)!
assert.equal(layout.cards.length, cards.length, '每卡都有位置')
assert.equal(layout.regions[0].title, WALL_ROOT_REGION, '根主题团排在最前')
assert.ok(at('root-1').y < at('leaf-a1').y, '根卡在叶子之上')
assert.ok(at('ov-a').y < at('leaf-a1').y, '目录概览卡在本团叶子之上')
assert.ok(at('leaf-a4').y > at('leaf-a1').y + 60, '第四张叶子换行')

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
for (let i = 0; i < layout.cards.length; i += 1) {
  for (let j = i + 1; j < layout.cards.length; j += 1) {
    assert.ok(
      !overlap(layout.cards[i], layout.cards[j]),
      `卡片不压盖:${layout.cards[i].card.pageId} 与 ${layout.cards[j].card.pageId}`
    )
  }
}
for (let i = 0; i < layout.regions.length; i += 1) {
  for (let j = i + 1; j < layout.regions.length; j += 1) {
    assert.ok(!overlap(layout.regions[i], layout.regions[j]), '团块不重叠')
  }
}
for (const placed of layout.cards) {
  assert.ok(Math.abs(placed.tilt) <= 3, '倾角不超过 3 度')
  assert.ok(
    placed.x + placed.w <= layout.width && placed.y + placed.h <= layout.height,
    '卡片在板面内'
  )
}
const tilts = new Set(layout.cards.map((placed) => placed.tilt))
assert.ok(tilts.size > 1, '卡片角度错落,不是统一一个值')

// 可复现:同一份数据再摆一次,位置与角度完全一致
const again = layoutWikiWall(cards, links)
assert.deepEqual(
  again.cards.map((placed) => [placed.card.pageId, placed.x, placed.y, placed.tilt]),
  layout.cards.map((placed) => [placed.card.pageId, placed.x, placed.y, placed.tilt])
)
assert.equal(wallSeed('abc'), wallSeed('abc'))
assert.ok(wallSeed('abc') >= 0 && wallSeed('abc') < 1)

// 大团:60 张叶子也不压盖、不排成一长条
const many: WikiWallCard[] = Array.from({ length: 60 }, (_, i) => card(`m-${i}`, 'leaf', ['大团']))
const big = layoutWikiWall(many, [])
for (let i = 0; i < big.cards.length; i += 1) {
  for (let j = i + 1; j < big.cards.length; j += 1) {
    assert.ok(!overlap(big.cards[i], big.cards[j]), '大团卡片不压盖')
  }
}
assert.ok(big.width < big.height * 3 && big.height < big.width * 3, '大团大致方正')

assert.equal(layout.links.length, 3, '悬空连线丢弃')
const strong = layout.links.find((placed) => placed.tier === 'strong')!
assert.equal(strong.link.from, 'leaf-a1')
assert.equal(strong.x1, at('leaf-a1').pinX, '线绳挂在起点图钉')
assert.equal(strong.y2, at('leaf-b1').pinY, '线绳挂在终点图钉')
assert.ok(strong.cy > (strong.y1 + strong.y2) / 2, '线绳向下垂')
assert.match(strong.d, /^M[\d.]+ [\d.]+ Q[\d.]+ [\d.]+ [\d.]+ [\d.]+$/)
assert.equal(wallTierOf(links[1]), 'strong')
assert.equal(wallTierOf(links[2]), 'faint')
assert.equal(wallTierOf(links[0]), 'faint', '从属线恒弱档')

// 成团取主题链前两段:src 下的子目录各成一团,更深的并进第二层
const deep = layoutWikiWall(
  [
    card('d-1', 'leaf', ['src']),
    card('d-2', 'leaf', ['src', 'ui']),
    card('d-3', 'leaf', ['src', 'ui', 'export'])
  ],
  []
)
assert.deepEqual(
  deep.regions.map((region) => [region.title, region.count]),
  [
    ['src', 1],
    ['src / ui', 2]
  ]
)

assert.deepEqual([...wallNeighbors(links, 'leaf-b1')].sort(), [
  'ghost',
  'leaf-a1',
  'leaf-a2',
  'leaf-b1'
])

console.log('selftest-wikiwalllayout ok')
