import assert from 'node:assert/strict'
import { ellipsisMiddlePath } from '../src/renderer/src/pathEllipsis.ts'

const ch = (s: string): number => s.length
const PATH = 'E:\\my-projects\\worktrees\\code-atlas\\UI-creator'

assert.equal(PATH.length, 46)
assert.equal(ellipsisMiddlePath(PATH, 46, ch), PATH)
assert.equal(ellipsisMiddlePath(PATH, 100, ch), PATH)
assert.equal(ellipsisMiddlePath('E:\\foo', 20, ch), 'E:\\foo')

assert.equal(ellipsisMiddlePath(PATH, 37, ch), 'E:\\my-projects\\worktrees\\…\\UI-creator')
assert.equal(ellipsisMiddlePath(PATH, 27, ch), 'E:\\my-projects\\…\\UI-creator')
assert.equal(ellipsisMiddlePath(PATH, 26, ch), 'E:\\…\\UI-creator')
assert.equal(ellipsisMiddlePath(PATH, 15, ch), 'E:\\…\\UI-creator')

{
  const label = ellipsisMiddlePath(PATH, 12, ch)
  assert.ok(label.startsWith('E:\\…\\'), label)
  assert.ok(label.endsWith('…'), label)
  assert.ok(ch(label) <= 12, label)
  assert.ok(label.includes('UI'), label)
}

assert.equal(ellipsisMiddlePath('/home/user/projects/app', 16, ch), '/home/user/…/app')
assert.equal(ellipsisMiddlePath('/home/user/projects/app', 11, ch), '/home/…/app')
assert.equal(ellipsisMiddlePath('/home/user/projects/app', 6, ch), '/…/app')

assert.equal(ellipsisMiddlePath(PATH, 0, ch), PATH)
assert.equal(ellipsisMiddlePath(PATH, Number.NaN, ch), PATH)
assert.equal(ellipsisMiddlePath(PATH, Number.NEGATIVE_INFINITY, ch), PATH)

{
  const cjk = 'E:\\绘画临时存储\\drafts\\final'
  assert.equal(cjk.length, 22)
  assert.equal(ellipsisMiddlePath(cjk, 22, ch), cjk)
  assert.equal(ellipsisMiddlePath(cjk, 21, ch), 'E:\\绘画临时存储\\…\\final')
  assert.equal(ellipsisMiddlePath(cjk, 16, ch), 'E:\\…\\final')
}

assert.equal(ellipsisMiddlePath('E:\\UI-creator', 10, ch), 'E:\\UI-cre…')

for (const width of [1, 8, 12, 15, 20, 27, 37, 46, 80]) {
  const label = ellipsisMiddlePath(PATH, width, ch)
  assert.ok(ch(label) <= width, `${width}: ${label}`)
  assert.equal(label.includes('...'), false, label)
}

console.log('pathellipsis: 全部通过')
