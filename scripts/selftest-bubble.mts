// 气泡落点自测(桌宠气泡锤):placeBubbleBox 纯逻辑 —— 贴桌宠、不出屏、多屏认家。
// 走出面板锤补:isOutsideBounds —— 页签拖出主窗的窗外判定(沿口缓冲带)。
// 全是纯函数,不碰 electron 不碰真屏幕。
import assert from 'node:assert/strict'
import {
  placeBubbleBox,
  resizeBubbleBox,
  BUBBLE_WIDTH,
  BUBBLE_HEIGHT,
  BUBBLE_MIN_WIDTH,
  BUBBLE_MIN_HEIGHT
} from '../src/main/bubblePlacement.ts'
import { isOutsideBounds, DETACH_MARGIN_PX } from '../src/main/freechatHost.ts'
import { parseBubbleSize } from '../src/main/bubbleState.ts'
import { createMirrorThrottle } from '../src/shared/mirrorThrottle.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  console.log(`✓ ${name}`)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const WA = { x: 0, y: 0, width: 1920, height: 1040 } // 一块 1080p 屏的工作区(扣了任务栏)
const inside = (
  b: { x: number; y: number; width: number; height: number },
  wa: typeof WA
): boolean =>
  b.x >= wa.x &&
  b.y >= wa.y &&
  b.x + b.width <= wa.x + wa.width &&
  b.y + b.height <= wa.y + wa.height

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

// ── 镜像节流(气泡锁死案 2026-09-21):尾推到点必须发最新一版,不许念旧账 ──
// 病根:旧实现的尾推定时器发的是「排闹钟那一刻」抓到的旧快照;尾推排着队时来的
// 改动被直接跳过 —— AI 答完的「忙→完」翻牌常落在这窗口里被丢掉,主进程存底永远
// 卡「忙」,气泡输入框锁死。

await checkAsync('镜像节流:隔够间隔的推送立即照发', async () => {
  const sent: string[] = []
  const notify = createMirrorThrottle<string>((v) => sent.push(v), 30)
  notify('a')
  await sleep(50)
  notify('b')
  assert.deepEqual(sent, ['a', 'b'])
})

await checkAsync('镜像节流:刷屏合并 —— 窗口里的一串改动只补最后一版', async () => {
  const sent: string[] = []
  const notify = createMirrorThrottle<string>((v) => sent.push(v), 30)
  notify('a')
  notify('b')
  notify('c')
  await sleep(50)
  assert.deepEqual(sent, ['a', 'c'])
})

await checkAsync('镜像节流:尾推发最新版(气泡锁死案病根 —— 最后一翻不许丢)', async () => {
  const sent: string[] = []
  const notify = createMirrorThrottle<string>((v) => sent.push(v), 30)
  notify('done-1') // 立即发
  notify('busy-字已糊完') // 进窗口,排尾推
  notify('done-2') // 窗口内又来一版 —— 旧实现把它跳了,尾推发的是 busy 旧账
  await sleep(50)
  assert.equal(sent.at(-1), 'done-2', '尾推必须发最新一版;卡在 busy = 气泡输入锁死')
})

// ── 气泡放大锤(2026-09-21):resizeBubbleBox 拖拽对账 + 记忆尺寸落位/存档 ──
// 口径:拖哪个角/边,对侧边钉死;最小 280×320 夹底;不许长出家屏工作区。

check('拖右下角:往右下长,左上角钉死', () => {
  const start = { x: 100, y: 100, width: 360, height: 480 }
  const box = resizeBubbleBox(start, 'se', { x: 460, y: 580 }, { x: 560, y: 680 }, [WA])
  assert.deepEqual(box, { x: 100, y: 100, width: 460, height: 580 })
})

check('拖左上角:往左上长,右下角钉死', () => {
  const start = { x: 500, y: 300, width: 360, height: 480 }
  const box = resizeBubbleBox(start, 'nw', { x: 500, y: 300 }, { x: 400, y: 200 }, [WA])
  assert.deepEqual(box, { x: 400, y: 200, width: 460, height: 580 })
})

check('拖右边中段:只改宽,高不动(垂直方向光标乱晃不掺和)', () => {
  const start = { x: 100, y: 100, width: 360, height: 480 }
  const box = resizeBubbleBox(start, 'e', { x: 460, y: 0 }, { x: 560, y: 500 }, [WA])
  assert.deepEqual(box, { x: 100, y: 100, width: 460, height: 480 })
})

check('往里猛缩:小到下限就停,不会再瘪', () => {
  const start = { x: 100, y: 100, width: 360, height: 480 }
  const box = resizeBubbleBox(start, 'se', { x: 460, y: 580 }, { x: 150, y: 200 }, [WA])
  assert.deepEqual(box, { x: 100, y: 100, width: BUBBLE_MIN_WIDTH, height: BUBBLE_MIN_HEIGHT })
})

check('往屏外拖:顶到工作区沿口夹住,不长出去', () => {
  const start = { x: 1500, y: 100, width: 360, height: 480 }
  const box = resizeBubbleBox(start, 'e', { x: 1860, y: 0 }, { x: 3000, y: 0 }, [WA])
  assert.deepEqual(box, { x: 1500, y: 100, width: 420, height: 480 }, '右沿最多到 1920')
})

check('往左上拖出屏:钉住的右下角不动,左上角贴着屏沿', () => {
  const start = { x: 500, y: 300, width: 360, height: 480 }
  const box = resizeBubbleBox(start, 'nw', { x: 500, y: 300 }, { x: -999, y: -999 }, [WA])
  assert.deepEqual(box, { x: 0, y: 0, width: 860, height: 780 })
})

check('重开落位:记忆尺寸贴桌宠上方,大了也全须全尾', () => {
  const pet = { x: 1920 - 140 - 24, y: 1040 - 140 - 24, width: 140, height: 140 }
  const box = placeBubbleBox(pet, [WA], { width: 600, height: 700 })
  assert.deepEqual({ width: box.width, height: box.height }, { width: 600, height: 700 })
  assert.equal(box.y + box.height < pet.y, true, '还是弹桌宠上方')
  assert.ok(inside(box, WA))
})

check('记忆尺寸比屏还大:先夹到屏再落位', () => {
  const pet = { x: 900, y: 600, width: 140, height: 140 }
  const box = placeBubbleBox(pet, [WA], { width: 5000, height: 3000 })
  assert.equal(box.width, WA.width)
  assert.equal(box.height, WA.height)
  assert.ok(inside(box, WA))
})

check('尺寸存档:正常尺寸取整落账,垃圾/缺斤短两回 null,偏小捞回下限', () => {
  assert.deepEqual(parseBubbleSize({ width: 520.6, height: 700.4 }), { width: 521, height: 700 })
  assert.equal(parseBubbleSize(null), null)
  assert.equal(parseBubbleSize({ width: 'x', height: 700 }), null)
  assert.deepEqual(parseBubbleSize({ width: 10, height: 10 }), {
    width: BUBBLE_MIN_WIDTH,
    height: BUBBLE_MIN_HEIGHT
  })
})

console.log('✅ 气泡落点 + 拖出判定 + 镜像节流 + 缩放对账自测全绿')
