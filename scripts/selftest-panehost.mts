// 组户口纯函数自测(页签撕窗锤):moveTabToHost/dropHostGroups/groupsForHost/groupHost ——
// 撕签换窗的账本规则全在这儿,纯函数不碰 DOM 不碰 electron,秒跑。
import assert from 'node:assert/strict'
import {
  dropHostGroups,
  groupHost,
  groupsForHost,
  MAIN_HOST,
  moveTabToHost,
  type PaneGroup,
  type PaneTab
} from '../src/renderer/src/paneTabs.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

const tab = (id: string): PaneTab => ({
  id,
  kind: 'preview',
  relPath: `f/${id}`,
  name: id,
  icon: 'file'
})
const grp = (id: string, tabs: PaneTab[], host?: string, activeId?: string | null): PaneGroup => ({
  id,
  tabs,
  activeId: activeId === undefined ? (tabs[0]?.id ?? null) : activeId,
  host
})

check('groupHost:没填户口就是主窗,填了认填的', () => {
  assert.equal(groupHost(grp('g1', [tab('t1')])), MAIN_HOST)
  assert.equal(groupHost(grp('g2', [tab('t1')], 'aux-1')), 'aux-1')
})

check('groupsForHost:按户口分窝,主窗的子窗的各归各', () => {
  const groups = [
    grp('g1', [tab('t1')]),
    grp('g2', [tab('t2')], 'aux-1'),
    grp('g3', [tab('t3')], 'aux-2')
  ]
  assert.deepEqual(
    groupsForHost(groups, MAIN_HOST).map((g) => g.id),
    ['g1']
  )
  assert.deepEqual(
    groupsForHost(groups, 'aux-1').map((g) => g.id),
    ['g2']
  )
  assert.equal(groupsForHost(groups, 'aux-9').length, 0)
})

check('moveTabToHost:挪去新窗户口,现立新组,签过去激活', () => {
  const groups = [grp('g1', [tab('t1'), tab('t2')])]
  const moved = moveTabToHost(groups, 't2', 'aux-1')
  assert.ok(moved, '找得到签就动账')
  const src = moved!.groups.find((g) => g.id === 'g1')!
  const dst = moved!.groups.find((g) => groupHost(g) === 'aux-1')!
  assert.deepEqual(
    src.tabs.map((t) => t.id),
    ['t1'],
    '源组只剩 t1'
  )
  assert.deepEqual(
    dst.tabs.map((t) => t.id),
    ['t2'],
    '新组接住 t2'
  )
  assert.equal(dst.activeId, 't2', '挪来的签点亮')
  assert.equal(moved!.activeGroupId, dst.id, '聚焦跟到新组')
  // 原账本不被改(纯函数)
  assert.equal(groups[0].tabs.length, 2, '不入账改动')
})

check('moveTabToHost:挪回主窗,落进主窗现成的组,不再立组', () => {
  const groups = [grp('g1', [tab('t1')]), grp('g2', [tab('t2'), tab('t3')], 'aux-1')]
  const moved = moveTabToHost(groups, 't3', MAIN_HOST)!
  const main = moved.groups.find((g) => g.id === 'g1')!
  assert.deepEqual(
    main.tabs.map((t) => t.id),
    ['t1', 't3'],
    '主窗的组接住 t3'
  )
  assert.equal(moved.groups.filter((g) => groupHost(g) === MAIN_HOST).length, 1, '主窗还是一组')
})

check('moveTabToHost:源组搬空自己消亡(子窗拖空 → 壳层自裁的前提)', () => {
  const groups = [grp('g1', [tab('t1')]), grp('g2', [tab('t2')], 'aux-1')]
  const moved = moveTabToHost(groups, 't2', MAIN_HOST)!
  assert.equal(
    moved.groups.some((g) => g.id === 'g2'),
    false,
    '搬空的 aux 组销户'
  )
  assert.equal(moved.groups.length, 1)
})

check('moveTabToHost:抽走激活签,源组激活指针落到末张', () => {
  const groups = [grp('g1', [tab('t1'), tab('t2')], undefined, 't2')]
  const moved = moveTabToHost(groups, 't2', 'aux-1')!
  assert.equal(moved.groups.find((g) => g.id === 'g1')!.activeId, 't1', '激活接力末张')
})

check('moveTabToHost:找不到签回 null,账本不动', () => {
  const groups = [grp('g1', [tab('t1')])]
  assert.equal(moveTabToHost(groups, 'ghost', 'aux-1'), null)
})

check('dropHostGroups:只清指定户口的组,别家一根毛不动', () => {
  const groups = [
    grp('g1', [tab('t1')]),
    grp('g2', [tab('t2')], 'aux-1'),
    grp('g3', [tab('t3')], 'aux-2')
  ]
  const kept = dropHostGroups(groups, 'aux-1')
  assert.deepEqual(
    kept.map((g) => g.id),
    ['g1', 'g3']
  )
})

console.log('✅ 组户口自测全绿')
