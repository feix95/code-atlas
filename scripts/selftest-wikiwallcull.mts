// 自测:线索桌近景视口裁剪。视口换算、四周扩一屏、回滞(小挪不重算、出界才重算、放大很多才收窄)、
// 卡与线的相交判定(线只要穿过范围就算,两端都在外面也不漏)。
import assert from 'node:assert/strict'
import {
  WALL_CULL_OVERSCAN,
  expandWallRect,
  nextWallCullRect,
  wallLineTouches,
  wallRectsTouch,
  wallViewRect
} from '../src/renderer/src/wikiWallCull.ts'

// 视口:板面平移 (-100,-50)、缩放 0.5、屏幕 800×600 → 板面上 (200,100) 起 1600×1200
assert.deepEqual(wallViewRect({ x: -100, y: -50, z: 0.5 }, 800, 600), {
  x: 200,
  y: 100,
  w: 1600,
  h: 1200
})
assert.deepEqual(expandWallRect({ x: 0, y: 0, w: 100, h: 50 }, 1), {
  x: -100,
  y: -50,
  w: 300,
  h: 150
})

const view = { x: 0, y: 0, w: 1000, h: 800 }
const first = nextWallCullRect(null, view)
assert.deepEqual(first, expandWallRect(view, WALL_CULL_OVERSCAN), '第一次:四周各扩一屏')
assert.equal(nextWallCullRect(first, { ...view, x: 300, y: -200 }), first, '挪不到半屏:原样不动')
assert.notEqual(nextWallCullRect(first, { ...view, x: 600 }), first, '余量不足半屏:重算')
assert.deepEqual(
  nextWallCullRect(first, { ...view, x: 600 }),
  expandWallRect({ ...view, x: 600 }, 1)
)
assert.notEqual(
  nextWallCullRect(first, { x: -500, y: -400, w: 2000, h: 1600 }),
  first,
  '缩小看得更多:重算'
)
assert.equal(nextWallCullRect(first, { x: 250, y: 200, w: 500, h: 400 }), first, '放大一点:不收窄')
assert.notEqual(nextWallCullRect(first, { x: 400, y: 300, w: 200, h: 160 }), first, '放大很多:收窄')

// 卡:边贴边也算碰到
const cull = { x: 0, y: 0, w: 100, h: 100 }
assert.ok(wallRectsTouch({ x: 100, y: 50, w: 10, h: 10 }, cull))
assert.ok(!wallRectsTouch({ x: 101, y: 50, w: 10, h: 10 }, cull))
assert.ok(!wallRectsTouch({ x: 20, y: -30, w: 10, h: 10 }, cull))

// 线:两端都在范围外、但横穿过去的照画;整条在外面的不画
const line = (x1: number, y1: number, x2: number, y2: number) => ({
  x1,
  y1,
  x2,
  y2,
  cx: (x1 + x2) / 2,
  cy: Math.max(y1, y2) + 20
})
assert.ok(wallLineTouches(line(-50, 50, 150, 50), cull), '横穿')
assert.ok(wallLineTouches(line(50, 50, 500, 500), cull), '一端在里面')
assert.ok(!wallLineTouches(line(200, 0, 400, 50), cull), '整条在外')
assert.ok(
  wallLineTouches({ x1: -50, y1: -50, x2: 150, y2: -50, cx: 50, cy: 80 }, cull),
  '下垂进来的也算'
)

console.log('selftest-wikiwallcull ok')
