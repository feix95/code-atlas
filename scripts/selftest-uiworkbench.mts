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
  radiusFromLocal,
  rectFromDrag,
  rectOverlapsBox,
  resizeRect,
  resizeRectEdge,
  snapValue,
  toLocal,
  toWorld
} from '../src/shared/uiWorkbench/geometry.ts'
import {
  applyRectPatch,
  cloneRect,
  createRect,
  normalizeRotation,
  RECT_STROKE_WIDTH_MAX,
  uniformRadius,
  withCornerRadius,
  type RectNode
} from '../src/shared/uiWorkbench/node.ts'
import { snapMove, snapTargets, type SnapBox } from '../src/shared/uiWorkbench/snap.ts'
import { gapMarks, neighborGaps, snapSpacing } from '../src/shared/uiWorkbench/spacing.ts'
import {
  SCALE_HANDLES,
  scaleBoxByHandle,
  scaleNodePatch,
  type ScaleHandle
} from '../src/shared/uiWorkbench/groupScale.ts'
import {
  applyLinePatch,
  cloneLine,
  createLine,
  hitLine,
  lineAngle,
  lineEndpointPatch,
  lineFromDrag,
  lineLength,
  lineOverlapsBox,
  lineWithAngle,
  lineWithLength,
  type LineNode
} from '../src/shared/uiWorkbench/line.ts'
import {
  applyNodeAction,
  cloneNode,
  hitTopmost,
  nodeBox,
  nodeOverlapsBox,
  snapshotNode,
  translatePatch,
  unionBox
} from '../src/shared/uiWorkbench/scene.ts'
import { SCRUB_PX_PER_STEP, scrubStep } from '../src/shared/uiWorkbench/scrub.ts'
import {
  lineAppearanceOf,
  linkedLineStyleId,
  resolveLinkedLineLook,
  sanitizeLineStyles,
  type LineStyle
} from '../src/shared/uiWorkbench/lineStyles.ts'
import {
  buildGroup,
  describeGroup,
  groupSize,
  instantiateGroup,
  sanitizeGroups
} from '../src/shared/uiWorkbench/groups.ts'
import {
  appearanceOf,
  normalizeStyleName,
  removeStylePreset,
  resolveLinkedLook,
  sameAppearance,
  sanitizeStylePresets,
  saveStylePreset,
  type RectStyle
} from '../src/shared/uiWorkbench/styles.ts'
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
import { createPage } from '../src/shared/uiWorkbench/page.ts'
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
    visible: true,
    locked: false,
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
  assert.ok(hitTopmost([node], { x: 50, y: -20 }, 0) === node)
  assert.ok(hitTopmost([node], { x: -50, y: 25 }, 0) === null)
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

check('边缩放:只动被拖那条边,对边钉死;Shift 吸网格', () => {
  const box = { x: 100, y: 100, width: 40, height: 20, rotation: 0 }
  // 拖右边中点到本地 x=60:只有宽变,x/y/高原样
  assert.deepEqual(resizeRectEdge(box, 'right', { x: 60, y: 10 }), {
    x: 100,
    y: 100,
    width: 60,
    height: 20,
    rotation: 0
  })
  // 拖左边到本地 x=10:右缘 140 钉死,宽缩成 30,x 挪到 110
  assert.deepEqual(resizeRectEdge(box, 'left', { x: 10, y: 99 }), {
    x: 110,
    y: 100,
    width: 30,
    height: 20,
    rotation: 0
  })
  // 拖上边到本地 y=5:下缘 120 钉死,高 15,y 挪到 105;指针横向乱晃(99)不影响
  assert.deepEqual(resizeRectEdge(box, 'top', { x: 99, y: 5 }), {
    x: 100,
    y: 105,
    width: 40,
    height: 15,
    rotation: 0
  })
  // Shift = 边长吸 4 网格:拖到 63 → 64
  assert.equal(resizeRectEdge(box, 'right', { x: 63, y: 0 }, 4).width, 64)
  // 旋转矩形:左边拖动只对宽,左边中点的对边(右边中点)世界坐标不动
  const rot = { x: 0, y: 0, width: 100, height: 50, rotation: 90 }
  const anchorBefore = toWorld(rot, { x: rot.width, y: rot.height / 2 })
  const next = resizeRectEdge(rot, 'left', { x: -20, y: 25 })
  const anchorAfter = toWorld(next, { x: next.width, y: next.height / 2 })
  assert.ok(Math.abs(anchorBefore.x - anchorAfter.x) <= 1)
  assert.ok(Math.abs(anchorBefore.y - anchorAfter.y) <= 1)
  assert.equal(next.width, 120)
  assert.equal(next.height, 50)
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

check('createRect 带默认外观:填充/描边/样式落地,起手 1×1 圆角被钳 0,拖大后补丁带回圆角', () => {
  const look = {
    fill: '#112233',
    stroke: { color: '#ffffff', width: 2, style: 'dashed' as const },
    radii: [12, 12, 12, 12] as const,
    styleId: 's1'
  }
  const seed = createRect([], { x: 0, y: 0, width: 1, height: 1 }, look)
  assert.equal(seed.fill, '#112233')
  assert.deepEqual(seed.stroke, look.stroke)
  assert.equal(seed.styleId, 's1')
  assert.deepEqual([...seed.radii], [0, 0, 0, 0])
  const grown = applyRectPatch(seed, {
    width: 80,
    height: 60,
    radii: look.radii,
    styleId: look.styleId
  })
  assert.deepEqual([...grown.radii], [12, 12, 12, 12])
  assert.equal(grown.styleId, 's1')
  assert.equal(createRect([], { x: 0, y: 0, width: 5, height: 5 }).fill, '#d9d9d9')
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
  assert.ok(svg.includes('id="rect-1"') && svg.includes('rx="4"'))
  assert.ok(svg.includes('<path') && svg.includes('id="rect-2"'))
  assert.ok(svg.includes('rotate(90 15 10)'))
  assert.ok(svg.startsWith('<svg') && svg.includes('viewBox="0 0 390 844"'))
})

check('外观补丁:颜色归一化小写、非法回退原值、描边宽钳范围', () => {
  const a = createRect([], { x: 0, y: 0, width: 10, height: 10 })
  assert.equal(applyRectPatch(a, { fill: '#FF8800' }).fill, '#ff8800')
  assert.equal(applyRectPatch(a, { fill: 'f80' }).fill, '#ff8800')
  assert.equal(applyRectPatch(a, { fill: null }).fill, null)
  assert.equal(applyRectPatch(a, { fill: 'notacolor' }).fill, '#d9d9d9')
  const stroked = applyRectPatch(a, {
    stroke: { color: '#ABCDEF', width: 2.6, style: 'solid' }
  })
  assert.deepEqual(stroked.stroke, { color: '#abcdef', width: 3, style: 'solid' })
  const clamped = applyRectPatch(stroked, {
    stroke: { color: '#abcdef', width: 999, style: 'solid' }
  })
  assert.equal(clamped.stroke?.width, RECT_STROKE_WIDTH_MAX)
  assert.deepEqual(
    applyRectPatch(stroked, {
      stroke: { color: 'notacolor', width: 4, style: 'solid' }
    }).stroke,
    stroked.stroke
  )
  assert.equal(applyRectPatch(stroked, { stroke: null }).stroke, null)
})

check('外观适配:不填/不勾时三端都缺省;描边按「内描边」口径进三端', () => {
  const styled = applyRectPatch(createRect([], { x: 0, y: 0, width: 10, height: 10 }), {
    fill: null,
    stroke: { color: '#112233', width: 2, style: 'dashed' }
  })
  const doc = { artboard: { width: 100, height: 100 }, nodes: [styled] }
  // CSS:fill=null 不写 background;描边写 border,box-sizing 保证外接框不变
  const css = artboardCss(doc)
  const nodeRule = css.match(/\.rect-1 \{[^}]+\}/)?.[0] ?? ''
  assert.ok(!nodeRule.includes('background'))
  assert.ok(nodeRule.includes('box-sizing: border-box;'))
  assert.ok(nodeRule.includes('border: 2px dashed #112233;'))
  // SVG:不填充写 fill="none";内描边 = 2 倍宽 + clipPath 裁内半;虚线给 dasharray
  const svg = toSvg(doc)
  assert.ok(svg.includes('id="rect-1"') && svg.includes('fill="none"'))
  assert.ok(svg.includes('clip-path="url(#clip-rect-1)"'))
  assert.ok(svg.includes('stroke-width="4"'))
  assert.ok(svg.includes('stroke-dasharray="6 4"'))
  // tokens:fill 缺省,stroke 进 DTCG border 复合类型
  const tokens = toDtcgTokens(doc) as {
    nodes: Record<string, Record<string, { $type?: string; $value?: unknown } | undefined>>
  }
  const r1 = tokens.nodes['rect-1']
  assert.equal(r1.fill, undefined)
  const stroke = r1.stroke
  assert.equal(stroke?.$type, 'border')
  assert.deepEqual(stroke?.$value, {
    color: { colorSpace: 'srgb', components: hexToSrgb('#112233'), alpha: 1, hex: '#112233' },
    width: { value: 2, unit: 'px' },
    style: 'dashed'
  })
})

// ── 对齐吸附(snap.ts) ──

check('snapMove:阈值内吸最近锚点(边/中线),阈值外不动,两轴独立', () => {
  const target = { x: 100, y: 0, width: 40, height: 40 }
  // 左缘差 3 在阈值 5 内 → 吸到 100;引导线位置 = 目标锚点,纵跨取两矩形并集
  let s = snapMove({ x: 103, y: 200, width: 20, height: 20 }, [target], 5)
  assert.equal(s.x, 100)
  assert.equal(s.guides.v?.x, 100)
  assert.equal(s.guides.v?.y1, 0)
  assert.equal(s.guides.v?.y2, 220)
  // 所有锚点都在阈值外 → 不吸,无引导线
  s = snapMove({ x: 146, y: 200, width: 20, height: 20 }, [target], 5)
  assert.equal(s.x, 146)
  assert.equal(s.guides.v, null)
  // 中线对中线:被拖中心 x+10 对目标中心 120,差 3 → 吸成 110,引导线在 120
  s = snapMove({ x: 107, y: 200, width: 20, height: 20 }, [target], 5)
  assert.equal(s.x, 110)
  assert.equal(s.guides.v?.x, 120)
  // 右缘对左缘(贴边摆放):x+20 对 100,差 -2 → 吸成 80
  s = snapMove({ x: 82, y: 200, width: 20, height: 20 }, [target], 5)
  assert.equal(s.x, 80)
  // 两轴同时命中:左缘 100 + 上缘 0
  s = snapMove({ x: 103, y: 3, width: 20, height: 20 }, [target], 5)
  assert.equal(s.x, 100)
  assert.equal(s.y, 0)
  assert.ok(s.guides.v !== null && s.guides.h !== null)
  // 多目标取最近:左缘对 100(差 -3)、右缘对 t2 右缘 200(差 +1),取差 1 → 吸成 104
  const t2 = { x: 160, y: 0, width: 40, height: 40 }
  s = snapMove({ x: 103, y: 500, width: 96, height: 20 }, [target, t2], 5)
  assert.equal(s.x, 104)
  assert.equal(s.guides.v?.x, 200)
})

check('snapTargets:排除自身,只剩其余节点的包围盒', () => {
  const a = createRect([], { x: 0, y: 0, width: 10, height: 10 })
  const b = createRect([a], { x: 50, y: 0, width: 10, height: 10 })
  assert.deepEqual(snapTargets([a, b], a.id), [{ x: 50, y: 0, width: 10, height: 10 }])
  // 整组移动:传 id 数组,把整组都排除
  const c = createRect([a, b], { x: 90, y: 0, width: 10, height: 10 })
  assert.deepEqual(snapTargets([a, b, c], [a.id, b.id]), [{ x: 90, y: 0, width: 10, height: 10 }])
})

// ── 框选命中(rectOverlapsBox)──

check('框选相交判定:扫到任意部分即中,全包/擦边都算,完全在外不算', () => {
  const node = { x: 100, y: 100, width: 40, height: 40, rotation: 0 }
  // 部分相交(只扫到右下角)
  assert.ok(rectOverlapsBox(node, { x: 0, y: 0, width: 110, height: 110 }))
  // 全包
  assert.ok(rectOverlapsBox(node, { x: 0, y: 0, width: 300, height: 300 }))
  // 擦一条边:框右缘正好压在矩形左缘上
  assert.ok(rectOverlapsBox(node, { x: 0, y: 0, width: 100, height: 200 }))
  // 完全在外
  assert.ok(!rectOverlapsBox(node, { x: 0, y: 0, width: 50, height: 50 }))
  assert.ok(!rectOverlapsBox(node, { x: 200, y: 100, width: 40, height: 40 }))
})

check('框选旋转矩形:按真实旋转轮廓判定,不拿声明外接框糊弄', () => {
  // 100×20 转 90° 绕中心 (60,10):实际占地是 x 50~70、y -40~60 的竖条
  const node = { x: 10, y: 0, width: 100, height: 20, rotation: 90 }
  // 框扫到竖条中部(60,50)附近 → 中
  assert.ok(rectOverlapsBox(node, { x: 55, y: 40, width: 10, height: 10 }))
  // 框在声明外接框右上角(x 60~100、y -30~-5):未旋转轮廓会误判相交,旋转后实际无占地 → 不中
  assert.ok(!rectOverlapsBox(node, { x: 75, y: -25, width: 20, height: 15 }))
})

// ── 撤销/重做历史(history.ts + documentStore) ──

check('标签拖拽步长:右增左减,不足一步累积不丢,Shift 十倍', () => {
  assert.deepEqual(scrubStep(0, SCRUB_PX_PER_STEP * 3, false), { delta: 3, rest: 0 })
  assert.deepEqual(scrubStep(0, -SCRUB_PX_PER_STEP * 2, false), { delta: -2, rest: 0 })
  const half = scrubStep(0, SCRUB_PX_PER_STEP / 2, false)
  assert.equal(half.delta, 0)
  assert.equal(scrubStep(half.rest, SCRUB_PX_PER_STEP / 2, false).delta, 1)
  assert.equal(scrubStep(0, SCRUB_PX_PER_STEP, true).delta, 10)
  assert.equal(scrubStep(0, 0, false).delta, 0)
})

check('历史栈上限:连推超过 100 步,past 恒为 100,丢的是最老的', () => {
  const snap = (x: number): Snapshot => ({
    pages: [
      { ...createPage([]), nodes: [{ ...createRect([], { x, y: 0, width: 10, height: 10 }), x }] }
    ],
    activePageId: 'page-1',
    selectedIds: []
  })
  const first = snap(0)
  let h: DocHistory = pushHistory(emptyHistory(), first)
  for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, snap(i))
  assert.equal(h.past.length, HISTORY_LIMIT)
  assert.notEqual(h.past[0], first, '最早一张应已被挤出')
})

check('undo 后 redo 回原状态;undo 后新 push 清空 future;空栈返回 null', () => {
  const page = createPage([])
  const s0: Snapshot = { pages: [page], activePageId: page.id, selectedIds: [] }
  const n1 = createRect([], { x: 0, y: 0, width: 10, height: 10 })
  const s1: Snapshot = {
    pages: [{ ...page, nodes: [n1] }],
    activePageId: page.id,
    selectedIds: [n1.id]
  }
  let h = pushHistory(emptyHistory(), s0)
  const u = undoHistory(h, s1)
  assert.ok(u)
  assert.equal(u.restore.pages[0].nodes.length, 0)
  h = u.history
  const r = redoHistory(h, s0)
  assert.ok(r)
  assert.deepEqual(r.restore.pages[0].nodes, s1.pages[0].nodes)
  // undo 之后产生新动作:redo 分支作废
  h = pushHistory(u.history, s0)
  assert.equal(h.future.length, 0)
  assert.equal(redoHistory(h, s0), null)
  assert.equal(undoHistory(emptyHistory(), s0), null)
})

check('sameNodes:值同则同,radii 差一角、长度不同、stroke 差一项都算异', () => {
  const a = createRect([], { x: 1, y: 2, width: 30, height: 40 })
  const copy = { ...a, radii: [...a.radii] } as RectNode
  assert.ok(sameNodes([a], [copy]))
  assert.ok(!sameNodes([a], [{ ...a, radii: [9, 0, 0, 0] } as RectNode]))
  assert.ok(!sameNodes([a], [a, a]))
  // 历史判等必须覆盖 stroke:漏比会让描边类 dispatch 被当 no-op 跳过入账
  const stroked = { ...a, stroke: { color: '#000000', width: 1, style: 'solid' as const } }
  assert.ok(!sameNodes([a], [stroked]))
  assert.ok(!sameNodes([stroked], [{ ...stroked, stroke: { ...stroked.stroke, width: 2 } }]))
  assert.ok(sameNodes([stroked], [{ ...stroked, stroke: { ...stroked.stroke } }]))
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

// ── 外观样式(styles.ts + styleId 活链接)──

check('样式名规范:去空白截断,留空回落「样式 N」', () => {
  assert.equal(normalizeStyleName('  主按钮 ', 1), '主按钮')
  assert.equal(normalizeStyleName('   ', 3), '样式 3')
  assert.equal(normalizeStyleName('x'.repeat(40), 1).length, 32)
})

check('样式仓库:存取/同名覆盖沿用原 id/删除;坏档反序列化逐条丢弃', () => {
  const app = {
    fill: '#ff0000',
    stroke: { color: '#00ff00', width: 2, style: 'dashed' as const },
    radii: [2, 4, 6, 8] as [number, number, number, number]
  }
  const fresh = saveStylePreset([], { id: 's1', name: 'A', ...app })
  assert.equal(fresh.overwrote, false)
  // 同名覆盖:定义换成新值,但沿用原 id——挂着的节点靠 id 认,改名才断链
  const over = saveStylePreset(fresh.list, { id: 's9', name: 'A', ...app, fill: '#0000ff' })
  assert.equal(over.overwrote, true)
  assert.equal(over.id, 's1')
  assert.equal(over.list[0].fill, '#0000ff')
  assert.deepEqual(removeStylePreset(over.list, 's1'), [])
  // 坏字段:空 id、非法色、非法描边、圆角不足四角 —— 逐条丢,好的留下
  const cleaned = sanitizeStylePresets([
    { id: 'ok', name: '好', fill: '#112233', stroke: null, radii: [0, 0, 0, 0] },
    { id: '', name: 'x', fill: '#112233', stroke: null, radii: [0, 0, 0, 0] },
    { id: 'bad', name: '坏', fill: 'red', stroke: null, radii: [0, 0, 0, 0] },
    {
      id: 'bad2',
      name: '坏2',
      fill: '#112233',
      stroke: { color: 'zz', width: 1, style: 'solid' },
      radii: [0, 0, 0, 0]
    },
    { id: 'bad3', name: '坏3', fill: '#112233', stroke: null, radii: [0, 0] },
    'garbage'
  ])
  assert.deepEqual(
    cleaned.map((s) => s.id),
    ['ok']
  )
})

check('样式链接:applyRectPatch 脱钩规则——改外观静默脱,改几何不脱,补丁带 styleId 不脱', () => {
  const linked = applyRectPatch(createRect([], { x: 0, y: 0, width: 10, height: 10 }), {
    fill: '#123456',
    styleId: 's1'
  })
  assert.equal(linked.styleId, 's1')
  // 手动改外观三件套任一 → 静默脱钩(Figma 式)
  assert.equal(applyRectPatch(linked, { fill: '#ffffff' }).styleId, null)
  assert.equal(applyRectPatch(linked, { stroke: null }).styleId, null)
  assert.equal(applyRectPatch(linked, { radii: [0, 0, 0, 0] }).styleId, null)
  // 纯几何改动不碰链接
  assert.equal(applyRectPatch(linked, { x: 5, width: 20, rotation: 45 }).styleId, 's1')
  // 应用样式的补丁(外观 + styleId 同包)不误脱;显式 null 脱钩
  assert.equal(applyRectPatch(linked, { fill: '#ffffff', styleId: 's2' }).styleId, 's2')
  assert.equal(applyRectPatch(linked, { styleId: null }).styleId, null)
})

check('外观提取/比对:appearanceOf 拷贝三件套,sameAppearance 值比较', () => {
  const node = applyRectPatch(createRect([], { x: 0, y: 0, width: 10, height: 10 }), {
    fill: '#22aaee',
    stroke: { color: '#000000', width: 2, style: 'solid' },
    radii: [4, 4, 4, 4]
  })
  const app = appearanceOf(node)
  assert.ok(sameAppearance(app, { ...app, stroke: { ...app.stroke! } }))
  assert.ok(!sameAppearance(app, { ...app, fill: null }))
  assert.ok(!sameAppearance(app, { ...app, radii: [0, 0, 0, 0] }))
  // radii 是独立拷贝:改返回的不动节点
  app.radii[0] = 99
  assert.equal(node.radii[0], 4)
})

check('样式入账:应用/手动脱钩/覆盖回写各一笔;脱钩可撤回到链接态', () => {
  const doc = docActions
  const a = createRect(getDocState().nodes, { x: 0, y: 0, width: 10, height: 10 })
  const b = createRect([...getDocState().nodes, a], { x: 50, y: 0, width: 10, height: 10 })
  doc.beginBatch()
  doc.dispatch({ type: 'add', node: a })
  doc.dispatch({ type: 'add', node: b })
  doc.endBatch()
  const byId = (id: string): RectNode | undefined => getDocState().nodes.find((n) => n.id === id)
  // 应用样式:外观 + styleId 同包,一笔
  doc.dispatch({
    type: 'update',
    id: a.id,
    patch: { fill: '#123456', radii: [8, 8, 8, 8], styleId: 's1' }
  })
  doc.dispatch({
    type: 'update',
    id: b.id,
    patch: { fill: '#123456', radii: [8, 8, 8, 8], styleId: 's1' }
  })
  assert.equal(byId(a.id)?.styleId, 's1')
  // 手动改 a 的填充 → 脱钩,一笔入账;撤回即回到链接态
  doc.dispatch({ type: 'update', id: a.id, patch: { fill: '#ff0000' } })
  assert.equal(byId(a.id)?.styleId, null)
  doc.undo()
  assert.equal(byId(a.id)?.styleId, 's1')
  assert.equal(byId(a.id)?.fill, '#123456')
  // 模拟「同名覆盖保存」:批次回写所有挂接节点 → 一笔撤销整体回
  doc.beginBatch()
  for (const n of getDocState().nodes) {
    if (n.styleId === 's1')
      doc.dispatch({ type: 'update', id: n.id, patch: { fill: '#000000', styleId: 's1' } })
  }
  doc.endBatch()
  assert.ok(
    getDocState()
      .nodes.filter((n) => n.styleId === 's1')
      .every((n) => n.fill === '#000000')
  )
  doc.undo()
  assert.ok(
    getDocState()
      .nodes.filter((n) => n.styleId === 's1')
      .every((n) => n.fill === '#123456')
  )
  // 模拟「删除样式」:批次清 styleId,节点保留现值
  doc.beginBatch()
  for (const n of getDocState().nodes) {
    if (n.styleId === 's1') doc.dispatch({ type: 'update', id: n.id, patch: { styleId: null } })
  }
  doc.endBatch()
  assert.ok(getDocState().nodes.every((n) => n.styleId === null))
  assert.equal(byId(a.id)?.fill, '#123456')
  // 善后:清场不留账
  doc.beginBatch()
  doc.dispatch({ type: 'remove', id: a.id })
  doc.dispatch({ type: 'remove', id: b.id })
  doc.endBatch()
})

check('tokens.json 带样式:styles 组发定义,节点 $extensions.style 记引用', () => {
  const style: RectStyle = {
    id: 's1',
    name: '主按钮',
    fill: '#22aaee',
    stroke: { color: '#000000', width: 2, style: 'solid' },
    radii: [8, 8, 8, 8]
  }
  const linked = applyRectPatch(createRect([], { x: 0, y: 0, width: 10, height: 10 }), {
    fill: '#22aaee',
    stroke: { color: '#000000', width: 2, style: 'solid' },
    radii: [8, 8, 8, 8],
    styleId: 's1'
  })
  const free = createRect([linked], { x: 50, y: 0, width: 10, height: 10 })
  const tokens = toDtcgTokens({
    artboard: { width: 390, height: 844 },
    nodes: [linked, free],
    styles: [style]
  }) as {
    styles: Record<string, Record<string, unknown>>
    nodes: Record<string, { $extensions: Record<string, Record<string, unknown>> }>
  }
  // 定义组:按 id 为键,名字与数值都在
  const def = tokens.styles['s1']
  assert.ok(def)
  assert.match(def.$description as string, /主按钮/)
  const radius = def.radius as Record<string, { $value: { value: number } }>
  assert.equal(radius['top-left'].$value.value, 8)
  // 引用:挂接节点记 style id,自由节点不记
  const ext = tokens.nodes[linked.id].$extensions['app.codeatlas.ui-workbench']
  assert.equal(ext.style, 's1')
  assert.equal(tokens.nodes[free.id].$extensions['app.codeatlas.ui-workbench'].style, undefined)
})

const LOOK = {
  stroke: { color: '#112233', width: 4, style: 'dashed' as const },
  cap: 'round' as const
}
const ENDS = { x1: 10, y1: 20, x2: 110, y2: 20 }

check('直线创建:序号取现有最大 + 1,带默认外观;端点取 2 位小数并钳边界', () => {
  const a = createLine([], ENDS)
  assert.equal(a.id, 'line-1')
  assert.equal(a.name, '直线 1')
  assert.deepEqual(a.stroke, { color: '#000000', width: 1, style: 'solid' })
  assert.equal(a.cap, 'butt')
  const b = createLine([a], ENDS, LOOK)
  assert.equal(b.id, 'line-2')
  assert.deepEqual(b.stroke, LOOK.stroke)
  assert.equal(b.cap, 'round')
  assert.equal(createLine([a, b], ENDS).id, 'line-3')
  const p = applyLinePatch(a, { x1: 1.23456, x2: 999999 })
  assert.equal(p.x1, 1.23)
  assert.ok(p.x2 < 999999)
  assert.equal(
    applyLinePatch(a, { stroke: { color: 'nope', width: 3, style: 'solid' } }).stroke,
    a.stroke
  )
  assert.equal(applyLinePatch(a, { cap: 'zigzag' as unknown as LineNode['cap'] }).cap, 'butt')
})

check('直线长度/角度:派生值正确,改长度保起点方向,改角度保起点长度', () => {
  const l = createLine([], { x1: 0, y1: 0, x2: 30, y2: 40 })
  assert.equal(lineLength(l), 50)
  assert.equal(Math.round(lineAngle(l)), 53)
  assert.equal(lineAngle(createLine([], { x1: 0, y1: 0, x2: -10, y2: 0 })), 180)
  assert.equal(lineAngle(createLine([], { x1: 0, y1: 0, x2: 0, y2: -10 })), 270)
  const longer = applyLinePatch(l, lineWithLength(l, 100))
  assert.equal(Math.round(lineLength(longer)), 100)
  assert.equal(Math.round(lineAngle(longer)), 53)
  const turned = applyLinePatch(l, lineWithAngle(l, 90))
  assert.equal(turned.x2, 0)
  assert.equal(turned.y2, 50)
  assert.equal(lineLength(createLine([], { x1: 5, y1: 5, x2: 5, y2: 5 })), 0)
})

check('直线拖出:自由绘制取整;Shift 吸 15° 水平/垂直精确无 -0;Alt 以按下点为中点', () => {
  assert.deepEqual(
    lineFromDrag(
      { x: 10.4, y: 20.6 },
      { x: 50.2, y: 30.7 },
      { isAngleSnap: false, isFromCenter: false }
    ),
    { x1: 10, y1: 21, x2: 50, y2: 31 }
  )
  const h = lineFromDrag(
    { x: 10, y: 10 },
    { x: 110, y: 18 },
    { isAngleSnap: true, isFromCenter: false }
  )
  assert.equal(h.y2, 10)
  assert.ok(Math.abs(h.x2 - 110.31) < 0.5)
  const v = lineFromDrag(
    { x: 10, y: 10 },
    { x: 14, y: 110 },
    { isAngleSnap: true, isFromCenter: false }
  )
  assert.equal(v.x2, 10)
  assert.ok(Object.is(v.x2, 10) && !Object.is(v.x2, -0))
  const d = lineFromDrag(
    { x: 0, y: 0 },
    { x: 100, y: 90 },
    { isAngleSnap: true, isFromCenter: false }
  )
  assert.ok(Math.abs(d.x2 - d.y2) < 0.02)
  const c = lineFromDrag(
    { x: 50, y: 50 },
    { x: 80, y: 50 },
    { isAngleSnap: false, isFromCenter: true }
  )
  assert.deepEqual(c, { x1: 20, y1: 50, x2: 80, y2: 50 })
})

check('直线拖端点:另一端钉死,被拖端跟指针', () => {
  const l = createLine([], ENDS)
  assert.deepEqual(lineEndpointPatch(l, 'end', { x: 200, y: 70 }, { isAngleSnap: false }), {
    x2: 200,
    y2: 70
  })
  assert.deepEqual(lineEndpointPatch(l, 'start', { x: 0, y: 5 }, { isAngleSnap: false }), {
    x1: 0,
    y1: 5
  })
  const snapped = lineEndpointPatch(l, 'end', { x: 210, y: 25 }, { isAngleSnap: true })
  assert.equal(snapped.y2, 20)
})

check('直线命中与框选:容差内命中,线外不中;线段穿过选框(端点都在框外)也算扫到', () => {
  const l = createLine([], ENDS)
  assert.ok(hitLine(l, { x: 60, y: 24 }, 6))
  assert.ok(!hitLine(l, { x: 60, y: 40 }, 6))
  assert.ok(!hitLine(l, { x: 200, y: 20 }, 6))
  const fat = createLine([], ENDS, { stroke: { color: '#000000', width: 40, style: 'solid' } })
  assert.ok(hitLine(fat, { x: 60, y: 38 }, 0))
  const rect = createRect([], { x: 0, y: 0, width: 100, height: 100 })
  assert.equal(hitTopmost([rect, l], { x: 60, y: 20 }, 6), l)
  assert.ok(lineOverlapsBox(l, { x: 50, y: 0, width: 10, height: 40 }))
  assert.ok(!lineOverlapsBox(l, { x: 50, y: 30, width: 10, height: 40 }))
  assert.ok(lineOverlapsBox(l, { x: 60, y: 20, width: 0, height: 0 }))
  assert.ok(nodeOverlapsBox(l, { x: 0, y: 0, width: 20, height: 40 }))
})

check('场景通用操作:外接框/联合框/平移/克隆/深拷贝对矩形与直线一视同仁', () => {
  const rect = createRect([], { x: 0, y: 0, width: 10, height: 10 })
  const line = createLine([], { x1: 50, y1: 80, x2: 20, y2: 30 })
  assert.deepEqual(nodeBox(line), { x: 20, y: 30, width: 30, height: 50 })
  assert.deepEqual(unionBox([rect, line]), { x: 0, y: 0, width: 50, height: 80 })
  assert.deepEqual(translatePatch(rect, 5, 6), { x: 5, y: 6 })
  assert.deepEqual(translatePatch(line, 5, 6), { x1: 55, y1: 86, x2: 25, y2: 36 })
  const copy = cloneNode(line, [rect, line], { x: 10, y: 10 })
  assert.equal(copy.id, 'line-2')
  assert.equal(copy.type === 'line' && copy.x1, 60)
  assert.deepEqual(cloneLine(line, [line], { x: 0, y: 0 }).stroke, line.stroke)
  const snap = snapshotNode(line)
  assert.notEqual(snap, line)
  assert.notEqual((snap as LineNode).stroke, line.stroke)
  assert.deepEqual(snapTargets([rect, line], rect.id), [nodeBox(line)])
})

check('场景命令:直线 add/update/remove;对矩形打直线补丁不串字段', () => {
  const rect = createRect([], { x: 0, y: 0, width: 10, height: 10 })
  const line = createLine([rect], ENDS)
  let nodes = applyNodeAction([rect], { type: 'add', node: line })
  assert.equal(nodes.length, 2)
  nodes = applyNodeAction(nodes, { type: 'update', id: line.id, patch: { x2: 300.567 } })
  assert.equal((nodes[1] as LineNode).x2, 300.57)
  nodes = applyNodeAction(nodes, { type: 'update', id: rect.id, patch: { x1: 5 } as never })
  assert.equal('x1' in nodes[0] && nodes[0].type === 'rect' ? 'leak' : 'clean', 'clean')
  nodes = applyNodeAction(nodes, { type: 'remove', id: line.id })
  assert.equal(nodes.length, 1)
})

check('直线判等:端点/线宽/端点样式任一不同即异;矩形与直线互不相等', () => {
  const a = createLine([], ENDS)
  const same = { ...a, stroke: { ...a.stroke } }
  assert.ok(sameNodes([a], [same]))
  assert.ok(!sameNodes([a], [{ ...same, x2: 111 }]))
  assert.ok(!sameNodes([a], [{ ...same, cap: 'round' }]))
  assert.ok(!sameNodes([a], [{ ...same, stroke: { ...a.stroke, width: 2 } }]))
  assert.ok(!sameNodes([a], [createRect([], { x: 0, y: 0, width: 10, height: 10 })]))
})

check('直线导出:SVG <line> 带端点样式/虚线;CSS 旋转盒子;tokens 带两端点与派生长度角度', () => {
  const doc = {
    artboard: { width: 200, height: 200 },
    nodes: [
      createLine([], { x1: 10, y1: 20, x2: 110, y2: 20 }),
      createLine([{ id: 'line-1' }], { x1: 0, y1: 0, x2: 30, y2: 40 }, LOOK)
    ]
  }
  const svg = toSvg(doc)
  assert.ok(
    svg.includes(
      '<line id="line-1" x1="10" y1="20" x2="110" y2="20" stroke="#000000" stroke-width="1" stroke-linecap="butt"/>'
    )
  )
  assert.ok(svg.includes('stroke-linecap="round" stroke-dasharray="12 8"'))
  const css = artboardCss(doc)
  assert.ok(
    css.includes('.line-1 {') &&
      css.includes('top: 19.5px') &&
      css.includes('width: 100px') &&
      css.includes('height: 1px')
  )
  assert.ok(!css.split('.line-2')[0].includes('transform: rotate'))
  const second = css.split('.line-2 {')[1]
  assert.ok(
    second.includes('left: -2px') &&
      second.includes('border-radius: 2px') &&
      second.includes('rotate(53.13deg)')
  )
  assert.ok(second.includes('repeating-linear-gradient'))
  assert.ok(toHtml(doc).includes('<div class="line-2"></div>'))
  const tokens = toDtcgTokens(doc) as { nodes: Record<string, Record<string, { $value: unknown }>> }
  const t = tokens.nodes['line-2']
  assert.deepEqual(t.x2.$value, { value: 30, unit: 'px' })
  assert.deepEqual(t.length.$value, { value: 50, unit: 'px' })
  assert.equal(t.angle.$value, 53.13)
  assert.ok(String((t as unknown as { $description: string }).$description).startsWith('直线 2('))
  assert.equal((t.stroke.$value as { width: { value: number } }).width.value, 4)
  const ext = (t as unknown as { $extensions: Record<string, { cap: string; nodeType: string }> })
    .$extensions['app.codeatlas.ui-workbench']
  assert.equal(ext.cap, 'round')
  assert.equal(ext.nodeType, 'line')
})

check('直线进撤销栈:添加/移动/删除各一步,撤销还原端点;undo 后选集只留活着的', () => {
  const before = getDocState().nodes.length
  const line = createLine(getDocState().nodes, ENDS)
  docActions.dispatch({ type: 'add', node: line })
  docActions.select(line.id)
  docActions.dispatch({ type: 'update', id: line.id, patch: translatePatch(line, 5, 5) })
  const moved = getDocState().nodes.find((n) => n.id === line.id) as LineNode
  assert.equal(moved.x1, 15)
  docActions.undo()
  assert.equal((getDocState().nodes.find((n) => n.id === line.id) as LineNode).x1, 10)
  docActions.dispatch({ type: 'remove', id: line.id })
  assert.equal(getDocState().nodes.length, before)
  docActions.undo()
  assert.ok(getDocState().nodes.some((n) => n.id === line.id))
  docActions.undo()
  assert.equal(getDocState().nodes.length, before)
  assert.ok(!getDocState().selectedIds.includes(line.id))
})
check('新矩形沿用最近样式:取样式最新定义(同名覆盖后跟着变);样式被删按无样式落位并保留数值', () => {
  const styles: RectStyle[] = [
    { id: 's1', name: '卡片', fill: '#ff0000', stroke: null, radii: [8, 8, 8, 8] }
  ]
  const look = { fill: '#00ff00', stroke: null, radii: [0, 0, 0, 0] as const, styleId: 's1' }
  const live = resolveLinkedLook(look, styles)
  assert.equal(live.fill, '#ff0000')
  assert.deepEqual([...live.radii], [8, 8, 8, 8])
  assert.equal(live.styleId, 's1')
  const edited = resolveLinkedLook(look, [{ ...styles[0], fill: '#0000ff' }])
  assert.equal(edited.fill, '#0000ff')
  const orphan = resolveLinkedLook(look, [])
  assert.equal(orphan.fill, '#00ff00')
  assert.equal(orphan.styleId, null)
  assert.equal(resolveLinkedLook({ ...look, styleId: null }, styles).fill, '#00ff00')
})

check('直线端点吸附取值:吸到中线的 .5 在 isPrecise 下保留,自由绘制仍取整', () => {
  const free = lineFromDrag(
    { x: 0, y: 0 },
    { x: 50.5, y: 10 },
    { isAngleSnap: false, isFromCenter: false }
  )
  assert.equal(free.x2, 51)
  const precise = lineFromDrag(
    { x: 0, y: 0 },
    { x: 50.5, y: 10 },
    { isAngleSnap: false, isFromCenter: false, isPrecise: true }
  )
  assert.equal(precise.x2, 50.5)
  const l = createLine([], ENDS)
  assert.deepEqual(
    lineEndpointPatch(l, 'end', { x: 200.5, y: 20 }, { isAngleSnap: false, isPrecise: true }),
    { x2: 200.5, y2: 20 }
  )
  const snapped = snapMove(
    { x: 108, y: 21, width: 0, height: 0 },
    [
      { x: 0, y: 0, width: 110, height: 50 },
      { x: 10, y: 20, width: 0, height: 0 }
    ],
    5
  )
  assert.equal(snapped.x, 110)
  assert.equal(snapped.y, 20)
})
check('直线样式:改外观静默脱钩、改端点不脱;存档逐条校验;活链接取最新定义', () => {
  const style: LineStyle = {
    id: 'l1',
    name: '分割线',
    stroke: { color: '#999999', width: 2, style: 'dashed' },
    cap: 'round'
  }
  const linked = applyLinePatch(createLine([], ENDS), { ...lineAppearanceOf(style), styleId: 'l1' })
  assert.equal(linked.styleId, 'l1')
  assert.equal(applyLinePatch(linked, { x2: 300 }).styleId, 'l1')
  assert.equal(applyLinePatch(linked, { cap: 'square' }).styleId, null)
  assert.equal(applyLinePatch(linked, { stroke: { ...linked.stroke, width: 5 } }).styleId, null)
  assert.equal(applyLinePatch(linked, { cap: 'square', styleId: 'l1' }).styleId, 'l1')
  assert.equal(linkedLineStyleId(linked, [style]), 'l1')
  assert.equal(linkedLineStyleId(linked, []), '')
  const stored = JSON.parse(
    JSON.stringify([style, { id: '', name: 'x' }, { ...style, id: 'l2', cap: 'zig' }])
  )
  assert.deepEqual(sanitizeLineStyles(stored), [style])
  assert.deepEqual(sanitizeLineStyles('nope'), [])
  const look = {
    stroke: { color: '#000000', width: 1, style: 'solid' as const },
    cap: 'butt' as const,
    styleId: 'l1'
  }
  assert.equal(resolveLinkedLineLook(look, [style]).cap, 'round')
  assert.equal(resolveLinkedLineLook(look, [{ ...style, cap: 'square' }]).cap, 'square')
  const orphan = resolveLinkedLineLook(look, [])
  assert.equal(orphan.styleId, null)
  assert.equal(orphan.stroke.width, 1)
})

check('样式组:存为相对坐标 JSON,放入时重编 id、整体平移、散开可改;往返不丢', () => {
  const rect = applyRectPatch(createRect([], { x: 100, y: 50, width: 40, height: 20 }), {
    radii: [4, 4, 4, 4],
    stroke: { color: '#112233', width: 2, style: 'solid' }
  })
  const line = createLine([rect], { x1: 120, y1: 90, x2: 220, y2: 90 }, LOOK)
  const group = buildGroup('g1', '  卡片+线  ', 1, [rect, line])
  assert.equal(group.name, '卡片+线')
  assert.deepEqual(unionBox(group.nodes), { x: 0, y: 0, width: 120, height: 40 })
  assert.equal(group.nodes[0].type === 'rect' && group.nodes[0].x, 0)
  assert.equal(rect.x, 100)
  assert.equal(buildGroup('g2', '   ', 3, [rect]).name, '样式组 3')
  assert.deepEqual(groupSize(group), { width: 120, height: 40 })
  assert.equal(describeGroup(group), '1 个矩形 · 1 条直线')
  const existing = [createRect([], { x: 0, y: 0, width: 5, height: 5 })]
  const made = instantiateGroup(group, existing, { x: 300, y: 400 })
  assert.deepEqual(
    made.map((n) => n.id),
    ['rect-2', 'line-1']
  )
  assert.equal(made[0].type === 'rect' && made[0].x, 300)
  assert.equal(made[0].type === 'rect' && made[0].y, 400)
  assert.equal(made[1].type === 'line' && made[1].x1, 320)
  assert.equal(made[1].type === 'line' && made[1].y1, 440)
  assert.equal(made[1].type === 'line' && made[1].cap, 'round')
  const again = instantiateGroup(group, [...existing, ...made], { x: 0, y: 0 })
  assert.deepEqual(
    again.map((n) => n.id),
    ['rect-3', 'line-2']
  )
  assert.equal(group.nodes[0].type === 'rect' && group.nodes[0].x, 0)
  const round = sanitizeGroups(JSON.parse(JSON.stringify([group])))
  assert.equal(round.length, 1)
  assert.deepEqual(
    round[0].nodes.map((n) => n.type),
    ['rect', 'line']
  )
  assert.equal(describeGroup(round[0]), '1 个矩形 · 1 条直线')
  const inserted = instantiateGroup(round[0], [], { x: 10, y: 10 })
  assert.equal(inserted[0].type === 'rect' && inserted[0].stroke?.width, 2)
})

check('样式组存档校验:坏节点整组丢弃、空组/无名/非数组丢弃,超限截断', () => {
  const rect = createRect([], { x: 0, y: 0, width: 10, height: 10 })
  const good = { id: 'g1', name: 'ok', nodes: [rect] }
  assert.equal(sanitizeGroups([good]).length, 1)
  assert.equal(
    sanitizeGroups([{ ...good, nodes: [rect, { type: 'rect', name: 'bad' }] }]).length,
    0
  )
  assert.equal(sanitizeGroups([{ ...good, nodes: [] }]).length, 0)
  assert.equal(sanitizeGroups([{ ...good, name: '  ' }]).length, 0)
  assert.equal(sanitizeGroups([{ ...good, id: '' }]).length, 0)
  assert.equal(sanitizeGroups([{ ...good, nodes: [{ ...rect, type: 'circle' }] }]).length, 0)
  assert.deepEqual(sanitizeGroups({ not: 'array' }), [])
  const many = Array.from({ length: 80 }, (_, i) => ({ ...good, id: `g${i}` }))
  assert.equal(sanitizeGroups(many).length, 64)
  const clamped = sanitizeGroups([{ ...good, nodes: [{ ...rect, width: 999999 }] }])[0].nodes[0]
  assert.ok(clamped.type === 'rect' && clamped.width <= 20000)
})

check('tokens 带直线样式:定义进 styles 组,线节点 $extensions.style 记引用', () => {
  const style: LineStyle = {
    id: 'l1',
    name: '分割线',
    stroke: { color: '#999999', width: 2, style: 'dashed' },
    cap: 'round'
  }
  const line = applyLinePatch(createLine([], ENDS), { ...lineAppearanceOf(style), styleId: 'l1' })
  const tokens = toDtcgTokens({
    artboard: { width: 100, height: 100 },
    nodes: [line],
    lineStyles: [style]
  }) as {
    styles: Record<string, { $extensions: Record<string, { cap: string }> }>
    nodes: Record<string, { $extensions: Record<string, { style?: string }> }>
  }
  assert.equal(tokens.styles.l1.$extensions['app.codeatlas.ui-workbench'].cap, 'round')
  assert.equal(tokens.nodes[line.id].$extensions['app.codeatlas.ui-workbench'].style, 'l1')
})
check('间距吸附:按已有空隙吸成等距、前后邻居居中、阈值外/锁轴不吸、被挡住的空隙不算参考', () => {
  const box = (x: number, y: number, width: number, height: number): SnapBox => ({
    x,
    y,
    width,
    height
  })
  const stack = [box(0, 0, 100, 50), box(0, 80, 100, 50)]
  const near = snapSpacing(box(0, 163, 100, 50), stack, 5, { x: false, y: false })
  assert.equal(near.y, 160)
  assert.equal(near.isSnapped.y, true)
  assert.equal(near.isSnapped.x, false)
  assert.equal(near.refMarks.length, 1)
  assert.equal(near.refMarks[0].value, 30)
  assert.equal(
    snapSpacing(box(0, 170, 100, 50), stack, 5, { x: false, y: false }).isSnapped.y,
    false
  )
  assert.equal(
    snapSpacing(box(0, 163, 100, 50), stack, 5, { x: false, y: true }).isSnapped.y,
    false
  )
  assert.equal(snapSpacing(box(0, 163, 100, 50), stack, 5, { x: true, y: true }).isSnapped.y, false)
  const between = snapSpacing(box(0, 77, 100, 40), [box(0, 0, 100, 50), box(0, 150, 100, 50)], 5, {
    x: false,
    y: false
  })
  assert.equal(between.y, 80)
  const blocked = [box(0, 0, 100, 100), box(10, 50, 80, 0), box(0, 130, 100, 50)]
  assert.equal(
    snapSpacing(box(0, 262, 100, 50), blocked, 5, { x: false, y: false }).isSnapped.y,
    false
  )
  const gaps = neighborGaps(box(120, 0, 30, 50), [box(0, 0, 100, 50)])
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].axis, 'h')
  assert.equal(gaps[0].value, 20)
  assert.equal(gapMarks(box(120, 0, 30, 50), [box(0, 0, 100, 50)], gaps, true).length, 1)
})
check('多选整体缩放:手柄换新联合框(锚点/等比/中心/不翻转),节点按框映射,直线端点同映射', () => {
  const handle = (id: string): ScaleHandle => SCALE_HANDLES.find((h) => h.id === id)!
  const free = { isProportional: false, isFromCenter: false }
  const box = { x: 100, y: 100, width: 200, height: 100 }
  assert.deepEqual(scaleBoxByHandle(box, handle('se'), { x: 400, y: 250 }, free), {
    x: 100,
    y: 100,
    width: 300,
    height: 150
  })
  assert.deepEqual(scaleBoxByHandle(box, handle('nw'), { x: 50, y: 60 }, free), {
    x: 50,
    y: 60,
    width: 250,
    height: 140
  })
  assert.deepEqual(scaleBoxByHandle(box, handle('e'), { x: 500, y: 999 }, free), {
    x: 100,
    y: 100,
    width: 400,
    height: 100
  })
  const prop = scaleBoxByHandle(
    box,
    handle('se'),
    { x: 400, y: 150 },
    {
      ...free,
      isProportional: true
    }
  )
  assert.deepEqual(prop, { x: 100, y: 100, width: 300, height: 150 })
  const edgeProp = scaleBoxByHandle(
    box,
    handle('e'),
    { x: 500, y: 0 },
    {
      ...free,
      isProportional: true
    }
  )
  assert.deepEqual(edgeProp, { x: 100, y: 50, width: 400, height: 200 })
  const center = scaleBoxByHandle(
    box,
    handle('e'),
    { x: 400, y: 0 },
    {
      ...free,
      isFromCenter: true
    }
  )
  assert.deepEqual(center, { x: 0, y: 100, width: 400, height: 100 })
  const crushed = scaleBoxByHandle(box, handle('e'), { x: 0, y: 0 }, free)
  assert.equal(crushed.width, 1)
  assert.equal(crushed.x, 100)
  const rect = createRect([], { x: 120, y: 110, width: 100, height: 50 })
  const line = createLine([rect], { x1: 120, y1: 200, x2: 280, y2: 200 }, LOOK)
  const to = { x: 100, y: 100, width: 400, height: 200 }
  const rp = scaleNodePatch(rect, box, to)
  assert.deepEqual(rp, { x: 140, y: 120, width: 200, height: 100 })
  const lp = scaleNodePatch(line, box, to)
  assert.deepEqual(lp, { x1: 140, y1: 300, x2: 460, y2: 300 })
  const nodes = [rect, line].map(
    (n) => applyNodeAction([n], { type: 'update', id: n.id, patch: scaleNodePatch(n, box, to) })[0]
  )
  assert.deepEqual(unionBox(nodes), { x: 140, y: 120, width: 320, height: 180 })
})
console.log('UI 工作台纯逻辑自测全部通过')
