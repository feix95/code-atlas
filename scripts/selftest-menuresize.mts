import assert from 'node:assert/strict'
import {
  MENU_MAX_VIEWPORT_RATIO,
  clampMenuHeight,
  menuHeightBounds
} from '../src/renderer/src/menuResize.ts'

// 条目少:拉到条目总高就停,下面不留空白
assert.deepEqual(menuHeightBounds(400, 50, 1080, 80), { min: 80, max: 400 })

// 条目多:被窗口竖边的 2/3 封顶(1080 × 2/3 = 720)
assert.equal(menuHeightBounds(900, 50, 1080, 80).max, 720)
assert.equal(MENU_MAX_VIEWPORT_RATIO, 2 / 3)

// 靠近窗口底:被「顶边到窗口底」的可用距离封顶
assert.equal(menuHeightBounds(400, 900, 1080, 80).max, 1080 - 900 - 8)

// 极小窗口:可用距离比 min 还小,由下限兜住,不出现负高度
{
  const bounds = menuHeightBounds(400, 600, 640, 80)
  assert.equal(bounds.min, 80)
  assert.equal(bounds.max, 80)
}

// 非法读数:退化成只能维持下限
assert.deepEqual(menuHeightBounds(Number.NaN, 50, 1080, 80), { min: 80, max: 80 })
assert.deepEqual(menuHeightBounds(400, Number.NaN, 1080, 80), { min: 80, max: 80 })

// 夹取:上不下穿、下不越底,坏值回下限
assert.equal(clampMenuHeight(500, { min: 80, max: 400 }), 400)
assert.equal(clampMenuHeight(10, { min: 80, max: 400 }), 80)
assert.equal(clampMenuHeight(200, { min: 80, max: 400 }), 200)
assert.equal(clampMenuHeight(Number.NaN, { min: 80, max: 400 }), 80)

console.log('menuresize: 全部通过')
