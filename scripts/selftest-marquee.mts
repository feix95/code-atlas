import assert from 'node:assert/strict'
import {
  MARQUEE_CROSSFADE_MS,
  MARQUEE_HOVER_DELAY_MS,
  MARQUEE_SLIDE_MAX_PX,
  MARQUEE_TAIL_NUDGE_PX,
  marqueePlan
} from '../src/renderer/src/marquee.ts'

assert.equal(MARQUEE_HOVER_DELAY_MS, 100)
assert.equal(MARQUEE_SLIDE_MAX_PX, 120)
assert.equal(MARQUEE_TAIL_NUDGE_PX, 3)
assert.equal(MARQUEE_CROSSFADE_MS, 280)

// 装得下:不滚
assert.equal(marqueePlan(120, 160), null)
assert.equal(marqueePlan(160, 160), null)

// 像素取整的假溢出(1px 内):不滚
assert.equal(marqueePlan(160.5, 160), null)
assert.equal(marqueePlan(161, 160), null)

// 小数宽度向上取整,保证末字完整露出
{
  const plan = marqueePlan(200.4, 160)
  assert.ok(plan)
  assert.equal(plan.shift, 41)
}

// 去程按 1200px/s 算,夹在 250–450ms;超长路径回程封顶 260ms
{
  const short = marqueePlan(220, 160)
  assert.ok(short)
  assert.equal(short.shift, 60)
  assert.equal(short.durMs, 250)
  assert.equal(short.rewindMs, 160)
  assert.equal(short.mode, 'slide')

  const mid = marqueePlan(520, 160)
  assert.ok(mid)
  assert.equal(mid.shift, 360)
  assert.equal(mid.durMs, 300)
  assert.equal(mid.mode, 'crossfade')

  const long = marqueePlan(800, 160)
  assert.ok(long)
  assert.equal(long.shift, 640)
  assert.equal(long.durMs, 450)
  assert.equal(long.rewindMs, 260)
  assert.equal(long.mode, 'crossfade')
}

// 120px 及以内平移,再长两层硬切
{
  const atCap = marqueePlan(280, 160)
  assert.ok(atCap)
  assert.equal(atCap.shift, 120)
  assert.equal(atCap.mode, 'slide')

  const over = marqueePlan(281, 160)
  assert.ok(over)
  assert.equal(over.shift, 121)
  assert.equal(over.mode, 'crossfade')
}

// 自定义去程时长
{
  const plan = marqueePlan(220, 160, { durMs: 400 })
  assert.ok(plan)
  assert.equal(plan.durMs, 400)
}

// 非法读数(排版未完成、NaN):一律不滚
assert.equal(marqueePlan(Number.NaN, 160), null)
assert.equal(marqueePlan(400, Number.NaN), null)
assert.equal(marqueePlan(400, Number.POSITIVE_INFINITY), null)
assert.equal(marqueePlan(-400, 160), null)
assert.equal(marqueePlan(400, 0), null)
assert.equal(marqueePlan(0, 0), null)

// 坏配置回落默认值,不把 NaN 漏进 CSS 变量
{
  const plan = marqueePlan(220, 160, { durMs: Number.NaN })
  assert.ok(plan)
  assert.equal(plan.durMs, 250)
}

console.log('marquee: 全部通过')
