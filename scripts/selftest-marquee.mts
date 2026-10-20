import assert from 'node:assert/strict'
import { marqueePlan } from '../src/renderer/src/marquee.ts'

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

// 超长路径:去程封顶 6s、回程封顶 260ms
{
  const plan = marqueePlan(400, 160)
  assert.ok(plan)
  assert.equal(plan.shift, 240)
  assert.equal(plan.durMs, 6000)
  assert.equal(plan.rewindMs, 260)
}

// 小幅溢出:去程按 28px/s 算(60px ≈ 2143ms),回程兜底 160ms 下限
{
  const plan = marqueePlan(220, 160)
  assert.ok(plan)
  assert.equal(plan.shift, 60)
  assert.equal(plan.durMs, 2143)
  assert.equal(plan.rewindMs, 160)
}

// 自定义速度与下限:去程 60px / 100px每秒 = 600ms
{
  const plan = marqueePlan(220, 160, { speedPxPerSec: 100, minDurMs: 100 })
  assert.ok(plan)
  assert.equal(plan.durMs, 600)
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
  const plan = marqueePlan(220, 160, { speedPxPerSec: Number.NaN, maxDurMs: -1 })
  assert.ok(plan)
  assert.equal(plan.durMs, 2143)
}

console.log('marquee: 全部通过')
