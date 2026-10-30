// 关系图谱模块颜色 token 与滚轮悬停看法的纯函数自测:全局颜色序号与生成色、改色存档清洗、
// 悬停看法的切换与点亮范围、滚轮手势的意图判定(缩放 / 切看法 / 进出层级)与防误触。
import assert from 'node:assert/strict'
import {
  generatedHue,
  isHexColor,
  MAX_OVERRIDES_PER_ROOT,
  moduleColor,
  moduleSwatchCss,
  sanitizeModuleColorPrefs,
  setModuleColorIn
} from '../src/renderer/src/graph/moduleColors.ts'
import {
  hoverModesFor,
  hoverRelated,
  isHoverLink,
  stepHoverMode
} from '../src/renderer/src/graph/hoverModes.ts'
import { nextGesture, takeSteps, wheelDeltaPx } from '../src/renderer/src/graph/wheelIntent.ts'
import { GRAPH_MODULE_COLORS, GRAPH_WHEEL } from '../src/renderer/src/graph/graphConfig.ts'

const PALETTE = Array.from({ length: GRAPH_MODULE_COLORS }, (_, i) => `#00000${i}`)
const TONE = { sat: 50, lightA: 40, lightB: 55 }

function checkColors(): void {
  assert.equal(moduleColor(0, undefined, PALETTE, TONE, 'gray'), '#000000', '前 8 个用调色板')
  assert.equal(moduleColor(7, undefined, PALETTE, TONE, 'gray'), '#000007')
  assert.equal(moduleColor(undefined, undefined, PALETTE, TONE, 'gray'), 'gray', '无归属用中性色')
  assert.equal(moduleColor(3, '#ff0000', PALETTE, TONE, 'gray'), '#ff0000', '改过的颜色优先')
  assert.match(moduleColor(8, undefined, PALETTE, TONE, 'gray'), /^hsl\(\d+, 50%, 40%\)$/)
  assert.match(moduleColor(9, undefined, PALETTE, TONE, 'gray'), /, 55%\)$/, '生成色明暗两档交替')
  const hues = Array.from({ length: 40 }, (_, i) => generatedHue(i + GRAPH_MODULE_COLORS))
  assert.equal(new Set(hues).size, hues.length, '40 个生成色的色相互不相同')
  for (let i = 1; i < hues.length; i++) {
    const d = Math.abs(hues[i] - hues[i - 1])
    assert.ok(Math.min(d, 360 - d) > 90, '相邻序号的色相相距很远,挨着的模块不像')
  }
  assert.equal(moduleSwatchCss(0, undefined), 'var(--graph-module-1)', '侧栏色块跟随主题')
  assert.equal(moduleSwatchCss(undefined, undefined), 'var(--graph-module-neutral)')
  assert.equal(moduleSwatchCss(2, '#123456'), '#123456')
  assert.ok(moduleSwatchCss(8, undefined).includes('var(--graph-module-gen-light-a)'))

  assert.ok(isHexColor('#a1B2c3') && !isHexColor('red') && !isHexColor('#fff') && !isHexColor(3))
  assert.deepEqual(
    sanitizeModuleColorPrefs({ r: { a: '#AABBCC', b: 'red', c: 1 }, bad: [1], empty: {} }),
    { r: { a: '#aabbcc' } },
    '存档清洗:只留合法 #rrggbb,统一小写,空项目丢掉'
  )
  assert.deepEqual(sanitizeModuleColorPrefs('x'), {})
  assert.deepEqual(sanitizeModuleColorPrefs(null), {})
  let prefs = setModuleColorIn({}, 'r', 'm:a', '#FF0000')
  assert.deepEqual(prefs, { r: { 'm:a': '#ff0000' } })
  prefs = setModuleColorIn(prefs, 'r2', 'm:a', '#00ff00')
  assert.equal(prefs.r['m:a'], '#ff0000', '每个项目分开存')
  prefs = setModuleColorIn(prefs, 'r', 'm:a', null)
  assert.equal(prefs.r, undefined, '恢复默认后项目没有改色就整项删掉')
  assert.deepEqual(setModuleColorIn({}, 'r', 'm:a', 'nope'), {}, '非法颜色当恢复默认')
  let big = {}
  for (let i = 0; i <= MAX_OVERRIDES_PER_ROOT; i++)
    big = setModuleColorIn(big, 'r', `m:${i}`, '#000000')
  const kept = Object.keys((big as Record<string, Record<string, string>>).r)
  assert.equal(kept.length, MAX_OVERRIDES_PER_ROOT, '条数有上限')
  assert.ok(!kept.includes('m:0'), '超出上限丢最早的')
}

function checkHoverModes(): void {
  const withModule = hoverModesFor('m:x')
  const without = hoverModesFor(null)
  assert.deepEqual(withModule, ['links', 'uses', 'usedBy', 'module'])
  assert.deepEqual(without, ['links', 'uses', 'usedBy'], '没有归属模块时跳过「同模块」')
  assert.equal(stepHoverMode('links', withModule, 1), 'uses')
  assert.equal(stepHoverMode('module', withModule, 1), 'links', '首尾相接')
  assert.equal(stepHoverMode('links', withModule, -1), 'module')
  assert.equal(stepHoverMode('usedBy', without, 2), 'uses')
  assert.equal(stepHoverMode('module', without, 1), 'links', '看法不在列表里时回到第一种')

  const n = (id: string): { id: string } => ({ id })
  const link = (s: string, t: string): { source: { id: string }; target: { id: string } } => ({
    source: n(s),
    target: n(t)
  })
  const nodes = ['a', 'b', 'c', 'd', 'e'].map(n)
  // a → b,c → a,d → e;a、d、e 同属模块 M
  const links = [link('a', 'b'), link('c', 'a'), link('d', 'e')]
  const inM = new Set(['a', 'd', 'e'])
  const belongs = (id: string, m: string): boolean => m === 'M' && inM.has(id)
  const rel = (mode: Parameters<typeof hoverRelated>[3]): string[] =>
    [...hoverRelated(nodes, links, 'a', mode, belongs, 'M')].sort()
  assert.deepEqual(rel('links'), ['a', 'b', 'c'], '引用关系:进出两个方向')
  assert.deepEqual(rel('uses'), ['a', 'b'], '引用了谁:只看它指出去的')
  assert.deepEqual(rel('usedBy'), ['a', 'c'], '被谁引用:只看指向它的')
  assert.deepEqual(rel('module'), ['a', 'd', 'e'], '同模块:点亮同模块全部可见节点')
  assert.ok(isHoverLink(links[2], 'a', 'module', belongs, 'M'), '同模块:两端都在模块里的边点亮')
  assert.ok(!isHoverLink(links[0], 'a', 'module', belongs, 'M'))
  assert.ok(!isHoverLink(links[1], 'a', 'uses', belongs, 'M'))
  assert.deepEqual([...hoverRelated(nodes, links, null, 'links', belongs, null)], [])
  assert.deepEqual([...hoverRelated(nodes, links, 'b', 'module', belongs, null)], ['b'])
}

function checkWheel(): void {
  const { restMs, gestureGapMs, modeStepPx, levelStepPx } = GRAPH_WHEEL
  assert.equal(wheelDeltaPx(3, 1), 48, '按行滚动换算成像素')
  assert.equal(wheelDeltaPx(-100, 0), -100)
  assert.equal(nextGesture(null, 1000, false, null).action, 'zoom', '空白处滚轮 = 缩放')
  assert.equal(nextGesture(null, 1000, false, 1000 - restMs).action, 'mode', '停稳后滚轮 = 切看法')
  assert.equal(
    nextGesture(null, 1000, false, 1000 - restMs + 50).action,
    'zoom',
    '刚划到节点上(没停稳)滚轮仍是缩放'
  )
  assert.equal(nextGesture(null, 1000, true, 0).action, 'level', 'Ctrl+滚轮 = 进出层级,压过悬停')

  const zoom = nextGesture(null, 1000, false, null)
  const later = nextGesture(zoom, 1000 + gestureGapMs - 10, false, 0)
  assert.equal(later.action, 'zoom', '缩放途中划过节点:同一手势保持缩放')
  assert.equal(
    nextGesture(later, later.lastAt + gestureGapMs + 1, false, 0).action,
    'mode',
    '停顿后算新手势'
  )

  let g = nextGesture(null, 0, false, -restMs)
  let r = takeSteps(g, modeStepPx / 2)
  assert.equal(r.steps, 0, '触控板的小幅滚动先累计')
  r = takeSteps(r.gesture, modeStepPx / 2)
  assert.equal(r.steps, 1, '累计满一格切一次')
  assert.equal(takeSteps(r.gesture, -modeStepPx * 2).steps, -2, '往上滚往回切')

  g = nextGesture(null, 0, true, null)
  r = takeSteps(g, -(levelStepPx - 1))
  assert.equal(r.steps, 0)
  r = takeSteps(r.gesture, -2)
  assert.equal(r.steps, -1, '往上滚(捏合放大)= 进入一层')
  assert.equal(takeSteps(r.gesture, -1000).steps, 0, '同一手势最多一层,不会一口气钻到底')
  assert.equal(takeSteps(nextGesture(null, 0, true, null), 500).steps, 1, '往下滚 = 返回上一层')
  assert.equal(takeSteps(zoom, 500).steps, 0, '缩放手势不走步')
}

checkColors()
checkHoverModes()
checkWheel()
console.log('selftest-graphhover: 全部通过')
