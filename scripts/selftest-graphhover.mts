// 关系图谱模块颜色 token 与滚轮悬停看法的纯函数自测:全局颜色序号与生成色、改色存档清洗、
// 悬停看法的切换与点亮范围、滚轮手势的意图判定(缩放 / 切看法 / 层级翻页与进出)与防误触、
// 悬停命中(展开容器只作背景)与悬停出详情的候选判定、拖拽保持抓取点不瞬移、空格与右键平移手势判定。
import assert from 'node:assert/strict'
import {
  isHexColor,
  MAX_OVERRIDES_PER_ROOT,
  sanitizeColorPrefs,
  setColorIn
} from '../src/renderer/src/graph/colorPrefs.ts'
import {
  generatedHue,
  moduleColor,
  moduleSwatchCss
} from '../src/renderer/src/graph/moduleColors.ts'
import {
  hoverModesFor,
  hoverRelated,
  isHoverLink,
  stepHoverMode
} from '../src/renderer/src/graph/hoverModes.ts'
import {
  levelWheelAction,
  nextGesture,
  takeSteps,
  wheelDeltaPx
} from '../src/renderer/src/graph/wheelIntent.ts'
import {
  GRAPH_LABEL,
  GRAPH_MODULE_COLORS,
  GRAPH_TIP,
  GRAPH_WHEEL
} from '../src/renderer/src/graph/graphConfig.ts'
import { nodeTipText, tipPlacement } from '../src/renderer/src/graph/nodeTip.ts'
import {
  dragCenterAt,
  grabOffsetAt,
  hoverNodeOf,
  panGestureAt
} from '../src/renderer/src/graph/graphHit.ts'
import { detailNodeOf } from '../src/renderer/src/graph/useGraphHoverDetail.ts'
import type { HoverTarget } from '../src/renderer/src/graph/useGraphViewport.ts'
import type { LevelNode } from '../src/shared/graphView.ts'

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
    sanitizeColorPrefs({ r: { a: '#AABBCC', b: 'red', c: 1 }, bad: [1], empty: {} }),
    { r: { a: '#aabbcc' } },
    '存档清洗:只留合法 #rrggbb,统一小写,空项目丢掉'
  )
  assert.deepEqual(sanitizeColorPrefs('x'), {})
  assert.deepEqual(sanitizeColorPrefs(null), {})
  let prefs = setColorIn({}, 'r', 'm:a', '#FF0000')
  assert.deepEqual(prefs, { r: { 'm:a': '#ff0000' } })
  prefs = setColorIn(prefs, 'r2', 'm:a', '#00ff00')
  assert.equal(prefs.r['m:a'], '#ff0000', '每个项目分开存')
  prefs = setColorIn(prefs, 'r', 'm:a', null)
  assert.equal(prefs.r, undefined, '恢复默认后项目没有改色就整项删掉')
  assert.deepEqual(setColorIn({}, 'r', 'm:a', 'nope'), {}, '非法颜色当恢复默认')
  let big = {}
  for (let i = 0; i <= MAX_OVERRIDES_PER_ROOT; i++) big = setColorIn(big, 'r', `m:${i}`, '#000000')
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

  assert.deepEqual(
    levelWheelAction('blank', -1, false, null),
    { kind: 'expandAll' },
    'Ctrl+滚轮空白处往上滚 = 展开二级'
  )
  assert.deepEqual(
    levelWheelAction('blank', 1, false, null),
    { kind: 'collapseAll' },
    '根层空白处往下滚 = 收起二级'
  )
  assert.deepEqual(
    levelWheelAction('blank', 1, true, null),
    { kind: 'leave' },
    '文件夹里空白处往下滚 = 返回上一层'
  )
  assert.deepEqual(
    levelWheelAction('folder', -1, false, null),
    { kind: 'expandFolder' },
    '没展开的文件夹上往上滚 = 原地展开,不进文件夹'
  )
  assert.deepEqual(
    levelWheelAction('container', -1, false, null),
    { kind: 'none' },
    '已经展开的圈上往上滚不再进入,也没有可展开的'
  )
  assert.deepEqual(
    levelWheelAction('door', -1, false, null),
    { kind: 'enter' },
    '外部文件夹与「其余 N 项」只能进入,上滚保持进入'
  )
  assert.deepEqual(
    levelWheelAction('folder', 1, true, null),
    { kind: 'leave' },
    '文件夹里不在圈中往下滚 = 返回上一层'
  )
  assert.deepEqual(
    levelWheelAction('folder', 1, false, null),
    { kind: 'collapseAll' },
    '根层不在圈中往下滚 = 全部收起'
  )
  assert.deepEqual(
    levelWheelAction('container', 1, false, 'pkg'),
    { kind: 'collapseContainer', id: 'pkg' },
    '根层对着圈往下滚 = 收起这个圈'
  )
  assert.deepEqual(
    levelWheelAction('container', 1, true, 'pkg'),
    { kind: 'collapseContainer', id: 'pkg' },
    '文件夹里对着圈往下滚 = 先收圈,不退焦点层'
  )
  assert.deepEqual(
    levelWheelAction('file', -1, true, 'pkg'),
    { kind: 'none' },
    'Ctrl+滚轮文件上往上滚 = 不动作'
  )
  assert.deepEqual(
    levelWheelAction('file', 1, true, 'pkg'),
    { kind: 'collapseContainer', id: 'pkg' },
    '圈里的文件上往下滚也收所在的圈,不用瞄准圈中空地'
  )
  assert.deepEqual(
    levelWheelAction('file', 1, true, null),
    { kind: 'leave' },
    '圈外文件上往下滚 = 返回上一层'
  )
  assert.deepEqual(
    levelWheelAction('file', 1, false, null),
    { kind: 'collapseAll' },
    '根层圈外任何落点都能退,不留死区'
  )
}

function checkNodeTip(): void {
  const node = (kind: LevelNode['kind'], extra: Partial<LevelNode> = {}): LevelNode => ({
    id: 'src/graph.ts',
    kind,
    label:
      kind === 'file'
        ? 'graph.ts'
        : kind === 'folder'
          ? 'src'
          : kind === 'overflow'
            ? '其余 7 项'
            : 'shared',
    degree: 3,
    descendantFiles: kind === 'folder' ? 12 : 0,
    ...extra
  })
  const signals = {
    hasModules: true,
    moduleName: '图谱 · graphView.ts'
  }
  const longName = 'a'.repeat(GRAPH_LABEL.maxChars + 1)

  assert.deepEqual(
    nodeTipText(node('file'), signals),
    { title: '', sub: '属于 图谱 · graphView.ts' },
    '短文件名画布上已看全,只补一句所属模块'
  )
  assert.deepEqual(
    nodeTipText(node('file', { id: 'README.md', label: 'README.md' }), {
      ...signals,
      moduleName: null
    }),
    { title: '', sub: '未归类' },
    '没有归属模块的文件说未归类'
  )
  assert.equal(
    nodeTipText(node('file'), { ...signals, hasModules: false, moduleName: null }),
    null,
    '模块数据不可用且名字没截断:没有可补的信息,不弹提示'
  )
  assert.deepEqual(
    nodeTipText(node('file', { label: longName }), {
      ...signals,
      hasModules: false,
      moduleName: null
    }),
    { title: longName, sub: '' },
    '只有名字被截断时也弹提示补全'
  )
  assert.deepEqual(
    nodeTipText(node('file', { label: longName }), signals),
    { title: longName, sub: '属于 图谱 · graphView.ts' },
    '名字超过画布上限:标题给全名,模块照常说明'
  )

  assert.equal(nodeTipText(node('folder'), signals), null, '文件夹不弹提示')
  assert.equal(
    nodeTipText(node('folder'), { hasModules: false, moduleName: null }),
    null,
    '没有模块数据时文件夹同样不弹提示'
  )

  assert.deepEqual(
    nodeTipText(node('external', { target: 'folder' }), signals),
    { title: '', sub: '当前文件夹之外' },
    '外部节点:短名只说明它不在当前文件夹里'
  )
  assert.deepEqual(
    nodeTipText(node('external', { label: longName, target: 'folder' }), signals),
    { title: longName, sub: '当前文件夹之外' },
    '外部节点名字被截断时补全'
  )
  assert.deepEqual(
    nodeTipText(node('overflow', { hiddenCount: 7, groupId: 'src' }), signals),
    { title: '', sub: '双击进入查看全部' },
    '收起的项说明进入动作'
  )

  const view = { w: 800, h: 600 }
  const size = { w: 160, h: 40 }
  const { gapPx, edgePx } = GRAPH_TIP
  assert.deepEqual(
    tipPlacement({ x: 400, y: 300, r: 10 }, size, view),
    { left: 320, top: 300 - 10 - gapPx - 40, side: 'top' },
    '上方有位置:贴在节点上沿、水平居中'
  )
  const nearTop = tipPlacement({ x: 400, y: 20, r: 10 }, size, view)
  assert.equal(nearTop.side, 'bottom', '贴着画布上边:翻到节点下方')
  assert.equal(nearTop.top, 20 + 10 + gapPx)
  const nearBottom = tipPlacement({ x: 400, y: 595, r: 10 }, size, { w: 800, h: 600 })
  assert.ok(nearBottom.top <= 600 - edgePx - size.h, '贴着下边:气泡不越出画布')
  assert.equal(tipPlacement({ x: 5, y: 300, r: 10 }, size, view).left, edgePx, '左边越界:夹回画布')
  assert.equal(
    tipPlacement({ x: 795, y: 300, r: 10 }, size, view).left,
    800 - edgePx - 160,
    '右边越界:夹回画布'
  )
  const tiny = tipPlacement({ x: 20, y: 20, r: 5 }, size, { w: 100, h: 60 })
  assert.ok(tiny.left >= edgePx && tiny.top >= edgePx, '画布比气泡还窄:落在左上角,不出负数')
}

function checkHoverTarget(): void {
  const nodeOf = (isContainer?: boolean): { data: { isContainer?: boolean } } => ({
    data: isContainer === undefined ? {} : { isContainer }
  })
  const file = nodeOf()
  const folder = nodeOf(false)
  assert.equal(hoverNodeOf(file), file, '普通节点照常悬停')
  assert.equal(hoverNodeOf(folder), folder, '显式非容器的文件夹照常悬停')
  assert.equal(hoverNodeOf(nodeOf(true)), null, '圆圈是背景:悬停圈内空白处不算悬停节点')
  assert.equal(hoverNodeOf(null), null, '指针不在任何节点上')
}

function checkDragGrab(): void {
  const node = { x: 100, y: 50 }
  // 按在容器圆的右下边缘:拖起来后圆心只跟着位移走,不瞬移到指针下
  const grab = grabOffsetAt(node, 130, 70)
  assert.deepEqual(dragCenterAt(grab, 130, 70), node, '还没移动时圆心原地不动')
  assert.deepEqual(dragCenterAt(grab, 200, 120), { x: 170, y: 100 }, '拖拽位移与指针一致')
  const centerGrab = grabOffsetAt(node, 100, 50)
  assert.deepEqual(dragCenterAt(centerGrab, 145, 80), { x: 145, y: 80 }, '按在圆心时照旧跟随指针')
}

function checkPanGesture(): void {
  assert.equal(panGestureAt(2, false), 'right', '右键按下直接平移,不必先找空白')
  assert.equal(panGestureAt(2, true), 'right', '按住空格时右键仍是右键手势')
  assert.equal(panGestureAt(0, true), 'space', '按住空格 + 左键平移,圆上也能起拖')
  assert.equal(panGestureAt(0, false), null, '不按空格时左键照常命中节点或空白')
  assert.equal(panGestureAt(1, true), null, '中键不参与平移')
}

function checkHoverDetail(): void {
  const hoverOf = (kind: LevelNode['kind'], dragging = false): HoverTarget => {
    const data = {
      id: `src/${kind}`,
      kind,
      label: kind,
      degree: 1,
      descendantFiles: 0,
      depth: 1
    }
    return {
      node: { id: data.id, data, depth: 0, r: 5, parent: null, x: 0, y: 0 },
      x: 100,
      y: 100,
      r: 5,
      dragging
    }
  }
  const file = hoverOf('file')
  assert.equal(detailNodeOf(file), file.node.data, '悬停文件:可开详情')
  const folder = hoverOf('folder')
  assert.equal(detailNodeOf(folder), folder.node.data, '悬停文件夹:可开详情')
  assert.equal(detailNodeOf(hoverOf('overflow')), null, '收起的项是一扇门,不弹详情')
  assert.equal(detailNodeOf(hoverOf('file', true)), null, '拖拽中的节点不弹详情')
  assert.equal(detailNodeOf(null), null, '没有悬停目标时不弹详情')
}

checkColors()
checkHoverModes()
checkWheel()
checkNodeTip()
checkHoverTarget()
checkDragGrab()
checkPanGesture()
checkHoverDetail()
console.log('selftest-graphhover: 全部通过')
