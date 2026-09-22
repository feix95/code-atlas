// 配色字色自适应自测(第七十九锤):用户色给满自由后,实心主题色件上的字色归 pickAccentInk 管 ——
// 谁对比高听谁的。预设的既有字色不许漂;极深极浅色必须翻对字。
import assert from 'node:assert/strict'
import { hexToHsl, hslLuminance, pickAccentInk } from '../src/renderer/src/appearance.ts'
import { CH } from '../src/shared/ipcChannels.ts'

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

check('亮色主题石墨(深灰)照旧白字,不许漂', () => {
  const [h, s, l] = hexToHsl('#484848')
  assert.equal(pickAccentInk(h, s, l), INK_LIGHT, '石墨 accent 深灰应压白字')
})

check('暗色主题石墨照旧深字(预设配档把明度抬进 55)', () => {
  // 预设档沿用原配档:暗色明度带 55~85,石墨 accent 24→55
  assert.equal(pickAccentInk(0, 0, 55), INK_DARK, '石墨@暗色55 应压深字')
})

check('中明度色亮度低于阈值压白字(字色阈值边界回归)', () => {
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
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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
  const good = { mode: 'dark', preset: 'custom', accent: '#7dba32', secondary: '#5ac5db', base: '#1f2728' }
  assert.deepEqual(sanitizeAppearance(good), good)
  assert.equal(sanitizeAppearance({ mode: 'light', preset: 'teal', accent: '#12345' }).accent, null)
  assert.equal(sanitizeAppearance({ mode: 'light', preset: 'teal', secondary: '#gggggg' }).secondary, null)
  assert.equal(sanitizeAppearance({ mode: 'light', preset: 'custom', base: '蓝色' }).base, null)
})

check('清洗:雾空蓝预设是货架正编,存档里存它要认', () => {
  assert.equal(sanitizeAppearance({ mode: 'dark', preset: 'blue' }).preset, 'blue')
})

check('首启决策:主进程有档听主进程的,不迁移', () => {
  const stored = { mode: 'dark' as const, preset: 'custom' as const, accent: '#7dba32', secondary: null, base: null }
  const r = resolveAppearanceStartup({ stored, legacyRaw: '{"mode":"light"}' })
  assert.deepEqual(r.value, stored)
  assert.equal(r.migrate, false)
})

check('首启决策:主进程没档而旧档有效 → 收编迁移', () => {
  const r = resolveAppearanceStartup({
    stored: null,
    legacyRaw: JSON.stringify({ mode: 'dark', preset: 'custom', accent: '#7c5cd6', secondary: '#b79ef0' })
  })
  assert.equal(r.value.mode, 'dark')
  assert.equal(r.value.preset, 'custom')
  assert.equal(r.migrate, true)
})

check('旧档里的已下架彩色预设(teal/violet):清洗回石墨档,自选的色留着不丢', () => {
  const r = resolveAppearanceStartup({
    stored: null,
    legacyRaw: JSON.stringify({ mode: 'dark', preset: 'violet', accent: '#7c5cd6', secondary: '#b79ef0' })
  })
  assert.equal(r.value.preset, 'default')
  assert.equal(r.value.accent, '#7c5cd6')
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
    const a = { mode: 'dark' as const, preset: 'custom' as const, accent: '#7dba32', secondary: '#5ac5db', base: null }
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

// ── IPC 通道对账(2026-09-17 补网):两边收发必须成对,不然消息静默丢弃 ──
// 起因:atlas:appearance-save 一边 ipcRenderer.send、一边 ipcMain.handle —— 一边发件、一边只收 invoke,
// 消息没人接也没人报错,appearance.json 一次都没写成过,外观重启就回出厂。
// 硬规矩:send/sendSync 配 ipcMain.on,invoke 配 ipcMain.handle;主进程推给渲染层的配 ipcRenderer.on。
check('IPC 通道对账:preload 与主进程两边收发一一配对', () => {
  const srcDir = new URL('../src/', import.meta.url)
  const allSource = readdirSync(srcDir, { recursive: true })
    .map((f) => String(f).replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(new URL(f, srcDir), 'utf8'))
    .join('\n')
  // 通道名两种写法都认:旧的 'atlas:xxx' 字面量 + 收口后的 CH.key(P1-3)。
  // CH.key 经 ipcChannels 总账解析回真实通道名再对账 —— 表即权威,字面量反而该绝迹
  const chByKey = new Map<string, string>(Object.entries(CH).map(([k, v]) => [k, v]))
  const arg = String.raw`(?:'([^']+)'|CH\.(\w+))`
  const grab = (re: RegExp): Set<string> =>
    new Set(
      [...allSource.matchAll(re)]
        .map((m) => m[1] ?? (m[2] ? chByKey.get(m[2]) : undefined))
        .filter((c): c is string => typeof c === 'string')
    )

  const sentOneWay = grab(new RegExp(String.raw`ipcRenderer\.(?:send|sendSync)\(\s*${arg}`, 'g'))
  const sentInvoke = grab(new RegExp(String.raw`ipcRenderer\.invoke\(\s*${arg}`, 'g'))
  const onListeners = grab(new RegExp(String.raw`ipcMain\.on\(\s*${arg}`, 'g'))
  const handleListeners = grab(new RegExp(String.raw`ipcMain\.handle\(\s*${arg}`, 'g'))
  const pushed = grab(new RegExp(String.raw`(?:webContents|sender)\.send\(\s*${arg}`, 'g'))
  const subscribed = grab(new RegExp(String.raw`ipcRenderer\.on\(\s*${arg}`, 'g'))

  // CH 表自身也得干净:不许有两个键指向同一个通道名(指错键就会发错线)
  const chValues = Object.values(CH)
  assert.equal(new Set(chValues).size, chValues.length, 'ipcChannels 总账里有重名通道')

  // 先确认网还张得开:六张单子都得有货,哪张空了就是正则跟代码写法脱了节,别让空网假装全绿
  const rosters: [string, Set<string>][] = [
    ['send/sendSync', sentOneWay],
    ['invoke', sentInvoke],
    ['ipcMain.on', onListeners],
    ['ipcMain.handle', handleListeners],
    ['主进程推送', pushed],
    ['preload 订阅', subscribed]
  ]
  for (const [name, roster] of rosters) {
    assert.ok(roster.size > 0, `通道对账的「${name}」单子空了 —— 正则和代码写法可能脱节了`)
  }

  const orphans: string[] = []
  for (const c of sentOneWay) if (!onListeners.has(c)) orphans.push(`${c}(发了,主进程没有 ipcMain.on)`)
  for (const c of sentInvoke) if (!handleListeners.has(c)) orphans.push(`${c}(invoke 了,主进程没有 ipcMain.handle)`)
  for (const c of pushed) if (!subscribed.has(c)) orphans.push(`${c}(主进程推了,preload 没订阅)`)
  assert.deepEqual(orphans, [], `这些通道两边对不上:\n${orphans.join('\n')}`)
})

console.log('✅ 配色字色自适应 + 外观搬家 + IPC 通道对账自测全绿')
