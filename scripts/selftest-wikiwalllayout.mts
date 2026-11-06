// 自测:卡片墙布局(线索桌·小岛排法)。按主题成岛、大岛拆出卫星岛、横屏比例、
// 叠压只压别人右下边角(标题与图钉露在外)、岛与岛不重叠、可复现、连线挂在图钉上并下垂、连线分档、悬空连线丢弃。
import assert from 'node:assert/strict'
import {
  layoutWikiWall,
  wallFocusId,
  wallNeighbors,
  wallSeed,
  wallTierOf,
  WALL_ROOT_REGION,
  type WallPlacedCard
} from '../src/renderer/src/wikiWallLayout.ts'
import { WALL_CHAPTER_SPLIT_FROM, wallGroupTitles } from '../src/renderer/src/wikiWallGroups.ts'
import { WALL_ASPECT } from '../src/renderer/src/wikiWallIslands.ts'
import type { WikiWallCard, WikiWallLink } from '../src/shared/wikiTypes.ts'

function card(
  pageId: string,
  kind: WikiWallCard['kind'],
  topicPath: string[],
  memberCount = 3
): WikiWallCard {
  return {
    pageId,
    kind,
    title: pageId,
    status: 'planned',
    summary: '',
    excerpt: '',
    file: '',
    keyFiles: [],
    memberCount,
    members: [],
    topicPath
  }
}

type Rect = { x: number; y: number; w: number; h: number }
const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
/** 标题区:卡片左上角那一条;图钉:顶边中点 */
const titleOf = (p: WallPlacedCard): Rect => ({ x: p.x, y: p.y, w: p.w * 0.6, h: 56 })
const pinOf = (p: WallPlacedCard): Rect => ({ x: p.pinX - 8, y: p.pinY - 8, w: 16, h: 16 })

/** 后画的卡压在先画的卡上:压住的只能是边角,不碰标题和图钉 */
function checkStacking(cards: WallPlacedCard[], label: string): number {
  let tucked = 0
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const under = cards[i]
      const over = cards[j]
      if (!overlap(under, over)) continue
      tucked += 1
      const id = `${label}:${under.card.pageId} 被 ${over.card.pageId}`
      assert.ok(!overlap(titleOf(under), over), `${id} 压住标题`)
      assert.ok(!overlap(pinOf(under), over), `${id} 压住图钉`)
    }
  }
  return tucked
}

// 一个中等项目:根主题两张、src 一章超过拆岛门槛(带枢纽 hub)、其下 ui 一节拆成自己的岛、零散几团
const cards: WikiWallCard[] = [
  card('root-1', 'root', []),
  card('root-2', 'root', [], 1),
  card('ov-src', 'overview', ['src'], 11),
  ...Array.from({ length: 12 }, (_, i) =>
    card(`src-${i}`, 'leaf', ['src'], i === 0 ? 32 : i % 3 === 0 ? 2 : 4)
  ),
  card('ov-ui', 'overview', ['src', 'ui'], 4),
  ...Array.from({ length: 5 }, (_, i) => card(`ui-${i}`, 'leaf', ['src', 'ui'], 8)),
  card('lib-0', 'leaf', ['lib']),
  card('lib-1', 'leaf', ['lib'])
]
const links: WikiWallLink[] = [
  ...Array.from({ length: 10 }, (_, i) => ({
    from: 'ov-src',
    to: `src-${i}`,
    kind: 'contains' as const,
    weight: 1
  })),
  // src-0 是枢纽:被 src-1..4 引用,应该带着它们自成卫星岛
  ...[1, 2, 3, 4].map((i) => ({
    from: `src-${i}`,
    to: 'src-0',
    kind: 'reference' as const,
    weight: 4
  })),
  { from: 'ov-src', to: 'ov-ui', kind: 'contains', weight: 1 },
  ...Array.from({ length: 5 }, (_, i) => ({
    from: 'ov-ui',
    to: `ui-${i}`,
    kind: 'contains' as const,
    weight: 1
  })),
  { from: 'ui-0', to: 'ui-1', kind: 'reference', weight: 12 },
  { from: 'src-5', to: 'lib-0', kind: 'reference', weight: 6 },
  { from: 'ghost', to: 'lib-0', kind: 'reference', weight: 3 }
]

const layout = layoutWikiWall(cards, links)
const at = (id: string): WallPlacedCard => layout.cards.find((placed) => placed.card.pageId === id)!
assert.equal(layout.cards.length, cards.length, '每卡都有位置')
assert.equal(layout.regions[0].title, WALL_ROOT_REGION, '根主题区排在最前')
assert.deepEqual(
  layout.regions.map((region) => [region.title, region.count]),
  [
    [WALL_ROOT_REGION, 2],
    ['src', 13],
    ['src / ui', 6],
    ['lib', 2]
  ],
  '每章一条区名胶带,大章拆出的节另贴一条,张数含卫星岛'
)

// 横屏比例:不再朝一个方向无限延伸
const ratio = layout.width / layout.height
assert.ok(
  ratio > WALL_ASPECT * 0.7 && ratio < WALL_ASPECT * 1.5,
  `板面接近横屏,实际 ${ratio.toFixed(2)}`
)

// 同岛抱团:每张 ui 叶子离 ui 主题卡比离 src 主题卡近
const dist = (a: WallPlacedCard, b: WallPlacedCard): number =>
  Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2)
for (let i = 0; i < 5; i += 1) {
  assert.ok(
    dist(at(`ui-${i}`), at('ov-ui')) < dist(at(`ui-${i}`), at('ov-src')),
    `ui-${i} 留在自己的岛上`
  )
}
// 卫星岛:枢纽 src-0 的同伴离枢纽比离 src 主题卡近
for (const i of [1, 2, 3, 4]) {
  assert.ok(
    dist(at(`src-${i}`), at('src-0')) < dist(at(`src-${i}`), at('ov-src')),
    `src-${i} 跟着枢纽`
  )
}

// 岛与岛不重叠;叠压只压边角
for (let i = 0; i < layout.regions.length; i += 1) {
  for (let j = i + 1; j < layout.regions.length; j += 1) {
    assert.ok(!overlap(layout.regions[i], layout.regions[j]), '主岛外框互不重叠')
  }
}
checkStacking(layout.cards, '中等项目')

// 大中小三档卡:文件多的卡更大
assert.ok(at('src-0').w > at('src-1').w && at('src-1').w > at('src-3').w, '卡片按文件数分大中小')
for (const placed of layout.cards) {
  assert.ok(Math.abs(placed.tilt) <= 3, '倾角不超过 3 度')
  assert.ok(placed.x >= 0 && placed.y >= 0, '卡片不出左上边界')
  assert.ok(
    placed.x + placed.w <= layout.width && placed.y + placed.h <= layout.height,
    '卡片在板面内'
  )
}
assert.ok(new Set(layout.cards.map((placed) => placed.tilt)).size > 1, '卡片角度错落')
assert.ok(
  new Set(layout.cards.map((placed) => placed.y)).size > layout.cards.length * 0.7,
  '高低错落,不排成整齐的行'
)

// 可复现:同一份数据再摆一次,位置、角度与叠放次序完全一致
const again = layoutWikiWall(cards, links)
const snap = (l: typeof layout): unknown[] => l.cards.map((p) => [p.card.pageId, p.x, p.y, p.tilt])
assert.deepEqual(snap(again), snap(layout))
assert.equal(wallSeed('abc'), wallSeed('abc'))
assert.ok(wallSeed('abc') >= 0 && wallSeed('abc') < 1)

// 大团:60 张叶子一个团,不排成一长条,叠压规则照样成立
const many: WikiWallCard[] = Array.from({ length: 60 }, (_, i) =>
  card(`m-${i}`, 'leaf', ['大团'], (i % 9) + 1)
)
const big = layoutWikiWall(many, [])
assert.ok(big.width < big.height * 3 && big.height < big.width * 3, '大团大致方正')
checkStacking(big.cards, '大团')

// 很多小团也摆成横屏,且三百张卡排得够快
const lots: WikiWallCard[] = Array.from({ length: 300 }, (_, i) =>
  card(`k-${i}`, 'leaf', [`团${i % 40}`])
)
const lotLinks: WikiWallLink[] = Array.from({ length: 200 }, (_, i) => ({
  from: `k-${i}`,
  to: `k-${(i * 7 + 3) % 300}`,
  kind: 'reference',
  weight: 1 + (i % 5)
}))
const started = Date.now()
const wide = layoutWikiWall(lots, lotLinks)
assert.ok(Date.now() - started < 3000, `三百张卡排版太慢:${Date.now() - started}ms`)
const wideRatio = wide.width / wide.height
assert.ok(wideRatio > 1.1 && wideRatio < 2.4, `四十个团也接近横屏,实际 ${wideRatio.toFixed(2)}`)
checkStacking(wide.cards, '多团')

// 连线:悬空线丢弃、挂在图钉上、向下垂、分档
assert.equal(layout.links.length, links.length - 1, '悬空连线丢弃')
const strong = layout.links.find((placed) => placed.link.from === 'ui-0')!
assert.equal(strong.tier, 'strong')
assert.equal(strong.x1, at('ui-0').pinX, '线绳挂在起点图钉')
assert.equal(strong.y2, at('ui-1').pinY, '线绳挂在终点图钉')
assert.ok(strong.cy > (strong.y1 + strong.y2) / 2, '线绳向下垂')
assert.match(strong.d, /^M[\d.]+ [\d.]+ Q[\d.]+ [\d.]+ [\d.]+ [\d.]+$/)
assert.equal(wallTierOf({ from: 'a', to: 'b', kind: 'reference', weight: 1 }), 'faint')
assert.equal(wallTierOf({ from: 'a', to: 'b', kind: 'reference', weight: 3 }), 'medium')
assert.equal(
  wallTierOf({ from: 'a', to: 'b', kind: 'contains', weight: 9 }),
  'faint',
  '从属线恒弱档'
)

// 分岛口径:小章整章一座岛,更深的节都并进章里
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
  [['src', 3]],
  '没超过拆岛门槛的章不拆'
)

// 大章拆岛:超过门槛按第二段拆节;太小的节留在章岛;拆节同样只看前两段
const bigChapter: WikiWallCard[] = [
  card('c-ov', 'overview', ['核心功能']),
  ...Array.from({ length: 9 }, (_, i) => card(`c-wiki-${i}`, 'leaf', ['核心功能', 'wiki'])),
  ...Array.from({ length: 8 }, (_, i) =>
    card(`c-graph-${i}`, 'leaf', ['核心功能', 'graph', ...(i === 0 ? ['view'] : [])])
  ),
  card('c-tiny-0', 'leaf', ['核心功能', 'tiny']),
  card('c-tiny-1', 'leaf', ['核心功能', 'tiny'])
]
const titles = wallGroupTitles([card('r', 'root', []), card('u', 'leaf', []), ...bigChapter])
assert.equal(titles.get('r'), WALL_ROOT_REGION, '根主题归总览')
assert.equal(titles.get('u'), '未归类', '没有主题链的卡归未归类')
assert.equal(titles.get('c-ov'), '核心功能', '章的总览卡留在章岛')
assert.equal(titles.get('c-wiki-3'), '核心功能 / wiki')
assert.equal(titles.get('c-graph-0'), '核心功能 / graph', '更深的卡并进第二段的节')
assert.equal(titles.get('c-tiny-1'), '核心功能', '不足门槛的小节留在章岛')
assert.ok(bigChapter.length > WALL_CHAPTER_SPLIT_FROM, '测试数据确实超过门槛')
const small = wallGroupTitles(bigChapter.slice(0, WALL_CHAPTER_SPLIT_FROM))
assert.ok(
  [...small.values()].every((title) => title === '核心功能'),
  '刚好到门槛不拆,整章一座岛'
)
assert.deepEqual(layoutWikiWall([], []).cards, [], '空墙不报错')

assert.deepEqual([...wallNeighbors(links, 'lib-0')].sort(), ['ghost', 'lib-0', 'src-5'])

// 焦点:拖动 > 悬停 > 选中;远景不认悬停,拖动与选中照旧
const focus = (
  far: boolean,
  draggingId: string | null,
  hoverId: string | null,
  selectedId: string | null
) => wallFocusId({ far, draggingId, hoverId, selectedId })
assert.equal(focus(false, null, 'h', 's'), 'h', '近景悬停优先于选中')
assert.equal(focus(false, 'd', 'h', 's'), 'd', '拖动优先')
assert.equal(focus(true, null, 'h', null), null, '远景悬停不点亮')
assert.equal(focus(true, null, 'h', 's'), 's', '远景只认选中')
assert.equal(focus(true, 'd', 'h', 's'), 'd', '远景拖动照旧')

// 按章成岛:人话章名就是岛名;章太大时按第二节拆,胶带写成「章 / 节」
const chapterCards = [
  card('arch', 'overview', ['架构设计']),
  card('arch-1', 'leaf', ['架构设计', '进程与入口']),
  ...Array.from({ length: 20 }, (_, i) => card(`feat-${i}`, 'leaf', ['核心功能', '对话'])),
  card('root-x', 'root', [])
]
const chapterTitles = wallGroupTitles(chapterCards)
assert.equal(chapterTitles.get('arch'), '架构设计', '章本身的总览留在章岛')
assert.equal(chapterTitles.get('arch-1'), '架构设计', '小节不够张数时不单拆')
assert.equal(chapterTitles.get('feat-0'), '核心功能 / 对话', '大章按节拆岛')
assert.equal(chapterTitles.get('root-x'), WALL_ROOT_REGION, '根文仍归总览')
assert.ok(![...chapterTitles.values()].some((title) => title.startsWith('src')), '岛名不是目录前缀')

console.log('selftest-wikiwalllayout ok')
