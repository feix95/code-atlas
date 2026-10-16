// UI 工作台 Page / 图层的纯逻辑与文档仓库自测:页面增删改与继承、图层显隐锁定改名、z 序调整、
// 撤销跨页跳回、切页不入账。文档仓库是模块单例,本文件独占一个进程,用例按顺序累积状态。
import assert from 'node:assert/strict'
import { samePages } from '../src/shared/uiWorkbench/history.ts'
import {
  layerDisplayOrder,
  layerReorderIndex,
  rowDropPosition,
  slotFromPointer
} from '../src/shared/uiWorkbench/layers.ts'
import { createLine } from '../src/shared/uiWorkbench/line.ts'
import { createRect, NAME_MAX_LENGTH, sanitizeName } from '../src/shared/uiWorkbench/node.ts'
import {
  activeAfterRemove,
  createPage,
  defaultPageBackground,
  PAGE_DEFAULT_BACKGROUND,
  pageBackgroundCss,
  patchPage,
  removePage,
  reorderPage
} from '../src/shared/uiWorkbench/page.ts'
import {
  applyNodeAction,
  hitTopmost,
  isPickable,
  visibleNodes,
  type SceneNode
} from '../src/shared/uiWorkbench/scene.ts'
import { snapTargets } from '../src/shared/uiWorkbench/snap.ts'
import { sanitizeGroups } from '../src/shared/uiWorkbench/groups.ts'
import { docActions, getDocState } from '../src/renderer/src/uiWorkbench/documentStore.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

const BOX = { x: 0, y: 0, width: 10, height: 10 }
const ids = (nodes: readonly SceneNode[]): string[] => nodes.map((n) => n.id)

check('新页:序号取现有最大 + 1、删掉的号不复用;底色继承、页面是空的', () => {
  const first = createPage([])
  assert.equal(first.id, 'page-1')
  assert.deepEqual(first.background, PAGE_DEFAULT_BACKGROUND)
  const styled = patchPage([first], 'page-1', {
    background: { color: '#112233', opacity: 40 }
  })[0]
  const second = createPage([first], styled)
  assert.equal(second.id, 'page-2')
  assert.equal(second.name, '页面 2')
  assert.deepEqual(second.background, styled.background)
  assert.equal(second.nodes.length, 0)
  assert.notEqual(second.background, styled.background, '继承是拷贝,不共享引用')
  assert.equal(createPage([first, { id: 'page-5' }]).id, 'page-6')
  assert.equal(createPage([{ id: 'page-1' }, { id: 'page-3' }]).id, 'page-4')
})

check('改页属性:颜色归一化、非法颜色回退、不透明度钳 0-100、名字不能空', () => {
  const page = createPage([])
  const patched = (patch: Parameters<typeof patchPage>[2]) => patchPage([page], page.id, patch)[0]
  assert.equal(patched({ background: { color: 'ABC' } }).background.color, '#aabbcc')
  assert.equal(patched({ background: { color: 'zzz' } }).background.color, page.background.color)
  assert.equal(patched({ background: { opacity: 250 } }).background.opacity, 100)
  assert.equal(patched({ background: { opacity: -5 } }).background.opacity, 0)
  assert.equal(patched({ background: { visible: false } }).background.visible, false)
  assert.equal(patched({ name: '  首页  ' }).name, '首页')
  assert.equal(patched({ name: '   ' }).name, page.name)
  assert.equal(patched({ background: { opacity: 50 } }).background.color, page.background.color)
  assert.equal(patchPage([page], 'nope', { name: 'x' })[0], page, '找不到的页原样返回')
})

check('删页:至少保留一页;删当前页落到下一页,没有则上一页;删别页不动当前页', () => {
  const a = createPage([])
  const b = createPage([a])
  const c = createPage([a, b])
  const pages = [a, b, c]
  assert.deepEqual(removePage([a], a.id), [a])
  assert.deepEqual(
    removePage(pages, b.id).map((p) => p.id),
    ['page-1', 'page-3']
  )
  assert.equal(activeAfterRemove(pages, b.id, b.id), 'page-3')
  assert.equal(activeAfterRemove(pages, c.id, c.id), 'page-2')
  assert.equal(activeAfterRemove(pages, a.id, a.id), 'page-2')
  assert.equal(activeAfterRemove(pages, c.id, a.id), 'page-1')
  assert.equal(activeAfterRemove([a], a.id, a.id), 'page-1')
})

check('页签排序:移到指定下标,越界钳两端,未知 id 不动', () => {
  const a = createPage([])
  const b = createPage([a])
  const c = createPage([a, b])
  const order = (to: number, id = a.id): string[] => reorderPage([a, b, c], id, to).map((p) => p.id)
  assert.deepEqual(order(2), ['page-2', 'page-3', 'page-1'])
  assert.deepEqual(order(99), ['page-2', 'page-3', 'page-1'])
  assert.deepEqual(order(0, c.id), ['page-3', 'page-1', 'page-2'])
  assert.deepEqual(order(-4, c.id), ['page-3', 'page-1', 'page-2'])
  assert.deepEqual(order(1, 'nope'), ['page-1', 'page-2', 'page-3'])
})

check('图层默认可见未锁;改名去空白截断、留空保留原名;显隐锁定可补丁', () => {
  const rect = createRect([], BOX)
  const line = createLine([], { x1: 0, y1: 0, x2: 10, y2: 0 })
  for (const node of [rect, line]) {
    assert.equal(node.visible, true)
    assert.equal(node.locked, false)
  }
  const apply = (node: SceneNode, patch: object): SceneNode =>
    applyNodeAction([node], { type: 'update', id: node.id, patch })[0]
  for (const node of [rect, line]) {
    assert.equal(apply(node, { name: '  按钮  ' }).name, '按钮')
    assert.equal(apply(node, { name: '' }).name, node.name)
    assert.equal(apply(node, { name: 'x'.repeat(200) }).name.length, NAME_MAX_LENGTH)
    assert.equal(apply(node, { visible: false }).visible, false)
    assert.equal(apply(node, { locked: true }).locked, true)
  }
  assert.equal(sanitizeName('  a ', 'b'), 'a')
})

check('z 序调整:移到指定下标,越界钳两端,未知 id 不动,节点对象保持原样', () => {
  const a = createRect([], BOX)
  const b = createRect([a], BOX)
  const c = createRect([a, b], BOX)
  const order = (id: string, to: number): string[] =>
    ids(applyNodeAction([a, b, c], { type: 'reorder', id, toIndex: to }))
  assert.deepEqual(order(a.id, 2), ['rect-2', 'rect-3', 'rect-1'])
  assert.deepEqual(order(a.id, 99), ['rect-2', 'rect-3', 'rect-1'])
  assert.deepEqual(order(c.id, 0), ['rect-3', 'rect-1', 'rect-2'])
  assert.deepEqual(order(c.id, -1), ['rect-3', 'rect-1', 'rect-2'])
  assert.deepEqual(order('nope', 0), ['rect-1', 'rect-2', 'rect-3'])
  assert.equal(applyNodeAction([a, b, c], { type: 'reorder', id: a.id, toIndex: 2 })[2], a)
})

check('samePages:改名/底色/节点顺序/页序任一不同即异,值同则同', () => {
  const a = createPage([])
  const b = createPage([a])
  assert.ok(samePages([a, b], [{ ...a }, { ...b }]))
  assert.ok(!samePages([a], [a, b]))
  assert.ok(!samePages([a, b], [b, a]))
  assert.ok(!samePages([a], patchPage([a], a.id, { name: '新名' })))
  assert.ok(!samePages([a], patchPage([a], a.id, { background: { color: '#000000' } })))
  assert.ok(!samePages([a], patchPage([a], a.id, { background: { opacity: 10 } })))
  assert.ok(!samePages([a], patchPage([a], a.id, { background: { visible: false } })))
  const r1 = createRect([], BOX)
  const r2 = createRect([r1], BOX)
  const withNodes = (nodes: SceneNode[]) => ({ ...a, nodes })
  assert.ok(!samePages([withNodes([r1, r2])], [withNodes([r2, r1])]))
  assert.ok(!samePages([withNodes([r1])], [withNodes([{ ...r1, visible: false }])]))
  assert.ok(!samePages([withNodes([r1])], [withNodes([{ ...r1, locked: true }])]))
})

check('文档仓库:初始一页(预置一个画板)、空选中、不可撤销', () => {
  const s = getDocState()
  assert.equal(s.pages.length, 1)
  assert.equal(s.activePageId, 'page-1')
  assert.deepEqual(
    s.nodes.map((n) => [n.id, n.type, n.parentId]),
    [['frame-1', 'frame', null]]
  )
  assert.deepEqual(s.selectedIds, [])
  assert.equal(s.nodes, s.activePage.nodes)
  assert.equal(s.canUndo, false)
})

check('节点属于所在页:换页后看不到别页节点;切页清空选中且不入撤销栈', () => {
  const doc = docActions
  const rect = createRect(getDocState().nodes, BOX)
  doc.dispatch({ type: 'add', node: rect })
  doc.select(rect.id)
  doc.addPage()
  assert.equal(getDocState().activePageId, 'page-2')
  assert.equal(getDocState().nodes.length, 0)
  assert.deepEqual(getDocState().selectedIds, [])
  doc.switchPage('page-1')
  assert.equal(getDocState().nodes.length, 2, '预置画板 + 刚加的矩形')
  doc.select(rect.id)
  const undoable = getDocState().canUndo
  doc.switchPage('page-2')
  assert.deepEqual(getDocState().selectedIds, [], '切页清空选中')
  assert.equal(getDocState().canUndo, undoable, '切页不改撤销栈')
  doc.switchPage('page-2')
  doc.switchPage('不存在')
  assert.equal(getDocState().activePageId, 'page-2', '切到自己/不存在的页是 no-op')
})

check('新建页继承当前页底色、页面是空的;撤销新建回到原页,重做回新页', () => {
  const doc = docActions
  doc.switchPage('page-1')
  doc.patchPage('page-1', { background: { color: '#202020' } })
  doc.addPage()
  const created = getDocState().activePage
  assert.equal(created.id, 'page-3')
  assert.equal(created.background.color, '#202020')
  assert.equal(created.nodes.length, 0)
  doc.undo()
  assert.equal(getDocState().pages.length, 2)
  assert.equal(getDocState().activePageId, 'page-1')
  doc.redo()
  assert.equal(getDocState().pages.length, 3)
  assert.equal(getDocState().activePageId, 'page-3')
})

check('撤销跳回动作发生的页:在 page-2 改动、切到 page-1 后撤销,回到 page-2', () => {
  const doc = docActions
  doc.switchPage('page-2')
  const rect = createRect(getDocState().nodes, BOX)
  doc.dispatch({ type: 'add', node: rect })
  doc.switchPage('page-1')
  doc.undo()
  assert.equal(getDocState().activePageId, 'page-2')
  assert.equal(getDocState().nodes.length, 0)
  doc.redo()
  assert.equal(getDocState().activePageId, 'page-2')
  assert.equal(getDocState().nodes.length, 1)
})

check('改底色/改名/改尺寸各记一步,撤销还原;no-op 不入账', () => {
  const doc = docActions
  doc.switchPage('page-2')
  const before = getDocState().activePage
  doc.patchPage('page-2', { background: { color: '#ff0000' } })
  assert.equal(getDocState().activePage.background.color, '#ff0000')
  doc.undo()
  assert.equal(getDocState().activePage.background.color, before.background.color)
  doc.redo()
  doc.patchPage('page-2', { name: '登录页' })
  doc.patchPage('page-2', { name: '登录页' })
  doc.undo()
  assert.equal(getDocState().activePage.name, before.name, '重复改成同值只记一步')
  doc.undo()
  assert.equal(getDocState().activePage.background.color, before.background.color)
  doc.redo()
  doc.redo()
  assert.equal(getDocState().activePage.name, '登录页')
})

check('删页:撤销找回(含节点);只剩一页不能删;删当前页切到相邻页并清选中', () => {
  const doc = docActions
  doc.switchPage('page-2')
  const nodeCount = getDocState().nodes.length
  assert.ok(nodeCount > 0)
  doc.select(getDocState().nodes[0].id)
  doc.removePage('page-2')
  assert.equal(
    getDocState().pages.some((p) => p.id === 'page-2'),
    false
  )
  assert.equal(getDocState().activePageId, 'page-3')
  assert.deepEqual(getDocState().selectedIds, [])
  doc.undo()
  assert.equal(getDocState().activePageId, 'page-2')
  assert.equal(getDocState().nodes.length, nodeCount)
  doc.redo()
  doc.removePage('page-3')
  assert.equal(getDocState().pages.length, 1)
  doc.removePage('page-1')
  assert.equal(getDocState().pages.length, 1, '最后一页不能删')
  assert.equal(getDocState().canUndo, true)
})

check('图层改动进撤销:隐藏、锁定、改名、调序各一步;批次内只记一步', () => {
  const doc = docActions
  doc.switchPage('page-1')
  // page-1 现有:预置画板 frame-1 + 先前加的 rect-1;这里只看两个矩形之间的相对层序
  const first = getDocState().nodes.find((n) => n.id === 'rect-1')!
  const second = createRect(getDocState().nodes, BOX)
  doc.dispatch({ type: 'add', node: second })
  const get = (id: string) => getDocState().nodes.find((n) => n.id === id)!
  const order = (): string[] =>
    ids(getDocState().nodes).filter((id) => id === first.id || id === second.id)
  doc.dispatch({ type: 'update', id: first.id, patch: { visible: false } })
  assert.equal(get(first.id).visible, false)
  doc.undo()
  assert.equal(get(first.id).visible, true)
  doc.redo()
  doc.dispatch({ type: 'update', id: first.id, patch: { locked: true, name: '背景' } })
  assert.equal(get(first.id).locked, true)
  assert.equal(get(first.id).name, '背景')
  doc.undo()
  assert.equal(get(first.id).locked, false)
  doc.redo()
  const top = getDocState().nodes.length
  doc.dispatch({ type: 'reorder', id: first.id, toIndex: top })
  assert.deepEqual(order(), [second.id, first.id])
  doc.undo()
  assert.deepEqual(order(), [first.id, second.id])
  doc.redo()
  doc.beginBatch()
  doc.dispatch({ type: 'reorder', id: first.id, toIndex: 0 })
  doc.dispatch({ type: 'reorder', id: second.id, toIndex: 0 })
  doc.dispatch({ type: 'reorder', id: first.id, toIndex: 0 })
  doc.endBatch()
  assert.deepEqual(order(), [first.id, second.id])
  doc.undo()
  assert.deepEqual(order(), [second.id, first.id], '一个批次 = 一步')
})

check('页序调整进撤销;重排后当前页不变', () => {
  const doc = docActions
  doc.addPage()
  const active = getDocState().activePageId
  const order = (): string[] => getDocState().pages.map((p) => p.id)
  const before = order()
  doc.reorderPage(before[0], before.length - 1)
  assert.equal(order()[before.length - 1], before[0])
  assert.equal(getDocState().activePageId, active)
  doc.undo()
  assert.deepEqual(order(), before)
})

check('样式组存档:显隐锁定随片段保留,缺字段按可见未锁', () => {
  const stored = (extra: object): unknown => [
    {
      id: 'g1',
      name: '组',
      nodes: [
        {
          type: 'rect',
          name: '矩形',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          radii: [0, 0, 0, 0],
          fill: '#d9d9d9',
          stroke: null,
          styleId: null,
          ...extra
        }
      ]
    }
  ]
  const legacy = sanitizeGroups(stored({}))[0].nodes[0]
  assert.equal(legacy.visible, true)
  assert.equal(legacy.locked, false)
  const kept = sanitizeGroups(stored({ visible: false, locked: true }))[0].nodes[0]
  assert.equal(kept.visible, false)
  assert.equal(kept.locked, true)
})

check('隐藏/锁定的节点画布上点不中、框不中;隐藏的不渲染不导出不参与吸附', () => {
  const under = createRect([], { x: 0, y: 0, width: 50, height: 50 })
  const over = { ...createRect([under], { x: 0, y: 0, width: 50, height: 50 }) }
  const at = { x: 10, y: 10 }
  assert.equal(hitTopmost([under, over], at, 1)?.id, over.id)
  assert.equal(hitTopmost([under, { ...over, visible: false }], at, 1)?.id, under.id)
  assert.equal(hitTopmost([under, { ...over, locked: true }], at, 1)?.id, under.id, '锁定的穿透')
  assert.equal(hitTopmost([{ ...under, locked: true }], at, 1), null)
  assert.ok(isPickable(under))
  assert.ok(!isPickable({ ...under, visible: false }))
  assert.ok(!isPickable({ ...under, locked: true }))
  const hidden = { ...over, visible: false }
  assert.deepEqual(ids(visibleNodes([under, hidden])), [under.id])
  assert.equal(snapTargets([under, hidden], 'nope').length, 1)
  assert.equal(snapTargets([under, { ...over, locked: true }], 'nope').length, 2, '锁定的仍可吸附')
})

check('画布底色 CSS:十六进制拆通道、不透明度进 alpha、隐藏返回 null', () => {
  assert.equal(
    pageBackgroundCss({ color: '#f5f5f5', opacity: 100, visible: true }),
    'rgb(245 245 245 / 100%)'
  )
  assert.equal(
    pageBackgroundCss({ color: '#102030', opacity: 40, visible: true }),
    'rgb(16 32 48 / 40%)'
  )
  assert.equal(pageBackgroundCss({ color: '#102030', opacity: 40, visible: false }), null)
  assert.equal(defaultPageBackground(false).color, '#f5f5f5')
  assert.equal(defaultPageBackground(true).color, '#1e1e1e')
})

check('隐藏节点同时退出选集;锁定不退;撤销隐藏后节点回来', () => {
  const doc = docActions
  doc.switchPage('page-1')
  const first = getDocState().nodes[0]
  doc.select(first.id)
  doc.dispatch({ type: 'update', id: first.id, patch: { locked: true } })
  assert.deepEqual(getDocState().selectedIds, [first.id])
  doc.dispatch({ type: 'update', id: first.id, patch: { visible: false } })
  assert.deepEqual(getDocState().selectedIds, [])
  doc.undo()
  assert.equal(getDocState().nodes[0].visible, true)
})

check('拖拽落位换算:槽位 → 落定位置,落在自己上下缝为原地不动', () => {
  assert.equal(rowDropPosition(4, 1, 0), 0)
  assert.equal(rowDropPosition(4, 1, 1), null)
  assert.equal(rowDropPosition(4, 1, 2), null)
  assert.equal(rowDropPosition(4, 1, 3), 2)
  assert.equal(rowDropPosition(4, 1, 4), 3)
  assert.equal(rowDropPosition(4, 3, 0), 0)
  assert.equal(rowDropPosition(4, 0, 99), 3, '槽位越界钳到末尾')
  assert.equal(rowDropPosition(4, 2, -5), 0)
})

check('图层落位 → reorder 下标:面板上层在前,拖到最上 = 数组最后', () => {
  const a = createRect([], BOX)
  const b = createRect([a], BOX)
  const c = createRect([a, b], BOX)
  const nodes = [a, b, c]
  const display = layerDisplayOrder(nodes)
  assert.deepEqual(ids(display), ['rect-3', 'rect-2', 'rect-1'])
  const dragTo = (id: string, slot: number): string[] => {
    const from = display.findIndex((n) => n.id === id)
    const toIndex = layerReorderIndex(nodes.length, from, slot)
    return toIndex === null
      ? ids(nodes)
      : ids(applyNodeAction(nodes, { type: 'reorder', id, toIndex }))
  }
  assert.deepEqual(dragTo('rect-1', 0), ['rect-2', 'rect-3', 'rect-1'], '最底层拖到最上')
  assert.deepEqual(dragTo('rect-3', 3), ['rect-3', 'rect-1', 'rect-2'], '最上层拖到最下')
  assert.deepEqual(dragTo('rect-2', 0), ['rect-1', 'rect-3', 'rect-2'])
  assert.deepEqual(dragTo('rect-2', 1), ['rect-1', 'rect-2', 'rect-3'], '原地不动')
  assert.equal(layerReorderIndex(3, 1, 2), null)
})

check('指针换算槽位:在第 i 行中线之上落第 i 缝,越过最后一行落末缝', () => {
  const mids = [10, 30, 50]
  assert.equal(slotFromPointer(mids, 0), 0)
  assert.equal(slotFromPointer(mids, 10), 1)
  assert.equal(slotFromPointer(mids, 29), 1)
  assert.equal(slotFromPointer(mids, 31), 2)
  assert.equal(slotFromPointer(mids, 500), 3)
  assert.equal(slotFromPointer([], 5), 0)
})

console.log('UI 工作台 Page / 图层自测全部通过')
