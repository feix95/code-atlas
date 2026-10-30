// 文档大纲自测:编号(中英文/重名/空标题)、从上屏正文收标题(级别/顺序/跳过内联标题)、
// 缩进档、滚动跟随的读线判定、没有标题就没有大纲。DOM 用 linkedom 在内存里搭。
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  activeOutlineId,
  collectOutline,
  headingLevelOf,
  outlineDepths,
  outlineHeadingEls,
  outlineIds
} from '../src/renderer/src/docOutline.ts'
import {
  DOCK_MIN_HEIGHT,
  DOCK_MIN_TREE,
  clampDockRatio,
  hidesFloatingDock
} from '../src/renderer/src/sidebarDock.ts'
import {
  DEFAULT_PLACEMENT,
  DRAG_START_PX,
  SNAP_SLACK_PX,
  capToContent,
  clampPlacement,
  isDragStarted,
  movePlacement,
  parseFloatPlacement,
  resizePlacement,
  settleResize,
  snapFrame
} from '../src/renderer/src/floatPlacement.ts'
import {
  clampCollapsed,
  moveCollapsed,
  outlineBounds
} from '../src/renderer/src/outlinePlacement.ts'

function rootOf(html: string): Element {
  const { document } = parseHTML(
    `<!doctype html><html><body><div id="r">${html}</div></body></html>`
  )
  const root = document.getElementById('r')
  assert.ok(root)
  return root as unknown as Element
}

function checkIds(): void {
  assert.deepEqual(outlineIds(['Getting Started', 'API & Usage']), [
    'outline-getting-started',
    'outline-api-usage'
  ])
  assert.deepEqual(outlineIds(['第一章 总览']), ['outline-第一章-总览'], '中文字保留')
  assert.deepEqual(
    outlineIds(['Intro', 'Intro', 'intro']),
    ['outline-intro', 'outline-intro-2', 'outline-intro-3'],
    '重名从第二个起挂序号'
  )
  assert.deepEqual(outlineIds(['!!!']), ['outline-section'], '全是符号的标题有兜底名')
  assert.deepEqual(outlineIds(['A', 'B']), outlineIds(['A', 'B']), '同一份正文每次算都一样')
}

function checkCollect(): void {
  const root = rootOf(
    '<div class="md-title">file name</div>' +
      '<div class="md-h md-h1">Title</div><p>body</p>' +
      '<h2 class="md-h md-h2">Part  <code>one</code></h2>' +
      '<div class="md-h md-h3">Part one</div>' +
      '<div class="md-h md-h2">Title</div>' +
      '<div class="md-h md-h4">   </div>' +
      '<p><strong>Bold paragraph</strong></p>'
  )
  const items = collectOutline(root)
  assert.deepEqual(
    items.map((i) => [i.level, i.text]),
    [
      [1, 'Title'],
      [2, 'Part one'],
      [3, 'Part one'],
      [2, 'Title']
    ],
    '只收真标题:内联标题、空标题、加粗段落都不算;行内标签与多余空白收拢'
  )
  assert.deepEqual(
    items.map((i) => i.id),
    ['outline-title', 'outline-part-one', 'outline-part-one-2', 'outline-title-2']
  )
  const els = outlineHeadingEls(root)
  assert.deepEqual(
    els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()),
    items.map((i) => i.text),
    '标题元素按正文顺序排,与条目一一对应(跳转和读线按这个顺序取)'
  )
  assert.equal(els.length, items.length, '被跳过的空标题 / 假标题不会混进来占位')
  assert.deepEqual(collectOutline(root), items, '重收一遍结果不变')

  assert.deepEqual(collectOutline(rootOf('<p>no headings</p><div class="md-title">x</div>')), [])
  assert.equal(headingLevelOf(rootOf('<i class="md-h7"></i>').firstElementChild as Element), null)
  assert.equal(headingLevelOf(rootOf('<i class="md-h md-h6"></i>').firstElementChild as Element), 6)
}

function checkDepthsAndSpy(): void {
  const items = [
    { id: 'a', level: 2, text: 'a' },
    { id: 'b', level: 3, text: 'b' },
    { id: 'c', level: 2, text: 'c' }
  ]
  assert.deepEqual(outlineDepths(items), [0, 1, 0], '从最浅一级起算缩进')
  const heads = [
    { id: 'a', top: 40 },
    { id: 'b', top: 300 },
    { id: 'c', top: 900 }
  ]
  assert.equal(activeOutlineId(heads, 20), null, '第一个标题还没到读线')
  assert.equal(activeOutlineId(heads, 100), 'a')
  assert.equal(activeOutlineId(heads, 300), 'b', '刚好压线算进入')
  assert.equal(
    activeOutlineId([{ id: 'a', top: -500 }, ...heads.slice(1)], 100),
    'a',
    '滚过头的仍算当前'
  )
  assert.equal(activeOutlineId([], 100), null)
}

/**
 * 预览面板 800x600,顶端 48px 是页头,坞贴在面板顶;浮窗 200x300,缝 8,最小 128x80;
 * natural/naturalH = 内容宽/高(null = 没量到),autoMax/autoMaxH = 自适应档宽/高上限(24rem = 384、28rem = 448)
 */
function sampleBounds(
  panel = { width: 200, height: 300 },
  natural: number | null = null,
  autoMax = 384,
  naturalH: number | null = null,
  autoMaxH = 448
) {
  return outlineBounds({
    view: { left: 0, top: 48, right: 800, bottom: 600 },
    dock: { left: 0, top: 0, right: 800, bottom: 0 },
    panel,
    gap: 8,
    min: { width: 128, height: 80 },
    natural: { width: natural, height: naturalH },
    autoMax: { width: autoMax, height: autoMaxH },
    reserveTop: 0
  })
}

function checkPlacement(): void {
  assert.deepEqual(parseFloatPlacement(null), DEFAULT_PLACEMENT, '没记过回默认')
  assert.deepEqual(parseFloatPlacement('junk'), DEFAULT_PLACEMENT, '坏账回默认')
  assert.deepEqual(
    parseFloatPlacement({ right: 10, top: 'x', width: -5, height: 240 }),
    { right: 10, top: null, width: null, height: 240 },
    '逐字段验身:坏类型、非正尺寸都当没记过'
  )
  const b = sampleBounds()
  assert.equal(b.minRight, 8, '默认贴面板右缘留缝')
  assert.equal(b.minTop, 8, '上缘能一路挪到面板顶,贴顶留缝')
  assert.equal(b.defaultTop, 56, '没拖过落在阅读栏右上角,不压页头')
  assert.equal(b.maxRight, 792 - 200, '往左最多挪到浮窗左缘贴栏左缝')
  assert.equal(b.maxTop, 592 - 300, '往下最多挪到浮窗底贴栏底缝')
  const home = clampPlacement(DEFAULT_PLACEMENT, b)
  assert.deepEqual(
    [home.right, home.top, home.width],
    [8, 56, null],
    '默认 = 阅读栏右上角、宽高自适应'
  )
  const moved = movePlacement(home, -100, 50, b)
  assert.deepEqual([moved.right, moved.top], [108, 106], '往左下拖:right 变大、top 变大')
  const flung = movePlacement(home, -5000, 5000, b)
  assert.deepEqual([flung.right, flung.top], [b.maxRight, b.maxTop], '拖出面板外夹回范围内')
  const back = movePlacement(home, 5000, -5000, b)
  assert.deepEqual([back.right, back.top], [b.minRight, b.minTop], '拖到最右上:贴着面板顶')

  const from = { width: 200, height: 300 }
  const grown = resizePlacement(moved, from, 60, 40, b)
  assert.deepEqual([grown.width, grown.height], [260, 340], '往右下拉 = 变宽变高')
  assert.deepEqual([grown.right, grown.top], [48, 106], '拉尺寸时左上角钉住(右缘跟着往右走)')
  const atEdge = resizePlacement(home, from, 60, 0, b)
  assert.equal(atEdge.width, 200, '贴着面板右缘时往右拉不出面板外')
  assert.equal(atEdge.height, null, '只拉了横向,高度仍自适应')
  const tallOnly = resizePlacement(moved, from, 0, 30, b)
  assert.deepEqual([tallOnly.width, tallOnly.height], [null, 330], '只拉了纵向,宽度仍自适应')
  const tiny = resizePlacement(moved, from, -500, -500, b)
  assert.deepEqual([tiny.width, tiny.height, tiny.right], [128, 80, 180], '拉不小于最小档,左缘不动')
  const huge = resizePlacement(moved, from, 5000, 5000, b)
  assert.deepEqual([huge.width, huge.right], [300, b.minRight], '拉不出面板右缘')
  assert.equal(huge.height, b.reachDown - moved.top, '拉不出栏底')
  const wide = clampPlacement({ right: 500, top: 0, width: 300, height: null }, b)
  assert.equal(wide.right, b.reachLeft - 300, '手动宽度按自己的宽度夹位置,不拿旧实测宽度')

  const narrow = outlineBounds({
    view: { left: 0, top: 30, right: 300, bottom: 200 },
    dock: { left: 0, top: 0, right: 300, bottom: 0 },
    panel: { width: 200, height: 150 },
    gap: 8,
    min: { width: 128, height: 80 },
    natural: { width: null, height: null },
    autoMax: { width: 384, height: 448 },
    reserveTop: 0
  })
  const stale = clampPlacement({ right: 400, top: 900, width: 600, height: 600 }, narrow)
  assert.ok(stale.right <= narrow.maxRight && stale.top <= narrow.maxTop, '面板变小后旧位置夹回来')
  assert.equal(stale.width, narrow.maxWidth, '旧尺寸超栏宽夹回来')
}

/** 收起态只剩圆钮:位置按圆钮实测的小尺寸夹,存下的展开宽高不许挡路;宽高原样带回给展开用 */
function checkCollapsedClamp(): void {
  const knob = sampleBounds({ width: 42, height: 42 })
  const stored = { right: 900, top: 900, width: 225, height: 260 }
  const folded = clampCollapsed(stored, knob)
  assert.deepEqual(
    [folded.right, folded.top],
    [knob.maxRight, knob.maxTop],
    '收起态能一直贴到栏左缝与栏底缝'
  )
  assert.deepEqual([folded.width, folded.height], [225, 260], '存下的展开宽高原样留着')
  assert.equal(
    clampPlacement(stored, knob).right,
    knob.reachLeft - 225,
    '对照:拿展开宽度算的话,圆钮会被拦在栏中间'
  )
  assert.deepEqual(
    [
      clampCollapsed({ ...stored, top: 20 }, knob).top,
      clampCollapsed({ ...stored, right: 20 }, knob).right
    ],
    [20, 20],
    '没越过边的不动'
  )
  const dragged = moveCollapsed(clampCollapsed(stored, knob), -5000, -5000, knob)
  assert.deepEqual(
    [dragged.right, dragged.top, dragged.width, dragged.height],
    [knob.maxRight, knob.minTop, 225, 260],
    '收起态往左下拖:按圆钮尺寸夹到栏左缝与栏底缝,存的展开宽高原样带回'
  )
  assert.equal(
    movePlacement(clampCollapsed(stored, knob), -5000, 0, knob).right,
    knob.reachLeft - 225,
    '对照:拖动若走展开态的夹法,圆钮到不了栏边(这次修的坑)'
  )
}

/** 宽度不留空白:拉的途中跟手,松手比内容宽还宽就吸回;拉窄保留;换短标题的文档上屏收到内容宽 */
function checkContentWidth(): void {
  const b = sampleBounds(undefined, 180)
  assert.equal(b.fitWidth, 180, '内容宽照实测')
  assert.equal(b.maxWidth, 784)
  assert.equal(sampleBounds(undefined, null).fitWidth, b.maxWidth, '没量到内容宽 = 不设上限')
  assert.equal(sampleBounds(undefined, 60).fitWidth, 128, '内容宽不小于最小宽')
  assert.equal(sampleBounds(undefined, 5000).fitWidth, b.maxWidth, '内容宽不大于栏宽')

  const moved = movePlacement(clampPlacement(DEFAULT_PLACEMENT, b), -300, 0, b)
  const from = { width: 180, height: 300 }
  const dragging = resizePlacement(moved, from, 200, 0, b)
  assert.equal(dragging.width, 380, '拉的途中宽度跟着鼠标走,不受内容宽限制')
  const snapped = settleResize(dragging, b)
  assert.equal(snapped.width, null, '松手比内容宽还宽:吸回自适应,换文档还会跟着内容变')
  assert.equal(snapped.right, moved.right, '吸回时左缘不动(右缘收回原处)')
  assert.equal(
    settleResize({ ...dragging, width: 180 - SNAP_SLACK_PX + 1 }, b).width,
    null,
    '差几像素没拉满也算拉满'
  )
  const narrower = resizePlacement(moved, from, -40, 0, b)
  assert.equal(narrower.width, 140)
  assert.deepEqual(settleResize(narrower, b), narrower, '拉得比内容宽窄:原样保留')
  const tallOnly = resizePlacement(moved, from, 0, 30, b)
  assert.deepEqual(settleResize(tallOnly, b), tallOnly, '只拉了高度:宽度仍自适应')

  const overCap = sampleBounds(undefined, 500)
  const wideDrag = { right: 0, top: 0, width: 700, height: null }
  assert.deepEqual(
    [settleResize(wideDrag, overCap).width, settleResize(wideDrag, overCap).right],
    [500, 200],
    '内容宽超过自适应上限:吸回记成手动的内容宽,长标题照样看全'
  )

  const stale = { right: 10, top: 0, width: 300, height: 200 }
  assert.deepEqual(
    capToContent(stale, b),
    { ...stale, width: null },
    '记下的宽比内容宽还宽:上屏收回,右缘不动'
  )
  assert.deepEqual(
    capToContent({ ...stale, width: 150 }, b),
    { ...stale, width: 150 },
    '比内容宽窄的照用'
  )
  assert.equal(capToContent(stale, overCap).width, stale.width, '没超出内容宽不动')
  assert.equal(capToContent({ ...stale, width: 600 }, overCap).width, 500)
}

/** 高度同理:拉的途中跟手,松手比内容高还高就吸回(上缘不动),拉矮保留(列表出滚动条) */
function checkContentHeight(): void {
  const b = sampleBounds(undefined, 180, 384, 260)
  assert.equal(b.fitHeight, 260, '内容高照实测')
  assert.equal(sampleBounds(undefined, null, 384, 5000).fitHeight, b.maxHeight, '内容高不超过栏高')
  assert.equal(sampleBounds(undefined, null, 384, 30).fitHeight, 80, '内容高不小于最小高')
  const moved = movePlacement(clampPlacement(DEFAULT_PLACEMENT, b), -300, 40, b)
  const from = { width: 180, height: 260 }
  const dragging = resizePlacement(moved, from, 0, 150, b)
  assert.equal(dragging.height, 410, '拉的途中高度跟着鼠标走,不受内容高限制')
  const snapped = settleResize(dragging, b)
  assert.deepEqual(
    [snapped.height, snapped.top, snapped.right, snapped.width],
    [null, moved.top, moved.right, null],
    '松手比内容高还高:吸回自适应,上缘与左右不动'
  )
  assert.deepEqual(
    [snapFrame(snapped, dragging, b).height, snapFrame(snapped, dragging, b).width],
    [260, null],
    '吸回动画先落到内容高的像素值;没拉过的宽度保持自适应'
  )
  const shorter = resizePlacement(moved, from, 0, -60, b)
  assert.deepEqual(settleResize(shorter, b), shorter, '拉得比内容矮:原样保留')
  const both = resizePlacement(moved, from, 100, 100, b)
  const bothSnap = snapFrame(settleResize(both, b), both, b)
  assert.deepEqual([bothSnap.width, bothSnap.height], [180, 260], '宽高一起拉大,一起吸回')
  const tall = sampleBounds(undefined, 180, 384, 520)
  assert.equal(
    settleResize({ ...dragging, height: 560 }, tall).height,
    520,
    '内容高超过自适应上限:吸回记成手动的内容高'
  )
  const stale = { right: 0, top: 0, width: null, height: 400 }
  assert.equal(capToContent(stale, b).height, null, '记下的高比内容高还高:上屏收回')
  assert.equal(capToContent({ ...stale, height: 200 }, b).height, 200, '比内容矮的照用')
}

/** 点与拖的分界:挪不够 DRAG_START_PX 是点(圆钮点开),够了才是拖(松手不点开) */
function checkDragThreshold(): void {
  assert.equal(DRAG_START_PX, 4)
  assert.equal(isDragStarted(0, 0), false, '原地按下松开是点')
  assert.equal(isDragStarted(2, 2), false, '手抖两三像素仍算点')
  assert.equal(isDragStarted(4, 0), true, '挪够 4px 算拖')
  assert.equal(isDragStarted(-3, -3), true, '斜着挪,按直线距离算')
}

/** 悬停拖动条长在浮窗上缘之上:上缘最高只到面板顶缝再往下让出条高,可用高度同样扣掉 */
function checkBarRoom(): void {
  const geo = {
    view: { left: 0, top: 48, right: 800, bottom: 600 },
    dock: { left: 0, top: 0, right: 800, bottom: 0 },
    panel: { width: 200, height: 300 },
    gap: 8,
    min: { width: 128, height: 80 },
    natural: { width: null, height: null },
    autoMax: { width: 384, height: 448 }
  }
  const flat = outlineBounds({ ...geo, reserveTop: 0 })
  const roomy = outlineBounds({ ...geo, reserveTop: 24 })
  assert.equal(roomy.minTop, flat.minTop + 24, '上缘最高处往下让出拖动条的高度')
  assert.equal(roomy.maxHeight, flat.maxHeight - 24, '可用高度扣掉拖动条')
  assert.equal(roomy.maxTop, flat.maxTop, '往下的极限不变')
  const top = movePlacement(clampPlacement(DEFAULT_PLACEMENT, roomy), 0, -5000, roomy)
  assert.equal(top.top, roomy.minTop, '拖到最顶也给拖动条留着位置')
  assert.equal(
    clampPlacement({ ...DEFAULT_PLACEMENT, top: -50 }, roomy).top,
    roomy.minTop,
    '旧账夹回'
  )
}

/** 浮窗原点抬到整个预览面板:上缘能压到页头之上,没拖过仍落在阅读栏右上角 */
function checkPaneOrigin(): void {
  const geo = {
    view: { left: 0, top: 48, right: 800, bottom: 600 },
    dock: { left: 0, top: 0, right: 800, bottom: 0 },
    panel: { width: 200, height: 300 },
    gap: 8,
    min: { width: 128, height: 80 },
    natural: { width: null, height: null },
    autoMax: { width: 384, height: 448 }
  }
  const b = outlineBounds({ ...geo, reserveTop: 28 })
  assert.equal(b.minTop, 8 + 28, '上缘能挪到面板顶,只留缝和拖动条/圆钮的位置')
  assert.equal(b.defaultTop, 48 + 8 + 28, '没拖过落在阅读栏右上角,页头之下')
  assert.equal(b.maxHeight, 600 - 0 - 16 - 28, '可用高度从面板顶量到栏底')
  const home = clampPlacement(DEFAULT_PLACEMENT, b)
  assert.equal(home.top, b.defaultTop, '默认不压页头')
  const up = movePlacement(home, 0, -5000, b)
  assert.equal(up.top, 36, '能一路往上压到页头')
  assert.ok(up.top < geo.view.top, '压上去的位置确实在阅读栏顶之上')
  const down = movePlacement(home, 0, 5000, b)
  assert.equal(down.top, b.maxTop, '往下仍到栏底为止')
}

/** 收起态圆钮外移/上移的预留:右缘与上缘的夹边下限同步推高,展开收起共用,来回切换不挪位 */
function checkKnobReserve(): void {
  const geo = {
    view: { left: 0, top: 48, right: 800, bottom: 600 },
    dock: { left: 0, top: 0, right: 800, bottom: 0 },
    panel: { width: 42, height: 42 },
    gap: 8,
    min: { width: 128, height: 80 },
    natural: { width: null, height: null },
    autoMax: { width: 384, height: 448 }
  }
  const flat = outlineBounds({ ...geo, reserveTop: 0 })
  const knob = outlineBounds({
    ...geo,
    reserveTop: 28,
    reserveRight: 6,
    knob: { shift: 6, lift: 28 }
  })
  assert.equal(knob.minTop, flat.minTop + 28, '圆钮上移量算进上缘下限')
  assert.equal(knob.minRight, flat.minRight + 6, '圆钮外移量算进右缘下限')
  assert.equal(knob.maxTop, flat.maxTop + 28, '上限同量外推,圆钮贴得到栏底')
  assert.equal(knob.maxRight, flat.maxRight + 6, '上限同量外推,圆钮贴得到栏左')
  const folded = clampCollapsed(DEFAULT_PLACEMENT, knob)
  assert.deepEqual(
    [folded.right, folded.top],
    [knob.minRight, knob.defaultTop],
    '圆钮默认落在阅读栏右上角的留好余地处,不压页头'
  )
}

/** 浮窗让位判定:停靠开着、左栏能用、同一个窗口、停靠位就是我这签 —— 四条全占才藏 */
function checkDockDecision(): void {
  const all = { docked: true, hostUsable: true, sameDoc: true, isOwner: true }
  assert.equal(hidesFloatingDock(all), true, '四条全占:浮窗让位给左栏')
  for (const key of ['docked', 'hostUsable', 'sameDoc', 'isOwner'] as const) {
    assert.equal(hidesFloatingDock({ ...all, [key]: false }), false, `缺 ${key} 就不让位`)
  }
  assert.equal(
    hidesFloatingDock({ docked: false, hostUsable: true, sameDoc: true, isOwner: true }),
    false,
    '没停过:浮窗照常站岗'
  )
}

/** 左栏分割线的比例夹边:大纲不低于最小高,文件树也不被挤没;量不出高度时给对半 */
function checkDockRatio(): void {
  const room = 600
  assert.equal(clampDockRatio(0.4, room), 0.4, '中间的比例原样保留')
  assert.equal(clampDockRatio(0.01, room), DOCK_MIN_HEIGHT / room, '拖到顶:夹在大纲最小高')
  assert.equal(clampDockRatio(0.99, room), 1 - DOCK_MIN_TREE / room, '拖到底:给文件树留最小高')
  assert.equal(clampDockRatio(0.99, 5000), 0.9, '左栏再高也不让大纲吃掉九成以上')
  assert.equal(clampDockRatio(0.5, 0), 0.5, '量不出左栏高:对半')
  assert.equal(
    clampDockRatio(0.5, 120),
    DOCK_MIN_HEIGHT / 120,
    '左栏矮到两边都放不下:以大纲最小高为准'
  )
  assert.equal(clampDockRatio(Number.NaN, room), DOCK_MIN_HEIGHT / room, '脏数值按最小高兜底')
}

checkIds()
checkCollect()
checkDepthsAndSpy()
checkDockDecision()
checkDockRatio()
checkPlacement()
checkCollapsedClamp()
checkContentWidth()
checkContentHeight()
checkDragThreshold()
checkBarRoom()
checkKnobReserve()
checkPaneOrigin()
console.log('✅ 文档大纲自测全部通过')
console.log(
  '   编号(中英文/重名/兜底) · 收标题(级别/顺序/只认真标题) · 缩进档 · 读线跟随 · 无标题无大纲 · 停靠让位判定(四条缺一不让) · 停靠分割线比例夹边(大纲最小高/树留底/量不出回对半) · 浮窗摆放(验身/夹边/拖动/收起态按圆钮尺寸夹边/圆钮位移预留/右下角拉伸/宽高吸回内容尺寸/原点在面板顶能压页头)'
)
