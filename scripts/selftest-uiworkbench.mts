// UI 工作台纯逻辑自测:画板尺寸解析与预设匹配、视口缩放/适配、标尺刻度换档
import assert from 'node:assert/strict'
import {
  ARTBOARD_SIDE_MAX,
  ARTBOARD_SIDE_MIN,
  artboardOrientation,
  matchArtboardPreset,
  parseArtboardSide,
  withOrientation
} from '../src/shared/uiWorkbench/artboard.ts'
import {
  clampZoom,
  fitArtboard,
  FIT_PADDING,
  rulerMajorStep,
  rulerTicks,
  RULER_MIN_MAJOR_PX,
  zoomAt,
  ZOOM_MAX,
  ZOOM_MIN
} from '../src/renderer/src/uiWorkbench/viewport.ts'
import { formatRulerValue } from '../src/renderer/src/uiWorkbench/drawRuler.ts'
import {
  DEFAULT_ARTBOARD_PREFS,
  normalizePresetName,
  recordArtboardSize,
  removeArtboardPreset,
  RECENT_SIZES_MAX,
  sanitizeArtboardPrefs,
  saveArtboardPreset
} from '../src/shared/uiWorkbench/artboardPrefs.ts'
import {
  buildArtboardOptionGroups,
  matchArtboardOption
} from '../src/renderer/src/uiWorkbench/artboardOptions.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('画板单边输入:取整、钳边界、非数字返回 null', () => {
  assert.equal(parseArtboardSide(' 390 '), 390)
  assert.equal(parseArtboardSide('390.6'), 391)
  assert.equal(parseArtboardSide('0'), ARTBOARD_SIDE_MIN)
  assert.equal(parseArtboardSide('-20'), ARTBOARD_SIDE_MIN)
  assert.equal(parseArtboardSide('99999'), ARTBOARD_SIDE_MAX)
  assert.equal(parseArtboardSide(''), null)
  assert.equal(parseArtboardSide('abc'), null)
})

check('预设匹配:命中预设返回预设,其余为自定义', () => {
  assert.equal(matchArtboardPreset({ width: 390, height: 844 })?.id, 'phone-standard')
  assert.equal(matchArtboardPreset({ width: 391, height: 844 }), null)
})

check('缩放钳在范围内', () => {
  assert.equal(clampZoom(0.01), ZOOM_MIN)
  assert.equal(clampZoom(100), ZOOM_MAX)
  assert.equal(clampZoom(1.5), 1.5)
})

check('以鼠标点为中心缩放:该点下的设计坐标不动', () => {
  const view = { zoom: 1, panX: 100, panY: 50 }
  const next = zoomAt(view, 2, 300, 250)
  const designX = (300 - view.panX) / view.zoom
  const designY = (250 - view.panY) / view.zoom
  assert.equal(next.panX + designX * next.zoom, 300)
  assert.equal(next.panY + designY * next.zoom, 250)
  assert.equal(zoomAt(view, 1000, 0, 0).zoom, ZOOM_MAX)
})

check('适配窗口:小画板不放大超过 100% 且居中;大画板缩到放得下', () => {
  const small = fitArtboard({ width: 390, height: 844 }, { width: 2000, height: 1500 })
  assert.equal(small.zoom, 1)
  assert.equal(small.panX, (2000 - 390) / 2)
  const big = fitArtboard({ width: 1920, height: 1080 }, { width: 1000, height: 800 })
  assert.ok(big.zoom < 1)
  assert.ok(1920 * big.zoom <= 1000 - FIT_PADDING * 2 + 1e-9)
  assert.ok(1080 * big.zoom <= 800 - FIT_PADDING * 2 + 1e-9)
})

check('标尺主刻度间距随缩放换档,屏幕间距不小于下限', () => {
  for (const zoom of [0.1, 0.25, 0.5, 1, 2, 4, 8]) {
    assert.ok(rulerMajorStep(zoom) * zoom >= RULER_MIN_MAJOR_PX, `zoom ${zoom}`)
  }
  assert.equal(rulerMajorStep(1), 100)
  assert.equal(rulerMajorStep(8), 10)
})

check('标尺刻度:0 点对齐画板原点、覆盖可见范围、主刻度落在步长整数倍', () => {
  const ticks = rulerTicks(1, 40, 500)
  const zero = ticks.find((t) => t.value === 0)
  assert.ok(zero?.major)
  assert.equal(zero.pos, 40)
  assert.ok(ticks[0].pos <= 0 && ticks.at(-1)!.pos >= 500 - 10)
  for (const t of ticks.filter((t) => t.major)) assert.equal(t.value % 100, 0)
})

check('标尺数字:整数原样,小数最多两位且去尾零', () => {
  assert.equal(formatRulerValue(200), '200')
  assert.equal(formatRulerValue(2.5), '2.5')
  assert.equal(formatRulerValue(-0.25), '-0.25')
})

check('画板偏好存档:坏数据回落默认,坏字段丢弃,最近使用去重截断', () => {
  assert.deepEqual(sanitizeArtboardPrefs(null), DEFAULT_ARTBOARD_PREFS)
  assert.deepEqual(sanitizeArtboardPrefs('garbage'), DEFAULT_ARTBOARD_PREFS)
  const prefs = sanitizeArtboardPrefs({
    last: { width: 0, height: 844 },
    recent: [
      { width: 1, height: 1 },
      { width: 1, height: 1 },
      { width: 1.5, height: 2 },
      ...Array.from({ length: 8 }, (_, i) => ({ width: 100 + i, height: 100 }))
    ],
    saved: [
      { id: 'a', name: ' 我的屏 ', width: 500, height: 600 },
      { id: '', name: 'x', width: 1, height: 1 },
      { id: 'b', name: '   ', width: 1, height: 1 }
    ]
  })
  assert.deepEqual(prefs.last, DEFAULT_ARTBOARD_PREFS.last)
  assert.equal(prefs.recent.length, RECENT_SIZES_MAX)
  assert.deepEqual(prefs.recent[0], { width: 1, height: 1 })
  assert.deepEqual(prefs.saved, [{ id: 'a', name: '我的屏', width: 500, height: 600 }])
})

check('记录尺寸:成为上次尺寸并顶到最近使用最前,不重复', () => {
  let prefs = DEFAULT_ARTBOARD_PREFS
  for (const width of [100, 200, 300, 400, 500, 600]) {
    prefs = recordArtboardSize(prefs, { width, height: 10 })
  }
  prefs = recordArtboardSize(prefs, { width: 300, height: 10 })
  assert.deepEqual(prefs.last, { width: 300, height: 10 })
  assert.deepEqual(
    prefs.recent.map((s) => s.width),
    [300, 600, 500, 400, 200]
  )
})

check('我的预设:留空以尺寸命名,同名覆盖原位,可删除', () => {
  const size = { width: 800, height: 600 }
  assert.equal(normalizePresetName('  ', size), '800 × 600')
  let prefs = saveArtboardPreset(DEFAULT_ARTBOARD_PREFS, { id: 'p1', name: 'A', ...size })
  prefs = saveArtboardPreset(prefs, { id: 'p2', name: 'B', width: 1, height: 1 })
  prefs = saveArtboardPreset(prefs, { id: 'p3', name: 'A', width: 2, height: 2 })
  assert.deepEqual(prefs.saved[0], { id: 'p1', name: 'A', width: 2, height: 2 })
  assert.equal(prefs.saved.length, 2)
  assert.deepEqual(
    removeArtboardPreset(prefs, 'p1').saved.map((p) => p.id),
    ['p2']
  )
})

check('尺寸下拉:分组顺序,回选优先我的预设 > 内置预设 > 最近使用', () => {
  const prefs = {
    last: { width: 390, height: 844 },
    recent: [
      { width: 390, height: 844 },
      { width: 777, height: 555 }
    ],
    saved: [{ id: 's1', name: '我的', width: 777, height: 555 }]
  }
  const groups = buildArtboardOptionGroups(prefs)
  assert.deepEqual(
    groups.slice(0, 3).map((g) => g.label),
    ['最近使用', '我的预设', '手机']
  )
  assert.equal(matchArtboardOption(groups, { width: 390, height: 844 })?.source, 'builtin')
  assert.equal(matchArtboardOption(groups, { width: 777, height: 555 })?.savedId, 's1')
  assert.equal(matchArtboardOption(groups, { width: 3, height: 3 }), null)
  const noSaved = buildArtboardOptionGroups({ ...prefs, saved: [] })
  assert.equal(matchArtboardOption(noSaved, { width: 777, height: 555 })?.source, 'recent')
  assert.ok(!buildArtboardOptionGroups(DEFAULT_ARTBOARD_PREFS).some((g) => g.label === '最近使用'))
})

check('横竖屏:宽大于高为横屏,切换即对调宽高,同方向不变', () => {
  assert.equal(artboardOrientation({ width: 390, height: 844 }), 'portrait')
  assert.equal(artboardOrientation({ width: 500, height: 500 }), 'portrait')
  assert.equal(artboardOrientation({ width: 1024, height: 768 }), 'landscape')
  assert.deepEqual(withOrientation({ width: 390, height: 844 }, 'landscape'), {
    width: 844,
    height: 390
  })
  const same = { width: 390, height: 844 }
  assert.equal(withOrientation(same, 'portrait'), same)
})

check('尺寸下拉:横竖屏切换后仍回选原预设,精确匹配优先', () => {
  const groups = buildArtboardOptionGroups({
    last: { width: 1024, height: 768 },
    recent: [{ width: 1024, height: 768 }],
    saved: [{ id: 's1', name: '横版', width: 900, height: 400 }]
  })
  assert.equal(matchArtboardOption(groups, { width: 1024, height: 768 })?.value, 'builtin:tablet')
  assert.equal(matchArtboardOption(groups, { width: 400, height: 900 })?.savedId, 's1')
  assert.equal(matchArtboardOption(groups, { width: 900, height: 400 })?.savedId, 's1')
})

console.log('UI 工作台纯逻辑自测全部通过')
