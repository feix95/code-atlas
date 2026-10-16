// UI 工作台画板(Frame)自测:画板节点、对象树(父子/树序/继承的隐藏与锁定)、命中与归属、
// 克隆带后代、按画板导出文档。文档仓库是模块单例,本文件独占一个进程。
import assert from 'node:assert/strict'
import { artboardCss, nodesCss } from '../src/shared/uiWorkbench/export/cssAdapter.ts'
import { frameDocument, pageExportTargets } from '../src/shared/uiWorkbench/export/frameDocument.ts'
import { pageLayout } from '../src/shared/uiWorkbench/export/pageLayout.ts'
import { toSvg } from '../src/shared/uiWorkbench/export/svgAdapter.ts'
import {
  applyFramePatch,
  createFrame,
  FRAME_DEFAULT_FILL
} from '../src/shared/uiWorkbench/frame.ts'
import { layerTreeReorderIndex, layerTreeRows } from '../src/shared/uiWorkbench/layers.ts'
import { samePages } from '../src/shared/uiWorkbench/history.ts'
import { createLine } from '../src/shared/uiWorkbench/line.ts'
import { createRect } from '../src/shared/uiWorkbench/node.ts'
import { createPage } from '../src/shared/uiWorkbench/page.ts'
import {
  applyNodeAction,
  hitTopmost,
  nodeBox,
  pickableNodes,
  translatePatch,
  visibleNodes,
  type SceneNode
} from '../src/shared/uiWorkbench/scene.ts'
import {
  childrenOf,
  cloneNodes,
  cloneTrees,
  movableSelection,
  contextFrame,
  frameAt,
  hiddenIds,
  lockedIds,
  nearestFrame,
  reparentPatches,
  selectionRoots,
  siblingReorderIndex,
  subtreeIds,
  topLevelFrameIds,
  treeOrder,
  validParentId,
  withDescendants
} from '../src/shared/uiWorkbench/tree.ts'
import { docActions, getDocState } from '../src/renderer/src/uiWorkbench/documentStore.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

const BOX = { x: 0, y: 0, width: 10, height: 10 }
const ids = (nodes: readonly SceneNode[]): string[] => nodes.map((n) => n.id)
const rect = (
  existing: readonly SceneNode[],
  box: { x: number; y: number; width: number; height: number },
  parentId: string | null = null
): SceneNode => ({ ...createRect(existing, box), parentId })

/** 样例页:frame-1(0,0,200×200) 里有 rect-1、line-1;frame-1 里嵌套 frame-2(50,50,100×100) 里有 rect-2;
 *  页面上另有散放的 rect-3(300,0) */
function sample(): SceneNode[] {
  const f1 = createFrame([], { x: 0, y: 0, width: 200, height: 200 })
  const r1 = rect([f1], { x: 10, y: 10, width: 20, height: 20 }, f1.id)
  const l1: SceneNode = {
    ...createLine([], { x1: 0, y1: 0, x2: 100, y2: 0 }),
    parentId: f1.id
  }
  const f2 = createFrame([f1], { x: 50, y: 50, width: 100, height: 100 }, f1.id)
  const r2 = rect([f1, r1], { x: 60, y: 60, width: 10, height: 10 }, f2.id)
  const r3 = rect([f1, r1, r2], { x: 300, y: 0, width: 20, height: 20 })
  return [f1, r1, l1, f2, r2, r3]
}

check('画板节点:id/名字序号、默认白填充;固定不旋转无圆角无描边不挂样式', () => {
  const f1 = createFrame([], { x: 0, y: 0, width: 390, height: 844 })
  assert.equal(f1.id, 'frame-1')
  assert.equal(f1.name, '画板 1')
  assert.equal(f1.fill, FRAME_DEFAULT_FILL)
  assert.equal(createFrame([f1], { x: 0, y: 0, width: 1, height: 1 }).id, 'frame-2')
  assert.equal(createFrame([{ id: 'frame-5' }], { x: 0, y: 0, width: 1, height: 1 }).id, 'frame-6')
  const patched = applyFramePatch(f1, {
    rotation: 45,
    radii: [9, 9, 9, 9],
    stroke: { color: '#000000', width: 3, style: 'solid' },
    styleId: 's1',
    width: 0,
    height: 99999,
    fill: 'ABC'
  } as never)
  assert.equal(patched.rotation, 0)
  assert.deepEqual(patched.radii, [0, 0, 0, 0])
  assert.equal(patched.stroke, null)
  assert.equal(patched.styleId, null)
  assert.equal(patched.width, 1)
  assert.equal(patched.height, 8192)
  assert.equal(patched.fill, '#aabbcc')
  assert.equal(patched.type, 'frame')
})

check('树序:同级按数组序,后代紧跟容器;悬空/指向非画板的 parentId 当作直接在页面上', () => {
  const nodes = sample()
  assert.deepEqual(ids(treeOrder(nodes)), [
    'frame-1',
    'rect-1',
    'line-1',
    'frame-2',
    'rect-2',
    'rect-3'
  ])
  const orphan = { ...nodes[5], parentId: 'ghost' }
  assert.equal(childrenOf([...nodes.slice(0, 5), orphan], null).length, 2)
  const underRect = { ...nodes[5], parentId: 'rect-1' }
  assert.ok(ids(childrenOf([...nodes.slice(0, 5), underRect], null)).includes('rect-3'))
  assert.deepEqual([...topLevelFrameIds(nodes)], ['frame-1'])
})

check('子树:自己加全部后代;withDescendants 去重按数组序;选集根只留父级不在选集的', () => {
  const nodes = sample()
  assert.deepEqual(subtreeIds(nodes, 'frame-1').sort(), [
    'frame-1',
    'frame-2',
    'line-1',
    'rect-1',
    'rect-2'
  ])
  assert.deepEqual(subtreeIds(nodes, 'rect-3'), ['rect-3'])
  assert.deepEqual(ids(withDescendants(nodes, ['frame-2', 'frame-1'])), [
    'frame-1',
    'rect-1',
    'line-1',
    'frame-2',
    'rect-2'
  ])
  assert.deepEqual(ids(selectionRoots(nodes, ['frame-1', 'rect-1', 'rect-3'])), [
    'frame-1',
    'rect-3'
  ])
  assert.deepEqual(ids(selectionRoots(nodes, ['rect-1', 'rect-2'])), ['rect-1', 'rect-2'])
})

check('隐藏与锁定向后代继承', () => {
  const nodes = sample().map((n) => (n.id === 'frame-1' ? { ...n, visible: false } : n))
  assert.deepEqual([...hiddenIds(nodes)].sort(), [
    'frame-1',
    'frame-2',
    'line-1',
    'rect-1',
    'rect-2'
  ])
  assert.deepEqual(ids(visibleNodes(nodes)), ['rect-3'])
  const locked = sample().map((n) => (n.id === 'frame-2' ? { ...n, locked: true } : n))
  assert.deepEqual([...lockedIds(locked)].sort(), ['frame-2', 'rect-2'])
  assert.deepEqual(ids(pickableNodes(locked)).sort(), ['frame-1', 'line-1', 'rect-1', 'rect-3'])
})

check('最近画板/当前操作画板:选中对象所在画板,没选中取第一个可见顶层画板,没画板为 null', () => {
  const nodes = sample()
  assert.equal(nearestFrame(nodes, 'rect-2')?.id, 'frame-2')
  assert.equal(nearestFrame(nodes, 'frame-2')?.id, 'frame-2')
  assert.equal(nearestFrame(nodes, 'rect-3'), null)
  assert.equal(contextFrame(nodes, ['rect-1'])?.id, 'frame-1')
  assert.equal(contextFrame(nodes, ['rect-3', 'rect-2'])?.id, 'frame-2', '取第一个有画板的选中项')
  assert.equal(contextFrame(nodes, [])?.id, 'frame-1')
  assert.equal(contextFrame(nodes, ['rect-3'])?.id, 'frame-1', '选中的不在画板里就取第一个画板')
  const hiddenFirst = nodes.map((n) => (n.id === 'frame-1' ? { ...n, visible: false } : n))
  assert.equal(contextFrame(hiddenFirst, []), null)
  assert.equal(contextFrame([nodes[5]], []), null)
})

check('点落在哪个画板:取最上层(最内层)、可见、不在排除集里的', () => {
  const nodes = sample()
  assert.equal(frameAt(nodes, { x: 60, y: 60 })?.id, 'frame-2')
  assert.equal(frameAt(nodes, { x: 10, y: 150 })?.id, 'frame-1')
  assert.equal(frameAt(nodes, { x: 500, y: 500 }), null)
  assert.equal(frameAt(nodes, { x: 60, y: 60 }, new Set(['frame-2']))?.id, 'frame-1')
  const hidden = nodes.map((n) => (n.id === 'frame-2' ? { ...n, visible: false } : n))
  assert.equal(frameAt(hidden, { x: 60, y: 60 })?.id, 'frame-1')
})

check('命中:顶层画板底面点不中(选它靠名签),嵌套画板与后代照常命中,后代压在容器之上', () => {
  const nodes = sample()
  assert.equal(hitTopmost(nodes, { x: 190, y: 190 }, 1), null, '顶层画板空白处不命中')
  assert.equal(hitTopmost(nodes, { x: 15, y: 15 }, 1)?.id, 'rect-1')
  assert.equal(hitTopmost(nodes, { x: 140, y: 140 }, 1)?.id, 'frame-2', '嵌套画板空白处命中它自己')
  assert.equal(hitTopmost(nodes, { x: 65, y: 65 }, 1)?.id, 'rect-2')
  assert.equal(hitTopmost(nodes, { x: 310, y: 10 }, 1)?.id, 'rect-3')
  const lockedFrame = nodes.map((n) => (n.id === 'frame-2' ? { ...n, locked: true } : n))
  assert.equal(hitTopmost(lockedFrame, { x: 65, y: 65 }, 1), null, '容器锁定,后代也点不中')
})

check('命令:删画板连后代一起删;add/update 的 parentId 校验(不存在、非画板、自己、子孙)', () => {
  const nodes = sample()
  assert.deepEqual(ids(applyNodeAction(nodes, { type: 'remove', id: 'frame-2' })), [
    'frame-1',
    'rect-1',
    'line-1',
    'rect-3'
  ])
  assert.deepEqual(ids(applyNodeAction(nodes, { type: 'remove', id: 'frame-1' })), ['rect-3'])
  const added = applyNodeAction(nodes, {
    type: 'add',
    node: { ...rect(nodes, { x: 0, y: 0, width: 5, height: 5 }), parentId: 'ghost' }
  })
  assert.equal(added.at(-1)?.parentId, null)
  const toFrame = applyNodeAction(nodes, {
    type: 'update',
    id: 'rect-3',
    patch: { parentId: 'frame-2' }
  })
  assert.equal(toFrame.find((n) => n.id === 'rect-3')?.parentId, 'frame-2')
  for (const bad of ['rect-1', 'ghost', 'rect-3']) {
    const r = applyNodeAction(nodes, { type: 'update', id: 'rect-3', patch: { parentId: bad } })
    assert.equal(r.find((n) => n.id === 'rect-3')?.parentId, null, `非法父级 ${bad} 退回页面`)
  }
  const cycle = applyNodeAction(nodes, {
    type: 'update',
    id: 'frame-1',
    patch: { parentId: 'frame-2' }
  })
  assert.equal(cycle.find((n) => n.id === 'frame-1')?.parentId, null, '不能挂到自己的子孙下')
  assert.equal(validParentId(nodes, 'rect-3', 'frame-1'), 'frame-1')
  assert.equal(validParentId(nodes, 'rect-3', null), null)
})

check('松手后重新归属:按中心点落在哪个画板;没变的不出补丁;排除自己的子树', () => {
  const nodes = sample()
  const moved = nodes.map((n) => (n.id === 'rect-3' ? { ...n, x: 20, y: 120 } : n))
  assert.deepEqual(reparentPatches(moved, ['rect-3']), [{ id: 'rect-3', parentId: 'frame-1' }])
  assert.deepEqual(reparentPatches(nodes, ['rect-1', 'rect-2', 'rect-3']), [])
  const out = nodes.map((n) => (n.id === 'rect-1' ? { ...n, x: 400, y: 400 } : n))
  assert.deepEqual(reparentPatches(out, ['rect-1']), [{ id: 'rect-1', parentId: null }])
  const overOwn = nodes.map((n) =>
    n.id === 'frame-2' ? { ...n, x: 0, y: 0, width: 200, height: 200 } : n
  )
  assert.deepEqual(reparentPatches(overOwn, ['frame-2']), [], '落在自己父画板内,父级不变')
})

check('同级调序下标:按同级位置换算成数组下标,越界钳两端,独生子不动', () => {
  const nodes = sample()
  // frame-1 的直接子:rect-1 line-1 frame-2
  const toTop = applyNodeAction(nodes, {
    type: 'reorder',
    id: 'rect-1',
    toIndex: siblingReorderIndex(nodes, 'rect-1', 99)
  })
  assert.deepEqual(
    ids(childrenOf(toTop, 'frame-1')),
    ['line-1', 'frame-2', 'rect-1'],
    '拖到同级最上层'
  )
  const toBottom = applyNodeAction(nodes, {
    type: 'reorder',
    id: 'frame-2',
    toIndex: siblingReorderIndex(nodes, 'frame-2', -3)
  })
  assert.deepEqual(ids(childrenOf(toBottom, 'frame-1')), ['frame-2', 'rect-1', 'line-1'])
  assert.equal(siblingReorderIndex(nodes, 'rect-2', 0), nodes.indexOf(nodes[4]), '独生子原位')
  const pageLevel = applyNodeAction(nodes, {
    type: 'reorder',
    id: 'rect-3',
    toIndex: siblingReorderIndex(nodes, 'rect-3', 0)
  })
  assert.deepEqual(ids(childrenOf(pageLevel, null)), ['rect-3', 'frame-1'])
})

check('克隆带后代:每个重编 id,父子关系接到新 id,父级不在这批里的保持原父级', () => {
  const nodes = sample()
  const subtree = withDescendants(nodes, ['frame-1'])
  const made = cloneNodes(subtree, nodes, { x: 500, y: 0 })
  assert.equal(made.length, 5)
  assert.deepEqual(ids(made), ['frame-3', 'rect-4', 'line-2', 'frame-4', 'rect-5'])
  assert.equal(made[0].parentId, null)
  assert.equal(made[1].parentId, 'frame-3')
  assert.equal(made[3].parentId, 'frame-3', '嵌套画板的新父级是新外层画板')
  assert.equal(made[4].parentId, 'frame-4')
  assert.equal((made[0] as { x: number }).x, 500)
  const alone = cloneNodes([nodes[1]], nodes, { x: 10, y: 10 })
  assert.equal(alone[0].parentId, 'frame-1', '只复制一个后代,新副本仍在原画板里')
})

check('整组移动集:选集的根(去掉锁定)+ 全部后代;选了画板与它的后代只算根', () => {
  const nodes = sample()
  const m = movableSelection(nodes, ['frame-1', 'rect-1', 'rect-3'])
  assert.deepEqual(ids(m.roots), ['frame-1', 'rect-3'])
  assert.deepEqual(ids(m.all), ['frame-1', 'rect-1', 'line-1', 'frame-2', 'rect-2', 'rect-3'])
  const locked = nodes.map((n) => (n.id === 'frame-1' ? { ...n, locked: true } : n))
  assert.deepEqual(
    ids(movableSelection(locked, ['frame-1', 'rect-1']).roots),
    [],
    '祖先锁定则后代也不动'
  )
})

check('克隆若干棵树:父先于子,返回根副本 id,画板内后代随根平移', () => {
  const nodes = sample()
  // 故意把子节点排在容器前面,验证按树序克隆
  const scrambled = [nodes[1], nodes[0], nodes[5]]
  const r = cloneTrees(scrambled, ['frame-1', 'rect-3'], nodes, { x: 10, y: 0 })
  assert.deepEqual(ids(r.made), ['frame-3', 'rect-4', 'rect-5'])
  assert.deepEqual(r.rootIds.sort(), ['frame-3', 'rect-5'])
  assert.equal(r.made[1].parentId, 'frame-3')
})

check('页面导出清单:每个可见顶层画板一份,隐藏的与散放对象不导', () => {
  const nodes = sample()
  const extra = createFrame(nodes, { x: 400, y: 0, width: 50, height: 60 })
  const all = [...nodes, extra]
  const targets = pageExportTargets(all)
  assert.deepEqual(
    targets.map((t) => t.frameId),
    ['frame-1', extra.id]
  )
  assert.deepEqual(targets[1].doc.artboard, { width: 50, height: 60 })
  const hidden = all.map((n) => (n.id === extra.id ? { ...n, visible: false } : n))
  assert.deepEqual(
    pageExportTargets(hidden).map((t) => t.frameId),
    ['frame-1']
  )
  assert.deepEqual(pageExportTargets([nodes[5]]), [])
})

check('图层树行:同级上层在前,后代缩进跟在容器下,折叠的画板不展开', () => {
  const nodes = sample()
  const rows = layerTreeRows(nodes)
  assert.deepEqual(
    rows.map((r) => [r.node.id, r.depth]),
    [
      ['rect-3', 0],
      ['frame-1', 0],
      ['frame-2', 1],
      ['rect-2', 2],
      ['line-1', 1],
      ['rect-1', 1]
    ]
  )
  assert.equal(rows[1].hasChildren && rows[1].isExpanded, true)
  const folded = layerTreeRows(nodes, new Set(['frame-1']))
  assert.deepEqual(ids(folded.map((r) => r.node)), ['rect-3', 'frame-1'])
  assert.equal(folded[1].isExpanded, false)
})

check('图层树调序:只在同级兄弟间换位,换算成数组下标;原地不动返回 null', () => {
  const nodes = sample()
  const rows = layerTreeRows(nodes)
  // 把 rect-1(最底层兄弟,第 5 行)拖到 frame-2 上方(槽位 2):成为 frame-1 内最上层
  const toTop = layerTreeReorderIndex(nodes, rows, 5, 2)
  assert.notEqual(toTop, null)
  const moved = applyNodeAction(nodes, { type: 'reorder', id: 'rect-1', toIndex: toTop as number })
  assert.deepEqual(ids(childrenOf(moved, 'frame-1')), ['line-1', 'frame-2', 'rect-1'])
  // 落在自己上下缝 = 原地
  assert.equal(layerTreeReorderIndex(nodes, rows, 5, 5), null)
  assert.equal(layerTreeReorderIndex(nodes, rows, 5, 6), null)
  // 页面级:把 frame-1(第 1 行)拖到最上(槽位 0),与 rect-3 换位
  const top = layerTreeReorderIndex(nodes, rows, 1, 0)
  const page = applyNodeAction(nodes, { type: 'reorder', id: 'frame-1', toIndex: top as number })
  assert.deepEqual(ids(childrenOf(page, null)), ['rect-3', 'frame-1'])
})

check('画板与直线的通用几何:外接框、平移', () => {
  const frame = createFrame([], { x: 10, y: 20, width: 30, height: 40 })
  assert.deepEqual(nodeBox(frame), { x: 10, y: 20, width: 30, height: 40 })
  assert.deepEqual(translatePatch(frame, 5, -5), { x: 15, y: 15 })
})

check('按画板导出:取画板尺寸与填充,后代平移到画板原点,隐藏的不导', () => {
  const nodes = sample()
  const doc = frameDocument(nodes, 'frame-1')
  assert.ok(doc)
  assert.deepEqual(doc.artboard, { width: 200, height: 200 })
  assert.equal(doc.artboardFill, '#ffffff')
  assert.deepEqual(ids(doc.nodes), ['rect-1', 'line-1', 'frame-2', 'rect-2'])
  const inner = frameDocument(nodes, 'frame-2')
  assert.ok(inner)
  assert.deepEqual(ids(inner.nodes), ['rect-2'])
  assert.deepEqual(
    inner.nodes.map((n) => (n.type === 'rect' ? [n.x, n.y] : null)),
    [[10, 10]],
    'rect-2 原在页面 (60,60),画板在 (50,50)'
  )
  assert.equal(frameDocument(nodes, 'rect-3'), null)
  assert.equal(frameDocument(nodes, 'nope'), null)
  const hidden = nodes.map((n) => (n.id === 'rect-1' ? { ...n, visible: false } : n))
  assert.deepEqual(ids(frameDocument(hidden, 'frame-1')!.nodes), ['line-1', 'frame-2', 'rect-2'])
  assert.equal(
    frameDocument(
      nodes.map((n) => (n.id === 'frame-1' ? { ...n, visible: false } : n)),
      'frame-1'
    ),
    null
  )
})

check('导出口径:画板填充进 CSS/SVG(null = 透明),同屏多画板可换根类名,散放节点单独出规则', () => {
  const base = { artboard: { width: 10, height: 10 }, nodes: [] }
  assert.ok(artboardCss(base).includes('background: #ffffff;'))
  assert.ok(artboardCss({ ...base, artboardFill: '#112233' }).includes('background: #112233;'))
  assert.ok(artboardCss({ ...base, artboardFill: null }).includes('background: transparent;'))
  assert.ok(artboardCss(base, 'frame-box-1').startsWith('.frame-box-1 {'))
  assert.ok(toSvg({ ...base, artboardFill: '#112233' }).includes('fill="#112233"'))
  assert.ok(!toSvg({ ...base, artboardFill: null }).includes('<rect width'))
  const loose = rect([], { x: 5, y: 6, width: 7, height: 8 })
  assert.ok(nodesCss([loose]).includes('.rect-1 {'))
  assert.ok(nodesCss([loose]).includes('left: 5px;'))
})

check('整页布局:顶层按数组序出画板/散放项;画板带后代清单与独立类名;隐藏的不出', () => {
  const nodes = sample()
  const layout = pageLayout(nodes)
  assert.deepEqual(
    layout.items.map((i) => [i.id, i.rootClass]),
    [
      ['frame-1', 'frame-box-frame-1'],
      ['rect-3', null]
    ]
  )
  assert.deepEqual(layout.items[0].childIds, ['rect-1', 'line-1', 'frame-2', 'rect-2'])
  assert.deepEqual([layout.items[0].x, layout.items[0].y], [0, 0])
  assert.ok(layout.css.includes('.frame-box-frame-1 {'))
  assert.ok(layout.css.includes('.rect-3 {'))
  assert.ok(layout.css.includes('left: 300px;'), '散放节点用页面坐标')
  assert.ok(layout.css.includes('.rect-2 {'))
  const moved = nodes.map((n) => (n.id === 'frame-1' ? { ...n, x: 100, y: 50 } : n))
  const movedLayout = pageLayout(moved)
  assert.deepEqual([movedLayout.items[0].x, movedLayout.items[0].y], [100, 50])
  assert.ok(!movedLayout.css.includes('left: 160px;'), '后代按画板内坐标出,挪画板不改后代规则')
  const hidden = nodes.map((n) => (n.id === 'frame-1' ? { ...n, visible: false } : n))
  assert.deepEqual(
    pageLayout(hidden).items.map((i) => i.id),
    ['rect-3']
  )
  assert.equal(pageLayout([]).items.length, 0)
})

check('samePages:父级变化算改动', () => {
  const nodes = sample()
  const a = { ...createPage([]), nodes }
  const b = {
    ...a,
    nodes: nodes.map((n) => (n.id === 'rect-3' ? { ...n, parentId: 'frame-1' } : n))
  }
  assert.ok(!samePages([a], [b]))
  assert.ok(samePages([a], [{ ...a, nodes: [...nodes] }]))
})

check('文档仓库:删画板连后代,选集清掉整棵子树;撤销整棵回来;隐藏画板同样退选后代', () => {
  const doc = docActions
  doc.resetDocument(false)
  const f = createFrame([], { x: 0, y: 0, width: 100, height: 100 })
  doc.dispatch({ type: 'add', node: f })
  const r = rect(getDocState().nodes, { x: 5, y: 5, width: 10, height: 10 }, f.id)
  doc.dispatch({ type: 'add', node: r })
  doc.selectIds([f.id, r.id])
  doc.dispatch({ type: 'update', id: f.id, patch: { visible: false } })
  assert.deepEqual(getDocState().selectedIds, [], '隐藏画板:自己与后代都退选')
  doc.undo()
  doc.selectIds([f.id, r.id])
  doc.dispatch({ type: 'remove', id: f.id })
  assert.equal(getDocState().nodes.length, 0)
  assert.deepEqual(getDocState().selectedIds, [])
  doc.undo()
  assert.deepEqual(ids(getDocState().nodes), [f.id, r.id])
  assert.equal(getDocState().nodes[1].parentId, f.id)
})

check('resetDocument:换成全新文档,清撤销栈与选中;默认带预置画板', () => {
  const doc = docActions
  doc.dispatch({ type: 'add', node: createFrame(getDocState().nodes, BOX) })
  doc.resetDocument()
  const s = getDocState()
  assert.equal(s.canUndo, false)
  assert.equal(s.canRedo, false)
  assert.deepEqual(s.selectedIds, [])
  assert.deepEqual(ids(s.nodes), ['frame-1'])
  assert.equal(s.pages.length, 1)
})

console.log('UI 工作台画板自测全部通过')
