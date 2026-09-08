// Developer 后台日志自测(第八十七锤):环形账本滚动、引擎输出按行拆、超长掐中留头尾、
// 时间话术、来源标签、监听广播 —— 账本模块是纯的,不碰 electron 直接打。
import assert from 'node:assert/strict'
import {
  DEVLOG_MAX,
  capDevLogLine,
  createDevLogRing,
  devLogSourceName,
  formatDevLogTime,
  setDevLogListener,
  splitDevLogLines
} from '../src/shared/devlog.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('splitDevLogLines:回车/换行/回车换行都拆,空行纯空白不记账', () => {
  assert.deepEqual(splitDevLogLines('a\r\nb\rc\nd'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(splitDevLogLines('  \n\n  x  \n'), ['x'])
  assert.deepEqual(splitDevLogLines(''), [])
})

check('splitDevLogLines:llama.cpp 进度条一回车一帧,逐帧成行不糊成一条', () => {
  const chunk = 'loading model 10%\rloading model 20%\rloading model 30%'
  assert.deepEqual(splitDevLogLines(chunk), ['loading model 10%', 'loading model 20%', 'loading model 30%'])
})

check('capDevLogLine:短行原样;超长掐中间留头尾并注明省了多少', () => {
  assert.equal(capDevLogLine('short', 10), 'short')
  const capped = capDevLogLine('x'.repeat(1000), 100)
  assert.ok(capped.length < 200, '掐完不该还拖着一千字')
  assert.ok(capped.includes('省略 900 字'))
  assert.ok(capped.startsWith('x'.repeat(50)))
  assert.ok(capped.endsWith('x'.repeat(50)))
})

check('createDevLogRing:add 自动拆行编号;满 2000 丢最旧的,编号不回头', () => {
  const ring = createDevLogRing(5)
  ring.add('engine', 'one\ntwo')
  ring.add('request', 'three')
  assert.equal(ring.count(), 3)
  const snap = ring.snapshot()
  assert.deepEqual(snap.map((e) => e.text), ['one', 'two', 'three'])
  assert.deepEqual(snap.map((e) => e.source), ['engine', 'engine', 'request'])
  assert.deepEqual(snap.map((e) => e.id), [1, 2, 3])
  for (let i = 0; i < 10; i++) ring.add('system', `n${i}`)
  assert.equal(ring.count(), 5, '容量 5 就只留 5 条')
  assert.equal(ring.snapshot()[0].text, 'n5', '最旧的滚出去')
  assert.equal(ring.snapshot()[4].text, 'n9')
  assert.ok(ring.snapshot()[4].id > ring.snapshot()[0].id, '编号单调递增')
})

check('createDevLogRing:空白行不占容量;snapshot 是拷贝,外面改不动账本', () => {
  const ring = createDevLogRing(10)
  ring.add('system', '\n  \n')
  assert.equal(ring.count(), 0)
  ring.add('engine', 'line-a')
  const snap = ring.snapshot()
  snap[0].text = '篡改'
  assert.equal(ring.snapshot()[0].text, 'line-a')
})

check('setDevLogListener:每记一笔喊一声(按行喊);注销后闭嘴;清账清干净', () => {
  const ring = createDevLogRing(10)
  const seen: string[] = []
  const off = setDevLogListener((e) => seen.push(e.text))
  ring.add('engine', 'a\nb')
  off()
  ring.add('engine', 'c')
  assert.deepEqual(seen, ['a', 'b'], '注销前按行广播,注销后闭嘴')
  ring.clear()
  assert.equal(ring.count(), 0)
  setDevLogListener(null)
})

check('formatDevLogTime:挂墙上的钟,时分秒都补零', () => {
  const ts = new Date(2026, 8, 9, 7, 5, 3).getTime()
  assert.equal(formatDevLogTime(ts), '07:05:03')
  const noon = new Date(2026, 8, 9, 12, 34, 56).getTime()
  assert.equal(formatDevLogTime(noon), '12:34:56')
})

check('devLogSourceName:三个来源三个标签,不认识的落「应用」', () => {
  assert.equal(devLogSourceName('engine'), '引擎')
  assert.equal(devLogSourceName('request'), '请求')
  assert.equal(devLogSourceName('system'), '应用')
})

check('全局容量口径:默认账本 2000 条,llama.cpp 加载大模型也装得下', () => {
  assert.equal(DEVLOG_MAX, 2000)
})

console.log('✅ Developer 后台日志自测全绿')
