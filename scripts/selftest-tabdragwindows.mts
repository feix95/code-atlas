// 跨窗页签拖拽几何自测:屏幕命中、局部换算、插入序号与插入线落点。
// 纯函数不碰 DOM 不碰 electron,秒跑。
import assert from 'node:assert/strict'
import {
  bodyAtPoint,
  gapIndexAt,
  gapLeftAt,
  stripAtPoint,
  windowAtPoint,
  type BodySnap,
  type StripSnap,
  type WindowSnap
} from '../src/renderer/src/tabDragWindows.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

const strip = (
  host: string,
  groupId: string,
  left: number,
  top: number,
  width = 200
): StripSnap => ({
  host,
  groupId,
  left,
  top,
  right: left + width,
  bottom: top + 40,
  barLeft: left + 4,
  mids: [
    { id: 'a', left: left + 4, mid: left + 40, right: left + 76 },
    { id: 'b', left: left + 78, mid: left + 114, right: left + 150 },
    { id: 'c', left: left + 152, mid: left + 188, right: left + 224 }
  ]
})

const body = (host: string, groupId: string | null, left: number, top: number): BodySnap => ({
  host,
  groupId,
  left,
  top,
  right: left + 300,
  bottom: top + 400
})

const win = (
  host: string,
  x: number,
  y: number,
  strips: StripSnap[] = [],
  bodies: BodySnap[] = []
): WindowSnap => ({ host, x, y, width: 600, height: 500, strips, bodies })

check('windowAtPoint:来源窗永远跳过,目标窗换算成局部坐标', () => {
  const source = win('main', 0, 0)
  const target = win('aux-1', 800, 100)
  const hit = windowAtPoint([source, target], 900, 180, 'main')
  assert.ok(hit)
  assert.equal(hit!.snap.host, 'aux-1')
  assert.equal(hit!.localX, 100)
  assert.equal(hit!.localY, 80)
  assert.equal(windowAtPoint([source, target], 900, 180, 'aux-1'), null, '来源窗不吞自己的落点')
})

check('windowAtPoint:都不在窗里回 null', () => {
  assert.equal(windowAtPoint([win('main', 0, 0), win('aux-1', 800, 100)], 400, 400, 'main'), null)
})

check('windowAtPoint:重叠时按传入顺序取前面的窗', () => {
  const front = win('aux-2', 800, 100)
  const back = win('aux-1', 800, 100)
  assert.equal(windowAtPoint([front, back], 900, 180, 'main')!.snap.host, 'aux-2')
})

check('stripAtPoint:条带内命中,磁性带外不命中', () => {
  const s = strip('aux-1', 'pane:1', 100, 0)
  assert.equal(stripAtPoint([s], 150, 20)?.groupId, 'pane:1')
  assert.equal(stripAtPoint([s], 150, -30)?.groupId, 'pane:1', '32px 磁性带内仍算条带')
  assert.equal(stripAtPoint([s], 150, -40), null, '超过磁性带才算离开')
})

check('bodyAtPoint:正文内命中,组 id 可空(主窗零组兜底)', () => {
  const b = body('main', null, 0, 60)
  assert.equal(bodyAtPoint([b], 100, 200)?.groupId, null)
  assert.equal(bodyAtPoint([b], 100, 20), null)
})

check('gapIndexAt:投影中心判定,队尾等于可见签数', () => {
  const s = strip('aux-1', 'pane:1', 0, 0)
  // 中线 40 / 114 / 188;抓在签左端 10,指针 30 → 中心 70,越过 40 未到 114
  assert.equal(gapIndexAt(s, 30, 10, 80), 1)
  assert.equal(gapIndexAt(s, 400, 10, 80), 3)
})

check('gapLeftAt:队首/中间/队尾/空带各有落点', () => {
  const s = strip('aux-1', 'pane:1', 0, 0)
  assert.equal(gapLeftAt(s, 0), 4)
  assert.equal(gapLeftAt(s, 1), 78)
  assert.equal(gapLeftAt(s, 3), 226, '队尾贴末签右缘 + 2')
  const empty: StripSnap = { ...s, mids: [], barLeft: 50 }
  assert.equal(gapLeftAt(empty, 0), 60, '空带贴 .tabbar 左缘 + 10')
})

console.log('✅ 跨窗拖拽几何自测全绿')
