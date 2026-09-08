// 后退/前进的线轴自测(第八十三锤):去重、剪前进线、封顶请客、游标夹边,纯函数逐条过
import assert from 'node:assert/strict'
import { NAV_MAX, pushNavLocation, sameLocation, stepNavIndex, type NavLocation } from '../src/renderer/src/navHistory.ts'

const HOME: NavLocation = { folder: null, file: null, dir: null }
const proj = (name: string): NavLocation => ({ folder: `C:\\${name}`, file: null, dir: null })
const fileLoc = (name: string): NavLocation => ({ folder: 'C:\\demo', file: name, dir: null })

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('sameLocation:三样都对上才算原地', () => {
  assert.ok(sameLocation(HOME, HOME))
  assert.ok(sameLocation(fileLoc('a.ts'), { folder: 'C:\\demo', file: 'a.ts', dir: null }))
  assert.ok(!sameLocation(proj('a'), proj('b')))
  assert.ok(!sameLocation(fileLoc('a.ts'), { folder: 'C:\\demo', file: null, dir: 'a.ts' }))
})

check('pushNavLocation:连点同一个地方不记第二笔', () => {
  const first = pushNavLocation([HOME], 0, proj('demo'))
  const again = pushNavLocation(first.stack, first.index, proj('demo'))
  assert.equal(again.stack.length, 2)
  assert.equal(again.index, 1)
})

check('pushNavLocation:后退过后点新的,前进线剪掉', () => {
  // 线:HOME → demo → a.ts,游标在 a.ts;后退两步到 HOME;再去别处 → a.ts 和 demo 的前进线该断
  let s = [HOME]
  let i = 0
  ;({ stack: s, index: i } = pushNavLocation(s, i, proj('demo')))
  ;({ stack: s, index: i } = pushNavLocation(s, i, fileLoc('a.ts')))
  assert.equal(s.length, 3)
  i = stepNavIndex(i, -2, s.length)
  assert.equal(i, 0)
  ;({ stack: s, index: i } = pushNavLocation(s, i, proj('other')))
  assert.deepEqual(s, [HOME, proj('other')], '前进线剪干净,只剩走过的和新的')
  assert.equal(i, 1)
})

check(`pushNavLocation:满 ${NAV_MAX} 站从最老的请出去,游标始终钉在最新一站`, () => {
  let s = [HOME]
  let i = 0
  for (let n = 0; n < NAV_MAX + 5; n++) {
    ;({ stack: s, index: i } = pushNavLocation(s, i, proj(`p${n}`)))
  }
  assert.equal(s.length, NAV_MAX)
  assert.equal(s[s.length - 1].folder, 'C:\\p' + (NAV_MAX + 4))
  assert.equal(i, s.length - 1)
  assert.equal(s[0].folder, 'C:\\p5', '最老的四站连首页一起请出去了')
})

check('stepNavIndex:到头不动,绝不滑出线外', () => {
  assert.equal(stepNavIndex(0, -1, 3), 0)
  assert.equal(stepNavIndex(2, 1, 3), 2)
  assert.equal(stepNavIndex(1, -1, 3), 0)
  assert.equal(stepNavIndex(1, 5, 3), 2)
  assert.equal(stepNavIndex(0, 1, 0), 0, '空线也安全')
})

console.log('✅ 后退前进线轴自测全绿')
