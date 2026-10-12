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
import {
  angleDeg,
  cornerLocal,
  hitTopmost,
  radiusFromLocal,
  rectFromDrag,
  resizeRect,
  snapValue,
  toLocal,
  toWorld
} from '../src/shared/uiWorkbench/geometry.ts'
import {
  applyNodeAction,
  applyRectPatch,
  cloneRect,
  createRect,
  normalizeRotation,
  uniformRadius,
  withCornerRadius,
  type RectNode
} from '../src/shared/uiWorkbench/node.ts'
import { hexToSrgb, toDtcgTokens } from '../src/shared/uiWorkbench/export/tokensDtcg.ts'
import { artboardCss, toHtml } from '../src/shared/uiWorkbench/export/cssAdapter.ts'
import { toSvg } from '../src/shared/uiWorkbench/export/svgAdapter.ts'
import {
  emptyHistory,
  HISTORY_LIMIT,
  pushHistory,
  redoHistory,
  sameNodes,
  undoHistory,
  type DocHistory,
  type Snapshot
} from '../src/shared/uiWorkbench/history.ts'
import { docActions, getDocState } from '../src/renderer/src/uiWorkbench/documentStore.ts'

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

check('拖框:普通矩形、Shift 正方形、Alt 从中心、结果取整', () => {
  assert.deepEqual(
    rectFromDrag({ x: 10, y: 10 }, { x: 50, y: 40 }, { isSquare: false, isFromCenter: false }),
    { x: 10, y: 10, width: 40, height: 30 }
  )
  assert.deepEqual(
    rectFromDrag({ x: 10, y: 10 }, { x: 50, y: 40 }, { isSquare: true, isFromCenter: false }),
    { x: 10, y: 10, width: 40, height: 40 }
  )
  assert.deepEqual(
    rectFromDrag({ x: 50, y: 50 }, { x: 60, y: 40 }, { isSquare: false, isFromCenter: true }),
    { x: 40, y: 40, width: 20, height: 20 }
  )
  const tiny = rectFromDrag(
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { isSquare: false, isFromCenter: false }
  )
  assert.equal(tiny.width, 1)
})

check('旋转矩形坐标换算:世界↔本地往返、命中测试吃旋转', () => {
  const node: RectNode = {
    id: 'rect-1',
    type: 'rect',
    name: 'r',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 90,
    radii: [0, 0, 0, 0],
    fill: '#d9d9d9'
  }
  const p = { x: 60, y: 20 }
  const roundTrip = toWorld(node, toLocal(node, p))
  assert.ok(Math.abs(roundTrip.x - p.x) < 1e-9 && Math.abs(roundTrip.y - p.y) < 1e-9)
  // 旋转 90° 后,原矩形上方远处(50,-20)落在命中区内,左下方(-50,25)在外
  assert.ok(hitTopmost([node], { x: 50, y: -20 }) === node)
  assert.ok(hitTopmost([node], { x: -50, y: 25 }) === null)
  assert.ok(Math.abs(angleDeg({ x: 0, y: 0 }, { x: 0, y: 10 }) - 90) < 1e-9)
})

check('角缩放:对角色点当锚点,旋转矩形的锚点世界坐标不动', () => {
  const box = { x: 100, y: 100, width: 40, height: 20, rotation: 0 }
  assert.deepEqual(resizeRect(box, 2, { x: 60, y: 30 }), {
    x: 100,
    y: 100,
    width: 60,
    height: 30,
    rotation: 0
  })
  // 拖左上角到本地 (10,5):右下角 (140,120) 锚定不动,框缩到 (110,105) 起
  assert.deepEqual(resizeRect(box, 0, { x: 10, y: 5 }), {
    x: 110,
    y: 105,
    width: 30,
    height: 15,
    rotation: 0
  })
  // Shift 等比:取宽/高各自的缩放倍率中较大的那个,按原始宽高比统一缩放(2:1)
  assert.deepEqual(resizeRect(box, 2, { x: 60, y: 50 }, true), {
    x: 100,
    y: 100,
    width: 100,
    height: 50,
    rotation: 0
  })
  // 旋转矩形:锚点(左上角)世界坐标不变
  const rot = { x: 0, y: 0, width: 100, height: 50, rotation: 90 }
  const before = toWorld(rot, cornerLocal(rot, 0))
  const resized = resizeRect(rot, 2, { x: 120, y: 70 })
  const after = toWorld(resized, cornerLocal(resized, 0))
  assert.ok(Math.abs(before.x - after.x) <= 1 && Math.abs(before.y - after.y) <= 1)
  assert.equal(resized.width, 120)
  assert.equal(resized.height, 70)
})

check('圆角手势:投影换算钳到短边一半,节点落地规则收口', () => {
  const box = { x: 0, y: 0, width: 100, height: 40, rotation: 0 }
  // 左上角向内拖:沿对角线投影即半径
  assert.equal(radiusFromLocal(box, 0, { x: 20, y: 20 }), 20)
  assert.equal(radiusFromLocal(box, 0, { x: 200, y: 200 }), 20) // 上限 = 短边一半
  assert.equal(radiusFromLocal(box, 2, { x: 60, y: 0 }), 20)
  const node = createRect([], { x: 0, y: 0, width: 100, height: 40 })
  assert.equal(node.id, 'rect-1')
  assert.equal(node.name, '矩形 1')
  // Shift 吸附:半径取到最近的 4 的倍数
  assert.equal(snapValue(14, 4), 16)
  assert.equal(snapValue(13, 4), 12)
  assert.equal(snapValue(2, 4), 4)
  assert.equal(snapValue(0, 4), 0)
  const patched = applyRectPatch(node, {
    width: 30,
    radii: withCornerRadius(node.radii, 'all', 30)
  })
  assert.deepEqual([...patched.radii], [15, 15, 15, 15])
  assert.equal(uniformRadius(patched.radii), 15)
  assert.equal(normalizeRotation(-30), 330)
})

check('节点命令:add/update/remove,删除后序号不复用', () => {
  const a = createRect([], { x: 0, y: 0, width: 10, height: 10 })
  let nodes = applyNodeAction([a], {
    type: 'add',
    node: createRect([a], { x: 5, y: 5, width: 10, height: 10 })
  })
  assert.equal(nodes.length, 2)
  nodes = applyNodeAction(nodes, { type: 'update', id: 'rect-1', patch: { rotation: 450 } })
  assert.equal(nodes[0].rotation, 90)
  nodes = applyNodeAction(nodes, { type: 'remove', id: 'rect-1' })
  assert.equal(createRect(nodes, { x: 0, y: 0, width: 1, height: 1 }).id, 'rect-3')
})

check('tokens.json(DTCG):画板与节点数值、结构信息进 $extensions', () => {
  const node = createRect([], { x: 10, y: 20, width: 100, height: 40 })
  const doc = {
    artboard: { width: 390, height: 844 },
    nodes: [{ ...node, rotation: 45, radii: [8, 8, 0, 0] }]
  }
  interface TokenEntry {
    $type?: string
    $value?: unknown
    $extensions?: Record<string, { order: number }>
    [key: string]: unknown
  }
  const tokens = toDtcgTokens(doc) as { artboard: TokenEntry; nodes: Record<string, TokenEntry> }
  assert.deepEqual(tokens.artboard.width, {
    $type: 'dimension',
    $value: { value: 390, unit: 'px' }
  })
  const r1 = tokens.nodes['rect-1']
  const entry = (k: string): TokenEntry => r1[k] as TokenEntry
  assert.deepEqual(entry('x').$value, { value: 10, unit: 'px' })
  assert.equal(entry('rotation').$type, 'number')
  assert.equal(entry('rotation').$value, 45)
  const radius = r1.radius as Record<string, TokenEntry>
  assert.deepEqual(radius['bottom-right'].$value, { value: 0, unit: 'px' })
  const fill = entry('fill').$value as { colorSpace: string; hex: string }
  assert.equal(fill.colorSpace, 'srgb')
  assert.equal(fill.hex, '#d9d9d9')
  assert.equal(r1.$extensions?.['app.codeatlas.ui-workbench'].order, 0)
  assert.deepEqual(hexToSrgb('#ff0000'), [1, 0, 0])
})

check('CSS 适配器:四角同值写单值,分设写四值,旋转写 transform', () => {
  const a = {
    ...createRect([], { x: 0, y: 0, width: 10, height: 10 }),
    radii: [8, 8, 8, 8]
  } as RectNode
  const b = {
    ...createRect([a], { x: 0, y: 0, width: 10, height: 10 }),
    radii: [1, 2, 3, 4],
    rotation: 30
  } as RectNode
  const css = artboardCss({ artboard: { width: 100, height: 100 }, nodes: [a, b] })
  assert.ok(css.includes('border-radius: 8px;'))
  assert.ok(css.includes('border-radius: 1px 2px 3px 4px;'))
  assert.ok(css.includes('transform: rotate(30deg);'))
  assert.ok(
    toHtml({ artboard: { width: 390, height: 844 }, nodes: [a] }).includes('<div class="rect-1">')
  )
})

check('SVG 适配器:四角同值用 rect rx,分设用路径,旋转带圆心', () => {
  const a = {
    ...createRect([], { x: 0, y: 0, width: 10, height: 10 }),
    radii: [4, 4, 4, 4]
  } as RectNode
  const b = {
    ...createRect([a], { x: 5, y: 5, width: 20, height: 10 }),
    radii: [1, 2, 3, 4],
    rotation: 90
  } as RectNode
  const svg = toSvg({ artboard: { width: 390, height: 844 }, nodes: [a, b] })
  assert.ok(svg.includes('<rect id="rect-1"') && svg.includes('rx="4"'))
  assert.ok(svg.includes('<path id="rect-2"'))
  assert.ok(svg.includes('rotate(90 15 10)'))
  assert.ok(svg.startsWith('<svg') && svg.includes('viewBox="0 0 390 844"'))
})

// ── 撤销/重做历史(history.ts + documentStore) ──

check('历史栈上限:连推超过 100 步,past 恒为 100,丢的是最老的', () => {
  const snap = (x: number): Snapshot => ({
    nodes: [{ ...createRect([], { x, y: 0, width: 10, height: 10 }), x } as RectNode],
    selectedId: null
  })
  const first = snap(0)
  let h: DocHistory = pushHistory(emptyHistory(), first)
  for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, snap(i))
  assert.equal(h.past.length, HISTORY_LIMIT)
  assert.notEqual(h.past[0], first, '最早一张应已被挤出')
})

check('undo 后 redo 回原状态;undo 后新 push 清空 future;空栈返回 null', () => {
  const s0: Snapshot = { nodes: [], selectedId: null }
  const n1 = createRect([], { x: 0, y: 0, width: 10, height: 10 })
  const s1: Snapshot = { nodes: [n1], selectedId: n1.id }
  let h = pushHistory(emptyHistory(), s0)
  const u = undoHistory(h, s1)
  assert.ok(u)
  assert.equal(u.restore.nodes.length, 0)
  h = u.history
  const r = redoHistory(h, s0)
  assert.ok(r)
  assert.deepEqual(r.restore.nodes, s1.nodes)
  // undo 之后产生新动作:redo 分支作废
  h = pushHistory(u.history, s0)
  assert.equal(h.future.length, 0)
  assert.equal(redoHistory(h, s0), null)
  assert.equal(undoHistory(emptyHistory(), s0), null)
})

check('sameNodes:值同则同,radii 差一角、长度不同都算异', () => {
  const a = createRect([], { x: 1, y: 2, width: 30, height: 40 })
  const copy = { ...a, radii: [...a.radii] } as RectNode
  assert.ok(sameNodes([a], [copy]))
  assert.ok(!sameNodes([a], [{ ...a, radii: [9, 0, 0, 0] } as RectNode]))
  assert.ok(!sameNodes([a], [a, a]))
})

check('批次语义:手势多帧只记一步;改回原值零入账;嵌套批次最外层结算', () => {
  const doc = docActions
  // 此时文档为空、历史为空(用例顺序保证);先立一个基准节点
  const base = createRect([], { x: 0, y: 0, width: 10, height: 10 })
  doc.dispatch({ type: 'add', node: base })
  assert.equal(getDocState().canUndo, true)
  doc.undo()
  assert.equal(getDocState().nodes.length, 0)
  assert.equal(getDocState().canUndo, false)
  doc.redo()
  assert.equal(getDocState().nodes.length, 1)

  // begin → 多次 update → end:只多一步
  doc.beginBatch()
  doc.dispatch({ type: 'update', id: base.id, patch: { x: 10 } })
  doc.dispatch({ type: 'update', id: base.id, patch: { x: 20, y: 30 } })
  doc.endBatch()
  doc.undo()
  assert.equal(getDocState().nodes[0].x, 0)
  doc.redo()
  assert.equal(getDocState().nodes[0].x, 20)

  // begin → 改出去又改回来 → end:零入账
  doc.beginBatch()
  doc.dispatch({ type: 'update', id: base.id, patch: { x: 55 } })
  doc.dispatch({ type: 'update', id: base.id, patch: { x: 20 } })
  doc.endBatch()
  assert.equal(getDocState().canRedo, false)

  // 嵌套:内层 end 不结算,外层 end 才入账
  doc.beginBatch()
  doc.dispatch({ type: 'update', id: base.id, patch: { x: 99 } })
  doc.beginBatch()
  doc.dispatch({ type: 'update', id: base.id, patch: { x: 88 } })
  doc.endBatch()
  doc.undo() // 批次未结算,undo 应为 no-op
  assert.equal(getDocState().nodes[0].x, 88)
  doc.endBatch()
  doc.undo()
  assert.equal(getDocState().nodes[0].x, 20)

  // 批次外的单次 dispatch:一次一步
  doc.dispatch({ type: 'update', id: base.id, patch: { x: 7 } })
  doc.dispatch({ type: 'update', id: base.id, patch: { x: 8 } })
  doc.undo()
  assert.equal(getDocState().nodes[0].x, 7)
  doc.undo()
  assert.equal(getDocState().nodes[0].x, 20)
})

check('撤销联动选中:撤销「添加」selectedId 归 null;撤销「删除」节点回来且重新选中', () => {
  const doc = docActions
  const rect = createRect(getDocState().nodes, { x: 0, y: 0, width: 10, height: 10 })
  doc.dispatch({ type: 'add', node: rect })
  doc.select(rect.id)
  doc.undo()
  assert.equal(
    getDocState().nodes.some((n) => n.id === rect.id),
    false
  )
  assert.equal(getDocState().selectedId, null)
  doc.redo()
  doc.select(rect.id)
  doc.dispatch({ type: 'remove', id: rect.id })
  assert.equal(getDocState().selectedId, null)
  doc.undo()
  assert.equal(
    getDocState().nodes.some((n) => n.id === rect.id),
    true
  )
  assert.equal(getDocState().selectedId, rect.id)
  // 善后:撤掉这张测试矩形,不留账给后面的用例
  doc.dispatch({ type: 'remove', id: rect.id })
  doc.select(null)
})

check('批次异常路径:begin 后中途抛异常、finally 里 end,计数归零入账恢复', () => {
  const doc = docActions
  // 模拟手势中途炸掉:begin → dispatch → 抛异常 → catch/finally 里 endBatch
  doc.beginBatch()
  try {
    doc.dispatch({ type: 'update', id: 'rect-0', patch: { x: 1 } })
    throw new Error('gesture exploded')
  } catch {
    doc.endBatch()
  }
  // 批次必须归零:之后的单次 dispatch 立即入账,undo/redo 不再被挂起批次卡住
  const r = createRect(getDocState().nodes, { x: 0, y: 0, width: 10, height: 10 })
  doc.dispatch({ type: 'add', node: r })
  doc.undo()
  assert.equal(
    getDocState().nodes.some((n) => n.id === r.id),
    false,
    '异常批次结清后 undo 可用'
  )
  doc.redo()
  assert.equal(
    getDocState().nodes.some((n) => n.id === r.id),
    true,
    'redo 同样恢复'
  )
  doc.dispatch({ type: 'remove', id: r.id })
})

check('cloneRect:序号取现有最大 + 1,偏移落位,源对象不动', () => {
  const a = {
    ...createRect([], { x: 10, y: 20, width: 30, height: 40 }),
    radii: [4, 4, 4, 4]
  } as RectNode
  const b = createRect([a], { x: 0, y: 0, width: 10, height: 10 })
  // 序号断层(rect-1、rect-5):新号取 max+1,不撞已有 id
  const gapped = { ...b, id: 'rect-5', name: '矩形 5' } as RectNode
  const nodes = [a, gapped]
  const clone = cloneRect(a, nodes, { x: 10, y: 10 })
  assert.equal(clone.id, 'rect-6')
  assert.equal(clone.name, '矩形 6')
  assert.equal(clone.x, a.x + 10)
  assert.equal(clone.y, a.y + 10)
  assert.deepEqual(clone.radii, a.radii)
  assert.ok(clone.radii !== a.radii, 'radii 是独立拷贝')
  assert.equal(
    nodes.some((n) => n.id === clone.id),
    false
  )
  assert.equal(a.x, 10, '源节点不被修改')
})

console.log('UI 工作台纯逻辑自测全部通过')
