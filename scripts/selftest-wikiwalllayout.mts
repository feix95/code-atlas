// 自测:卡片墙布局。根卡顶部带、同区叶子成行、区域不重叠、连线分档、悬空连线丢弃。
import assert from 'node:assert/strict'
import { layoutWikiWall, wallTierOf } from '../src/renderer/src/wikiWallLayout.ts'
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
assert.equal(layout.cards.length, cards.length, '每卡都有位置')
const root = layout.cards.find((placed) => placed.card.pageId === 'root-1')!
const leafA1 = layout.cards.find((placed) => placed.card.pageId === 'leaf-a1')!
assert.ok(root.y < leafA1.y, '根卡在叶子之上')
const leafA4 = layout.cards.find((placed) => placed.card.pageId === 'leaf-a4')!
assert.ok(leafA4.y > leafA1.y, '第四张叶子换行')
assert.equal(leafA4.x, leafA1.x, '换行后回到首列')
for (let i = 0; i < layout.regions.length; i += 1) {
  for (let j = i + 1; j < layout.regions.length; j += 1) {
    const a = layout.regions[i]
    const b = layout.regions[j]
    assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, '区域纵向不重叠')
  }
}
assert.equal(layout.links.length, 3, '悬空连线丢弃')
assert.equal(wallTierOf(links[1]), 'strong')
assert.equal(wallTierOf(links[2]), 'faint')
assert.equal(wallTierOf(links[0]), 'faint', '从属线恒弱档')
const strong = layout.links.find((placed) => placed.tier === 'strong')!
assert.equal(strong.link.from, 'leaf-a1')

console.log('selftest-wikiwalllayout ok')
