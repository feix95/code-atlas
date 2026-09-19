// 气泡落点自测(桌宠气泡锤):placeBubbleBox 纯逻辑 —— 贴桌宠、不出屏、多屏认家。
// 走出面板锤补:isOutsideBounds —— 页签拖出主窗的窗外判定(沿口缓冲带)。
// 全是纯函数,不碰 electron 不碰真屏幕。
import assert from 'node:assert/strict'
import { placeBubbleBox, BUBBLE_WIDTH, BUBBLE_HEIGHT } from '../src/main/bubblePlacement.ts'
import { isOutsideBounds, DETACH_MARGIN_PX } from '../src/main/freechatHost.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

const WA = { x: 0, y: 0, width: 1920, height: 1040 } // 一块 1080p 屏的工作区(扣了任务栏)
const inside = (b: { x: number; y: number; width: number; height: number }, wa: typeof WA): boolean =>
  b.x >= wa.x && b.y >= wa.y && b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height

check('桌宠蹲右下角(经典位):气泡弹它上方,整窗在屏内', () => {
  const pet = { x: 1920 - 140 - 24, y: 1040 - 140 - 24, width: 140, height: 140 }
  const box = placeBubbleBox(pet, [WA])
  assert.equal(box.width, BUBBLE_WIDTH)
  assert.equal(box.height, BUBBLE_HEIGHT)
  assert.equal(box.y + box.height < pet.y, true, '气泡得在桌宠上方')
  assert.ok(inside(box, WA), '不出工作区')
})

check('桌宠贴屏顶:上方塞不下就弹下方', () => {
  const pet = { x: 900, y: 0, width: 140, height: 140 }
  const box = placeBubbleBox(pet, [WA])
  assert.equal(box.y >= pet.y + pet.height, true, '只能往桌宠下方弹')
  assert.ok(inside(box, WA))
})

check('桌宠在屏幕正中:上方够高还是弹上方', () => {
  const pet = { x: 900, y: 500, width: 140, height: 140 }
  const box = placeBubbleBox(pet, [WA])
  assert.equal(box.y + box.height <= pet.y, true)
  // 水平方向以桌宠中轴居中(夹回屏内前)
  assert.equal(box.x + box.width / 2, 900 + 70)
})

check('桌宠贴左缘:气泡水平夹回屏内,不往外跑', () => {
  const pet = { x: 0, y: 600, width: 140, height: 140 }
  const box = placeBubbleBox(pet, [WA])
  assert.equal(box.x >= 0, true)
  assert.ok(inside(box, WA))
})

check('多屏:桌宠在左边那块屏(负坐标),气泡跟过去不出屏', () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1040 }
  const pet = { x: -1920 + 40, y: 1040 - 140 - 24, width: 140, height: 140 }
  const box = placeBubbleBox(pet, [WA, left])
  assert.ok(inside(box, left), '得落左屏,不许跑回主屏')
  assert.equal(box.y + box.height < pet.y, true)
})

check('矮屏上下都不够:夹回屏内不溢出(挑空大的一侧)', () => {
  const squat = { x: 0, y: 0, width: 1920, height: 520 }
  const pet = { x: 900, y: 480, width: 140, height: 140 }
  const box = placeBubbleBox(pet, [squat])
  assert.ok(inside(box, squat), '屏比气泡矮也得全须全尾')
})

check('工作区为空(理论兜底):只回尺寸,坐标交给系统', () => {
  const box = placeBubbleBox({ x: 100, y: 100, width: 140, height: 140 }, [])
  assert.equal(box.width, BUBBLE_WIDTH)
  assert.equal(box.height, BUBBLE_HEIGHT)
})

// ── 走出面板锤:页签拖出主窗的判定(isOutsideBounds + DETACH_MARGIN_PX)──

check('松手点在窗内:不算拖出去', () => {
  const win = { x: 100, y: 100, width: 1200, height: 800 }
  assert.equal(isOutsideBounds(win, 500, 400, DETACH_MARGIN_PX), false)
  assert.equal(isOutsideBounds(win, 100, 100, DETACH_MARGIN_PX), false, '角上也算窗内')
})

check('贴着沿口擦出去(缓冲带内):不算,防手滑', () => {
  const win = { x: 100, y: 100, width: 1200, height: 800 }
  // 右沿外 5px,缓冲带 10px → 不算
  assert.equal(isOutsideBounds(win, 1305, 400, 10), false)
  // 下沿外正好 10px → 不算(得「超过」才算)
  assert.equal(isOutsideBounds(win, 500, 910, 10), false)
})

check('明显拖出窗口:任一方向超界即算', () => {
  const win = { x: 100, y: 100, width: 1200, height: 800 }
  assert.equal(isOutsideBounds(win, 1400, 400, 10), true, '右边出去一大截')
  assert.equal(isOutsideBounds(win, 50, 400, 10), true, '左边出去一大截')
  assert.equal(isOutsideBounds(win, 500, 950, 10), true, '下边出去一大截')
  assert.equal(isOutsideBounds(win, 500, 50, 10), true, '上边出去一大截')
  assert.equal(isOutsideBounds(win, 50, 50, 10), true, '斜对角出角也算')
})

check('最大化窗口:松手在任务栏(窗外一截)算数,窗内拖到边不算', () => {
  const maximized = { x: 0, y: 0, width: 1920, height: 1040 }
  assert.equal(isOutsideBounds(maximized, 960, 1070, 10), true, '任务栏上松手 = 放出')
  assert.equal(isOutsideBounds(maximized, 960, 1039, 10), false, '贴着下沿窗内 = 不算')
})

console.log('✅ 气泡落点 + 拖出判定自测全绿')
