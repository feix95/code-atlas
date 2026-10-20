// 页签拖拽落点几何自测:投影中心与插入序。纯函数不碰 DOM,秒跑。
// 盯的是两个历史症状:抓握偏移没折算(判定偏半张签)、队尾凭空多出一格。
import assert from 'node:assert/strict'
import { dragCenterX, insertIndexAt } from '../src/renderer/src/tabDragGeometry.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

// 一条 3 张签的带:中线 50 / 150 / 250
const CENTERS = [50, 150, 250]

check('dragCenterX:抓在签左端,中心落在指针右侧半张处', () => {
  assert.equal(dragCenterX(100, 10, 100), 140)
})

check('dragCenterX:抓在签右端,中心落在指针左侧半张处', () => {
  assert.equal(dragCenterX(100, 90, 100), 60)
})

check('insertIndexAt:中线之间取前一位,队尾取可见签数', () => {
  assert.equal(insertIndexAt(CENTERS, 20), 0)
  assert.equal(insertIndexAt(CENTERS, 120), 1)
  assert.equal(insertIndexAt(CENTERS, 200), 2)
  assert.equal(insertIndexAt(CENTERS, 400), 3)
})

check('insertIndexAt:空条带只有队尾一个落点', () => {
  assert.equal(insertIndexAt([], 999), 0)
})

check('insertIndexAt:恰好压在某张的中线上 = 已越过它', () => {
  assert.equal(insertIndexAt(CENTERS, 150), 2)
})

check('回归:抓在签右端时,指针刚过前签中线还不算越过', () => {
  // 裸指针 60 已越过第一张的中线 50,但被拖签中心还在 20 —— 签没挪过去
  const pointerX = 60
  const grabDx = 90
  const width = 100
  assert.equal(insertIndexAt(CENTERS, pointerX), 1, '裸指针会提前翻位(旧行为)')
  assert.equal(insertIndexAt(CENTERS, dragCenterX(pointerX, grabDx, width)), 0)
})

check('回归:拖到最右侧只在队尾落一格,不多出空位', () => {
  // 5 张窄签(420px 带):中线 41 / 109 / 177 / 245 / 313
  const narrow = [41, 109, 177, 245, 313]
  const index = insertIndexAt(narrow, 419)
  assert.equal(index, 5, '落点是可见签数,不是签数 + 1')
  assert.equal(index, narrow.length)
})
