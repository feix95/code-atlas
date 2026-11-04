// 自测:线索桌分层。伞主题并进「总览」板子、单卡主题直接摆卡、零散页太多收进「其他页面」、
// 只剩一块板子自动往下跳、顶部路径跳过自动层、连线聚合到板子并丢掉板内的线、每张卡都恰好落在一层。
import assert from 'node:assert/strict'
import {
  buildWallScopes,
  resolveWallScope,
  wallScopeTrail,
  wallScopeView,
  WALL_TOP_SCOPE
} from '../src/renderer/src/wikiWallScopes.ts'
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
  card('r1', 'root', []),
  card('p0', 'overview', ['proj']),
  card('a0', 'overview', ['A']),
  card('a1', 'page', ['A']),
  card('a2', 'page', ['A']),
  card('x0', 'overview', ['A', 'x']),
  card('x1', 'page', ['A', 'x']),
  card('y1', 'page', ['A', 'y']),
  card('b1', 'page', ['B']),
  card('c0', 'overview', ['C']),
  card('c1', 'page', ['C']),
  card('z0', 'page', ['D', 'z']),
  card('z1', 'page', ['D', 'z']),
  card('t0', 'page', ['M', 't']),
  card('t1', 'page', ['M', 't']),
  ...Array.from({ length: 10 }, (_, i) => card(`m${i}`, 'page', ['M']))
]
const links: WikiWallLink[] = [
  { from: 'p0', to: 'a0', kind: 'contains', weight: 1 },
  { from: 'a0', to: 'a1', kind: 'contains', weight: 1 },
  { from: 'a1', to: 'c1', kind: 'reference', weight: 1 },
  { from: 'a2', to: 'c1', kind: 'reference', weight: 2 },
  { from: 'b1', to: 'a1', kind: 'reference', weight: 1 }
]
const tree = buildWallScopes(cards, links)
const scope = (key: string) => {
  const s = tree.scopes.get(key)
  assert.ok(s, `缺层 ${key}`)
  return s
}

// 全景:总览板子(根主题页 + 伞) + A、C、D、M 板子,B 只有一张卡直接摆
const top = scope(WALL_TOP_SCOPE)
assert.deepEqual(top.tiles.map((t) => t.key).sort(), ['#overview', 'A', 'C', 'D', 'M'])
assert.deepEqual(top.cardIds, ['b1'])
assert.deepEqual(scope('#overview').cardIds.sort(), ['p0', 'r1'])

// A 层:门面卡 + 直属页 + 单卡子主题 y 摆卡,x 成板子
const a = scope('A')
assert.equal(a.headId, 'a0')
assert.deepEqual(a.cardIds.sort(), ['a0', 'a1', 'a2', 'y1'])
assert.deepEqual(
  a.tiles.map((t) => t.key),
  ['A/x']
)
assert.equal(top.tiles.find((t) => t.key === 'A')?.count, 6)

// M 层:1 块板子 + 10 张零散页 > 10,零散页收进「其他页面」
const m = scope('M')
assert.deepEqual(m.cardIds, [])
assert.deepEqual(m.tiles.map((t) => t.key).sort(), ['M/#more', 'M/t'])
assert.equal(scope('M/#more').cardIds.length, 10)

// D 层只剩一块板子:自动往下跳,路径里也不出现 D
assert.equal(resolveWallScope(tree, 'D'), 'D/z')
assert.equal(resolveWallScope(tree, '不存在'), WALL_TOP_SCOPE)
assert.deepEqual(
  wallScopeTrail(tree, 'D/z').map((s) => s.key),
  [WALL_TOP_SCOPE, 'D/z']
)
assert.deepEqual(
  wallScopeTrail(tree, 'A/x').map((s) => s.key),
  [WALL_TOP_SCOPE, 'A', 'A/x']
)

// 连线:全景上 a1/a2 → c1 合成 A 板 → C 板一根,权重相加;板内 a0→a1 不画
const view = wallScopeView(tree, WALL_TOP_SCOPE, cards, links)
assert.equal(view.cards.length, 6)
const ac = view.links.filter((l) => l.from === 'tile:A' && l.to === 'tile:C')
assert.equal(ac.length, 1)
assert.equal(ac[0].weight, 3)
assert.ok(view.links.some((l) => l.from === 'b1' && l.to === 'tile:A'))
assert.ok(view.links.some((l) => l.from === 'tile:#overview' && l.to === 'tile:A'))
assert.ok(!view.links.some((l) => l.from === l.to))
const inA = wallScopeView(tree, 'A', cards, links)
assert.ok(inA.links.some((l) => l.from === 'a0' && l.to === 'a1'))
assert.ok(!inA.links.some((l) => l.to === 'c1'), '外层的卡不在本层,线不画')

// 每张卡恰好落在一层
assert.equal(tree.scopeOfCard.size, cards.length)
for (const c of cards) {
  const at = tree.scopeOfCard.get(c.pageId)
  assert.ok(at !== undefined && scope(at).cardIds.includes(c.pageId), c.pageId)
}

console.log('wikiwallscopes: ok')
