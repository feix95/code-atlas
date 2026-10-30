import assert from 'node:assert/strict'
import { GRAPH_ZOOM } from '../src/renderer/src/graph/graphConfig.ts'
import { zoomDecisions, type ZoomNode } from '../src/renderer/src/graph/semanticZoom.ts'

// 语义缩放的纯判定:屏幕直径跨过 expandPx 展开、低于 collapsePx 收起,
// 两阈值之间不变;深度超过 autoExpandDepth 的文件夹不自动展开。

function node(id: string, r: number, depth = 1, isFolder = true): ZoomNode {
  return { id, r, depth, isFolder }
}

const rules = { expandPx: 72, collapsePx: 48, autoExpandDepth: 2 }

// 直径 = 2 × r × k:37 → 74 跨过 72,展开
assert.deepEqual(zoomDecisions([node('a', 37)], 1, new Set(), rules), {
  expand: ['a'],
  collapse: []
})
// 恰好等于阈值不算跨过,保持不变
assert.deepEqual(zoomDecisions([node('a', 36)], 1, new Set(), rules), {
  expand: [],
  collapse: []
})
// 缩放比例参与判定:20 × 3.7 → 直径 148
assert.deepEqual(zoomDecisions([node('a', 20)], 3.7, new Set(), rules).expand, ['a'])

// 已展开:直径低于 48 收起;等于阈值与两阈值之间都不变
assert.deepEqual(zoomDecisions([node('a', 23)], 1, new Set(['a']), rules), {
  expand: [],
  collapse: ['a']
})
assert.deepEqual(zoomDecisions([node('a', 24)], 1, new Set(['a']), rules), {
  expand: [],
  collapse: []
})
assert.deepEqual(zoomDecisions([node('a', 30)], 1, new Set(['a']), rules), {
  expand: [],
  collapse: []
})
assert.deepEqual(zoomDecisions([node('a', 30)], 1, new Set(), rules), {
  expand: [],
  collapse: []
})

// 文件不参与;多个节点按输入顺序给出决定
assert.deepEqual(zoomDecisions([node('f', 80, 1, false)], 1, new Set(), rules), {
  expand: [],
  collapse: []
})
assert.deepEqual(
  zoomDecisions([node('a', 40), node('f', 80, 2, false), node('b', 50)], 1, new Set(), rules)
    .expand,
  ['a', 'b']
)

// 深度达到上限的文件夹不自动展开;更深的手动容器仍可收起
assert.deepEqual(zoomDecisions([node('deep', 80, 2)], 1, new Set(), rules), {
  expand: [],
  collapse: []
})
assert.deepEqual(zoomDecisions([node('deep', 80, 2)], 1, new Set(['deep']), rules), {
  expand: [],
  collapse: []
})
assert.deepEqual(zoomDecisions([node('deep', 20, 3)], 1, new Set(['deep']), rules), {
  expand: [],
  collapse: ['deep']
})

// 默认配置来自 GRAPH_ZOOM
assert.deepEqual(zoomDecisions([node('a', 37)], 1, new Set()), { expand: ['a'], collapse: [] })
assert.equal(GRAPH_ZOOM.autoExpandDepth, 2)

console.log('selftest-graphzoom: 全部通过')
