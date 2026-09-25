// 最近打开的项目自测(第八十一锤):垃圾账不炸、同路径挤旧顶新、超长滚动、删账干净、时间话术
// UI v3 §7.1 pin 账:pin 跟着路径走、不占历史名额、菜单分区(pin 倒序 + 历史 5 条)
import assert from 'node:assert/strict'
import {
  RECENTS_MAX,
  formatRecentTime,
  menuWorkspaceRows,
  nextPinToggle,
  nextRecentProjects,
  parseRecentProjects,
  recentNameFor,
  removeRecentProject
} from '../src/renderer/src/recents.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('parseRecentProjects:没记过/垃圾一概回空数组', () => {
  for (const junk of [
    null,
    'x',
    42,
    {},
    [1, 'a'],
    [{ p: '' }, { p: 'a', n: 'b' }, { p: 'a', n: 1 }, { p: 'a', n: 'b', t: 'x' }]
  ]) {
    const got = parseRecentProjects(junk)
    assert.ok(Array.isArray(got))
    assert.equal(got.length, 0, `垃圾应被整条扔掉:${JSON.stringify(junk)}`)
  }
})

check('parseRecentProjects:干净账原样认回,超长只认最近 8 条', () => {
  const good = [{ p: 'C:\\a', n: 'a', t: 1 }]
  assert.deepEqual(parseRecentProjects(good), good)
  const long = Array.from({ length: 20 }, (_, i) => ({ p: `C:\\p${i}`, n: `p${i}`, t: i + 1 }))
  assert.equal(parseRecentProjects(long).length, RECENTS_MAX)
  assert.equal(parseRecentProjects(long)[0].p, 'C:\\p0', '掐头留最前(最新)的')
})

check('nextRecentProjects:同路径不分大小写挤掉旧账顶到最前;别家不动;超长滚出队尾', () => {
  const old = [
    { p: 'C:\\work\\demo', n: 'demo', t: 100 },
    { p: 'C:\\other', n: 'other', t: 90 }
  ]
  const next = nextRecentProjects(old, 'c:\\WORK\\demo', 'demo', 200)
  assert.equal(next.length, 2)
  assert.equal(next[0].p, 'c:\\WORK\\demo')
  assert.equal(next[0].t, 200)
  assert.equal(next[1].p, 'C:\\other')
  // 满了之后最老的滚出去
  let list: Array<{ p: string; n: string; t: number }> = []
  for (let i = 0; i < RECENTS_MAX + 3; i++) list = nextRecentProjects(list, `C:\\p${i}`, `p${i}`, i)
  assert.equal(list.length, RECENTS_MAX)
  assert.equal(list[0].p, `C:\\p${RECENTS_MAX + 2}`)
  assert.equal(list[list.length - 1].p, `C:\\p3`, '最老的三条滚出去')
})

check('removeRecentProject:删谁没谁,不存在的删了也不报错', () => {
  const list = [
    { p: 'C:\\a', n: 'a', t: 1 },
    { p: 'C:\\b', n: 'b', t: 2 }
  ]
  const gone = removeRecentProject(list, 'c:\\A')
  assert.deepEqual(gone, [{ p: 'C:\\b', n: 'b', t: 2 }])
  assert.deepEqual(removeRecentProject(list, 'C:\\none'), list)
})

check('parseRecentProjects:pin 字段认得认回,垃圾 pin 当没写', () => {
  const withPin = [{ p: 'C:\\a', n: 'a', t: 1, pin: 50 }]
  assert.deepEqual(parseRecentProjects(withPin), withPin)
  const badPin = [{ p: 'C:\\a', n: 'a', t: 1, pin: 'x' }]
  assert.deepEqual(parseRecentProjects(badPin), [{ p: 'C:\\a', n: 'a', t: 1 }])
  // pin 条目不占历史 8 条名额,不被时间淘汰
  const mixed = [
    ...Array.from({ length: 20 }, (_, i) => ({ p: `C:\\h${i}`, n: `h${i}`, t: i + 1 })),
    { p: 'C:\\pin', n: 'pin', t: 0.5, pin: 7 }
  ]
  const parsed = parseRecentProjects(mixed)
  assert.equal(parsed.filter((r) => r.pin !== undefined).length, 1)
  assert.equal(parsed.filter((r) => r.pin === undefined).length, RECENTS_MAX)
  assert.ok(
    parsed.some((r) => r.p === 'C:\\pin'),
    '最老的 pin 账也活着'
  )
})

check('nextRecentProjects:重开已 pin 路径,pin 跟着路径走不丢', () => {
  const old = [
    { p: 'C:\\keep', n: 'keep', t: 100, pin: 50 },
    { p: 'C:\\other', n: 'other', t: 90 }
  ]
  const next = nextRecentProjects(old, 'c:\\KEEP', 'keep', 200)
  assert.deepEqual(next[0], { p: 'c:\\KEEP', n: 'keep', t: 200, pin: 50 })
})

check('nextPinToggle:pin 记时刻、unpin 摘字段回流历史', () => {
  const old = [
    { p: 'C:\\a', n: 'a', t: 100 },
    { p: 'C:\\b', n: 'b', t: 90 }
  ]
  const pinned = nextPinToggle(old, 'C:\\a', 500)
  assert.deepEqual(pinned[0], { p: 'C:\\a', n: 'a', t: 100, pin: 500 })
  const back = nextPinToggle(pinned, 'C:\\a', 600)
  assert.deepEqual(back[0], { p: 'C:\\a', n: 'a', t: 100 })
})

check('menuWorkspaceRows:pin 区按 pin 时刻倒序,历史区最多 5 条最近未 pin', () => {
  const list = [
    { p: 'C:\\h1', n: 'h1', t: 300 },
    { p: 'C:\\p1', n: 'p1', t: 10, pin: 100 },
    { p: 'C:\\h2', n: 'h2', t: 200 },
    { p: 'C:\\p2', n: 'p2', t: 5, pin: 400 },
    { p: 'C:\\h3', n: 'h3', t: 100 },
    { p: 'C:\\h4', n: 'h4', t: 90 },
    { p: 'C:\\h5', n: 'h5', t: 80 },
    { p: 'C:\\h6', n: 'h6', t: 70 },
    { p: 'C:\\h7', n: 'h7', t: 60 }
  ]
  const { pinned, history } = menuWorkspaceRows(list)
  assert.deepEqual(
    pinned.map((r) => r.p),
    ['C:\\p2', 'C:\\p1'],
    'pin 新的在前'
  )
  assert.equal(history.length, 5)
  assert.deepEqual(history.map((r) => r.p).slice(0, 3), ['C:\\h1', 'C:\\h2', 'C:\\h3'])
  assert.ok(!history.some((r) => r.pin !== undefined), '历史区不许夹 pin(两区去重)')
})

check('recentNameFor:取路径末段;盘根末段是空的,照实写回全路径', () => {
  assert.equal(recentNameFor('C:\\work\\demo'), 'demo')
  assert.equal(recentNameFor('C:/work/demo'), 'demo')
  assert.equal(recentNameFor('C:\\'), 'C:\\')
})

check('formatRecentTime:今天报时刻,昨天说昨天,再往前报日期(跨天按自然日算)', () => {
  const now = new Date(2026, 8, 8, 18, 0).getTime() // 2026-09-08 18:00
  const sameDay = new Date(2026, 8, 8, 9, 5).getTime()
  assert.equal(formatRecentTime(sameDay, now), '今天 09:05')
  assert.equal(formatRecentTime(new Date(2026, 8, 7, 23, 59).getTime(), now), '昨天')
  assert.equal(formatRecentTime(new Date(2026, 8, 1, 12, 0).getTime(), now), '9月1日')
  // 钟慢了(时间倒流)也当今天,不显示负数怪话
  assert.equal(formatRecentTime(now + 60_000, now), '今天 18:01')
})

console.log('✅ 最近打开项目自测全绿')
