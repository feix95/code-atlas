// 自测:线索桌手动摆放与视口。存档清洗挡住坏值、手摆位置盖到自动布局上并重挂线绳、
// 叠放次序决定渲染顺序、板面随远处的卡撑大;缩放以鼠标点为中心、上下限、看全部与初始视角。
import assert from 'node:assert/strict'
import { layoutWikiWall, wallGroupTitle } from '../src/renderer/src/wikiWallLayout.ts'
import {
  applyWallPositions,
  nextWallZ,
  sanitizeWallBoardPrefs,
  sanitizeWallPositions
} from '../src/renderer/src/wikiWallPositions.ts'
import {
  WALL_FAR_ZOOM,
  WALL_ZOOM_MAX,
  WALL_ZOOM_MIN,
  clampZoom,
  fitWallView,
  initialWallView,
  zoomAt
} from '../src/renderer/src/wikiWallViewport.ts'
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

const cards = [card('a', 'leaf', ['src']), card('b', 'leaf', ['src']), card('c', 'leaf', ['lib'])]
const links: WikiWallLink[] = [{ from: 'a', to: 'b', kind: 'reference', weight: 3 }]
const base = layoutWikiWall(cards, links)

// 清洗:非数字、无穷与空 id 挡住;负数照收(卡能拖到左上方),超大坐标夹到上下限
const clean = sanitizeWallPositions({
  a: { x: 10.4, y: 20.6, z: 2 },
  b: { x: 'x', y: 1 },
  c: { x: -5, y: 1e9 },
  f: { x: -1e9, y: -7 },
  d: { x: Infinity, y: 0 },
  '': { x: 1, y: 1 },
  e: null
})
assert.deepEqual(clean, {
  a: { x: 10, y: 21, z: 2 },
  c: { x: -5, y: 50000, z: 0 },
  f: { x: -50000, y: -7, z: 0 }
})
assert.deepEqual(sanitizeWallPositions([1, 2]), {})
assert.deepEqual(sanitizeWallBoardPrefs({ '/p': { a: { x: 1, y: 2 } }, '/q': {}, '': {} }), {
  '/p': { a: { x: 1, y: 2, z: 0 } }
})
assert.deepEqual(sanitizeWallBoardPrefs('bad'), {})

// 没有手摆:原样返回
assert.equal(applyWallPositions(base, {}, links), base)

// 手摆一张:位置、图钉跟过去,线绳重挂,别的卡不动,板面撑大
const moved = applyWallPositions(base, { a: { x: 3000, y: 2000, z: 5 } }, links)
const at = (id: string): (typeof moved.cards)[number] =>
  moved.cards.find((placed) => placed.card.pageId === id)!
assert.equal(at('a').x, 3000)
assert.equal(at('a').pinX, 3000 + at('a').w / 2)
assert.equal(at('a').pinY, 2004)
assert.deepEqual(
  [at('b').x, at('b').y],
  [
    base.cards.find((placed) => placed.card.pageId === 'b')!.x,
    base.cards.find((placed) => placed.card.pageId === 'b')!.y
  ]
)
assert.equal(moved.links[0].x1, at('a').pinX, '线绳跟着挪过去的卡')
assert.ok(moved.width >= 3000 + at('a').w && moved.height >= 2000 + at('a').h, '板面撑大')
assert.equal(moved.cards.at(-1)!.card.pageId, 'a', '拖过的卡画在最上面')
assert.equal(moved.cards.length, 3)

// 存档里的旧页 id 静默忽略
const ghost = applyWallPositions(base, { gone: { x: 1, y: 1, z: 1 } }, links)
assert.equal(ghost.cards.length, 3)
assert.equal(nextWallZ({}), 1)
assert.equal(nextWallZ({ a: { x: 0, y: 0, z: 7 }, b: { x: 0, y: 0, z: 3 } }), 8)

// 列表分组与桌面成团同名
assert.equal(wallGroupTitle(card('r', 'root', [])), '总览')
assert.equal(wallGroupTitle(card('x', 'leaf', ['src', 'ui', 'deep'])), 'src / ui')
assert.equal(wallGroupTitle(card('y', 'leaf', [])), '未归类')

// 缩放:鼠标点下的板面坐标不动;上下限
const view = { x: 100, y: 50, z: 1 }
const zoomed = zoomAt(view, 2, 300, 250)
assert.equal((300 - zoomed.x) / zoomed.z, (300 - view.x) / view.z)
assert.equal((250 - zoomed.y) / zoomed.z, (250 - view.y) / view.z)
assert.equal(clampZoom(10), WALL_ZOOM_MAX)
assert.equal(clampZoom(0.01), WALL_ZOOM_MIN)
assert.equal(zoomAt(view, 99, 0, 0).z, WALL_ZOOM_MAX)

// 看全部:不放大超过 100%,放得下就居中;太大按下限
assert.deepEqual(fitWallView(400, 200, 800, 600), { x: 200, y: 200, z: 1 })
assert.equal(fitWallView(4000, 1000, 1000, 1000).z, 0.25)
assert.equal(fitWallView(100000, 100, 1000, 1000).z, WALL_ZOOM_MIN)
assert.deepEqual(fitWallView(0, 0, 100, 100), { x: 0, y: 0, z: 1 })

// 初始视角:缩到看不清就不硬塞,停在远景阈值、从左上看起
assert.deepEqual(initialWallView(4000, 1000, 1000, 1000), { x: 0, y: 0, z: WALL_FAR_ZOOM })
assert.equal(initialWallView(1200, 600, 1000, 800).z, 1000 / 1200)

console.log('selftest-wikiwallpositions ok')
