// 配色字色自适应自测(第七十九锤):用户色给满自由后,实心主题色件上的字色归 pickAccentInk 管 ——
// 谁对比高听谁的。预设的既有字色不许漂;极深极浅色必须翻对字。
import assert from 'node:assert/strict'
import { hexToHsl, hslLuminance, pickAccentInk } from '../src/renderer/src/appearance.ts'

const INK_DARK = '#10222e'
const INK_LIGHT = '#ffffff'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('hslLuminance:黑白灰三照', () => {
  assert.ok(Math.abs(hslLuminance(0, 0, 0)) < 1e-6)
  assert.ok(Math.abs(hslLuminance(0, 0, 100) - 1) < 1e-6)
  assert.ok(Math.abs(hslLuminance(0, 0, 50) - 0.214) < 0.001)
})

check('亮色主题三套预设照旧白字,不许漂', () => {
  for (const hex of ['#147dcc', '#0e9488', '#7c5cd6']) {
    const [h, s, l] = hexToHsl(hex)
    assert.equal(pickAccentInk(h, s, l), INK_LIGHT, `亮色预设 ${hex} 应压白字`)
  }
})

check('暗色主题雾空蓝/青碧照旧深字(预设配档把明度抬进 55)', () => {
  // 预设档沿用原配档:暗色明度带 55~85,雾空蓝 43.9→55、青碧 31.8→55
  assert.equal(pickAccentInk(205.8, 82.1, 55), INK_DARK, '雾空蓝@暗色55 应压深字')
  assert.equal(pickAccentInk(174.6, 82.7, 55), INK_DARK, '青碧@暗色55 应压深字')
})

check('暗色主题丁香紫按钮字由深翻白:对比 3.4 → 4.8 更清楚(唯一一次字色漂移,明算账)', () => {
  // 丁香紫 60.0 本就在原暗色带内,字色按对比度改判:白
  assert.ok(Math.abs(hslLuminance(255.7, 59.8, 60) - 0.1679) < 0.001)
  assert.equal(pickAccentInk(255.7, 59.8, 60), INK_LIGHT)
})

check('极深色(近黑)压白字;极浅色(近白)压深字', () => {
  assert.equal(pickAccentInk(0, 0, 5), INK_LIGHT)
  assert.equal(pickAccentInk(0, 0, 95), INK_DARK)
})

check('正红压白字,正黄压深字(黄上白字谁也看不清)', () => {
  assert.equal(pickAccentInk(0, 100, 50), INK_LIGHT)
  assert.equal(pickAccentInk(60, 100, 50), INK_DARK)
})

check('小葵的绿(#7dba32)明度带内不夹,压深字', () => {
  const [h, s, l] = hexToHsl('#7dba32')
  assert.ok(l > 5 && l < 95)
  assert.equal(pickAccentInk(h, s, l), INK_DARK)
})

// ── 外观搬家(2026-09-16,localStorage → 主进程 appearance.json):清洗/迁移/落盘 ──
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeAppearance, resolveAppearanceStartup, defaultAppearance } from '../src/shared/appearancePrefs.ts'
import { appearanceFilePath, loadAppearanceFileSync, saveAppearanceFile } from '../src/main/appearanceStore.ts'

check('清洗:陌生存档各字段越界一律回默认', () => {
  assert.deepEqual(sanitizeAppearance(null), defaultAppearance())
  assert.deepEqual(sanitizeAppearance('垃圾'), defaultAppearance())
  assert.deepEqual(
    sanitizeAppearance({ mode: '天书', preset: '彩虹', accent: 'red', secondary: 42 }),
    defaultAppearance()
  )
})

check('清洗:合法值原样放行,非法 hex 拦下', () => {
  const good = { mode: 'dark', preset: 'custom', accent: '#7dba32', secondary: '#5ac5db' }
  assert.deepEqual(sanitizeAppearance(good), good)
  assert.equal(sanitizeAppearance({ mode: 'light', preset: 'teal', accent: '#12345' }).accent, null)
  assert.equal(sanitizeAppearance({ mode: 'light', preset: 'teal', secondary: '#gggggg' }).secondary, null)
})

check('首启决策:主进程有档听主进程的,不迁移', () => {
  const stored = { mode: 'dark' as const, preset: 'teal' as const, accent: null, secondary: null }
  const r = resolveAppearanceStartup({ stored, legacyRaw: '{"mode":"light"}' })
  assert.deepEqual(r.value, stored)
  assert.equal(r.migrate, false)
})

check('首启决策:主进程没档而旧档有效 → 收编迁移', () => {
  const r = resolveAppearanceStartup({
    stored: null,
    legacyRaw: JSON.stringify({ mode: 'dark', preset: 'violet', accent: '#7c5cd6', secondary: '#b79ef0' })
  })
  assert.equal(r.value.mode, 'dark')
  assert.equal(r.value.preset, 'violet')
  assert.equal(r.migrate, true)
})

check('首启决策:旧档是全默认/烂的 → 不值得迁移,回默认', () => {
  assert.deepEqual(resolveAppearanceStartup({ stored: null, legacyRaw: JSON.stringify(defaultAppearance()) }), {
    value: defaultAppearance(),
    migrate: false
  })
  assert.deepEqual(resolveAppearanceStartup({ stored: null, legacyRaw: '{烂的' }), {
    value: defaultAppearance(),
    migrate: false
  })
  assert.deepEqual(resolveAppearanceStartup({ stored: null, legacyRaw: null }), {
    value: defaultAppearance(),
    migrate: false
  })
})

check('落盘:存进 appearance.json 再读回来是同一份,坏文件老实回 null', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-appearance-'))
  try {
    // 没存过 = null(首启迁移的信号)
    assert.equal(loadAppearanceFileSync(dir), null)
    const a = { mode: 'dark' as const, preset: 'custom' as const, accent: '#7dba32', secondary: '#5ac5db' }
    await saveAppearanceFile(dir, a)
    assert.deepEqual(loadAppearanceFileSync(dir), a)
    assert.deepEqual(JSON.parse(readFileSync(appearanceFilePath(dir), 'utf8')), a)
    // 烂文件:回 null,不炸
    writeFileSync(appearanceFilePath(dir), '{烂的')
    assert.equal(loadAppearanceFileSync(dir), null)
    assert.ok(!existsSync(join(dir, 'nope.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log('✅ 配色字色自适应 + 外观搬家自测全绿')
