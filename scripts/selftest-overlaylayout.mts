import assert from 'node:assert/strict'
import {
  clampOverlayBox,
  clampPreferRightOverlay,
  tokenToPx
} from '../src/renderer/src/overlayLayout.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`  ✓ ${name}`)
}

check('tokenToPx 认 rem / px / 坏值', () => {
  assert.equal(tokenToPx('0.5rem', 16, 8), 8)
  assert.equal(tokenToPx('0.5rem', 24, 8), 12)
  assert.equal(tokenToPx('160px', 16, 8), 160)
  assert.equal(tokenToPx('280', 16, 8), 280)
  assert.equal(tokenToPx('var(--space-2)', 16, 8), 8)
  assert.equal(tokenToPx('', 16, 8), 8)
  assert.equal(tokenToPx('-1px', 16, 8), 8)
})

check('clampOverlayBox 贴窗边夹紧,宽度跟内容走', () => {
  const view = { innerWidth: 400, innerHeight: 300 }
  assert.deepEqual(clampOverlayBox(10, 10, 180, 80, view, 8), { left: 10, top: 10 })
  assert.deepEqual(clampOverlayBox(350, 10, 180, 80, view, 8), { left: 212, top: 10 })
  assert.deepEqual(clampOverlayBox(10, 280, 180, 80, view, 8), { left: 10, top: 212 })
})

check('clampPreferRightOverlay 右边挤不下翻左、上面挤不下翻下', () => {
  const view = { innerWidth: 400, innerHeight: 300 }
  const above = clampPreferRightOverlay({
    x: 40,
    y: 120,
    width: 46,
    height: 80,
    view,
    edge: 8,
    gapX: 24,
    gapY: 12
  })
  assert.equal(above.left, 64)
  assert.equal(above.pinBottom, 300 - 120 + 12)
  assert.equal(above.top, 0)

  const flip = clampPreferRightOverlay({
    x: 380,
    y: 20,
    width: 200,
    height: 80,
    view,
    edge: 8,
    gapX: 24,
    gapY: 12
  })
  assert.equal(flip.pinBottom, null)
  assert.ok(flip.left + 200 <= 400 - 8)
})

console.log('✅ overlayLayout 全绿')
