import assert from 'node:assert/strict'
import { alignDelta, anchorAt, clampScroll, topAnchor } from '../src/shared/scrollAlign.ts'

// 三块:0 在 100~150,1 在 160~260,2 在 270~300
const blocks = [
  { index: 0, top: 100, height: 50 },
  { index: 1, top: 160, height: 100 },
  { index: 2, top: 270, height: 30 }
]

// 参考线落在块内:块号对、比例对
assert.deepEqual(anchorAt(blocks, 125), { index: 0, fraction: 0.5 })
assert.deepEqual(anchorAt(blocks, 160), { index: 1, fraction: 0 })
assert.deepEqual(anchorAt(blocks, 260), { index: 1, fraction: 1 })

// 落在块缝里:取纵向最近的一块,比例夹到端点
assert.deepEqual(anchorAt(blocks, 155), { index: 0, fraction: 1 })
assert.deepEqual(anchorAt(blocks, 159), { index: 1, fraction: 0 })
assert.deepEqual(anchorAt(blocks, 265), { index: 1, fraction: 1 })

// 落在所有块外面:第一块顶 / 最后一块底
assert.deepEqual(anchorAt(blocks, 10), { index: 0, fraction: 0 })
assert.deepEqual(anchorAt(blocks, 400), { index: 2, fraction: 1 })

// 空表与零高块不炸
assert.equal(anchorAt([], 10), null)
assert.deepEqual(anchorAt([{ index: 3, top: 0, height: 0 }], 0), { index: 3, fraction: 0 })

// 视口顶兜底:第一块底边越过顶线的那块
assert.deepEqual(topAnchor(blocks, 90), { index: 0, fraction: 0 })
assert.deepEqual(topAnchor(blocks, 100), { index: 0, fraction: 0 })
assert.deepEqual(topAnchor(blocks, 125), { index: 0, fraction: 0.5 })
assert.deepEqual(topAnchor(blocks, 160), { index: 1, fraction: 0 })
assert.deepEqual(topAnchor(blocks, 400), { index: 2, fraction: 1 })
assert.equal(topAnchor([], 0), null)

// 对栏落点:块顶 500、高 80,比例 0.5 要落在 300 → 滚 500+40-300
assert.equal(alignDelta({ fraction: 0.5, peerTop: 500, peerHeight: 80, refY: 300 }), 240)
assert.equal(alignDelta({ fraction: 0, peerTop: 500, peerHeight: 80, refY: 300 }), 200)
assert.equal(alignDelta({ fraction: 1, peerTop: 500, peerHeight: 80, refY: 300 }), 280)

// 夹取:负数归零,超上限取上限,上限本身是负也归零
assert.equal(clampScroll(-10, 100), 0)
assert.equal(clampScroll(50, 100), 50)
assert.equal(clampScroll(120, 100), 100)
assert.equal(clampScroll(10, -5), 0)

console.log('scrollalign: 全部通过')
