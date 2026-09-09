import assert from 'node:assert/strict'
import { NOTES_MAX, NOTE_MAX_CHARS, notesStorageKey, parseNotes, pruneNotesAgainstTree, upsertNote } from '../src/shared/notes.ts'
import type { NoteMap } from '../src/shared/notes.ts'
import type { ScanDirNode, ScanFileNode } from '../src/shared/types.ts'

function fileNode(relPath: string): ScanFileNode {
  return { type: 'file', name: relPath.split('/').pop() ?? relPath, relPath }
}
function dirNode(relPath: string, children: Array<ScanDirNode | ScanFileNode> = [], extra: Partial<ScanDirNode> = {}): ScanDirNode {
  return { type: 'directory', name: relPath.split('/').pop() ?? relPath, relPath, children, ...extra }
}

function main(): void {
  // ── 1. parse:垃圾整条扔 ──
  assert.deepEqual(parseNotes(null), {}, 'null 回空表')
  assert.deepEqual(parseNotes('junk'), {}, '字符串回空表')
  assert.deepEqual(parseNotes([1, 2]), {}, '数组回空表')
  const mixed = parseNotes({
    good: { text: '  参考网页  ', t: 100 },
    noText: { t: 100 },
    badTime: { text: 'x', t: -5 },
    emptyText: { text: '   ', t: 100 },
    '': { text: 'x', t: 100 }
  })
  assert.deepEqual(Object.keys(mixed), ['good'], '只留干净条目,空键空文坏时间戳全扔')
  assert.equal(mixed['good']?.text, '参考网页', '正文去首尾空白')

  // ── 2. parse:超长截断 + 超量淘汰最旧 ──
  const long = parseNotes({ a: { text: '长'.repeat(NOTE_MAX_CHARS + 10), t: 1 } })
  assert.equal(long['a']?.text.length, NOTE_MAX_CHARS, '超长截到上限')
  const flood: NoteMap = {}
  for (let i = 0; i < NOTES_MAX + 30; i++) flood[`f${i}`] = { text: `n${i}`, t: i + 1 }
  const capped = parseNotes(flood)
  assert.equal(Object.keys(capped).length, NOTES_MAX, `超量淘汰:只留 ${NOTES_MAX} 条`)
  assert.ok(capped[`f${NOTES_MAX + 29}`] !== undefined && capped['f0'] === undefined, '淘汰的是最旧的')

  // ── 3. upsert:增/改/删 + 时间戳刷新 + 老条目让位 ──
  let m: NoteMap = { old: { text: '旧备注', t: 1 } }
  m = upsertNote(m, 'src/a.ts', ' 扫描入口 ', 50)
  assert.equal(m['src/a.ts']?.text, '扫描入口', '新增去空白')
  m = upsertNote(m, 'src/a.ts', '扫描器入口', 99)
  assert.equal(m['src/a.ts']?.text, '扫描器入口', '更新换正文')
  assert.equal(m['src/a.ts']?.t, 99, '更新盖新时间戳')
  m = upsertNote(m, 'old', '', 100)
  assert.equal(m['old'], undefined, '空串 = 删除')
  let full: NoteMap = {}
  for (let i = 0; i < NOTES_MAX; i++) full = upsertNote(full, `k${i}`, `v${i}`, i + 1)
  full = upsertNote(full, 'newest', '新', 999)
  assert.equal(Object.keys(full).length, NOTES_MAX, 'upsert 也守上限')
  assert.ok(full['newest'] !== undefined && full['k0'] === undefined, '挤掉最旧的 k0')

  // ── 4. prune:孤儿回收,但 lazy/truncated 底下宁可多留不误删 ──
  const tree = dirNode('', [
    fileNode('README.md'),
    dirNode('lazy-dir', [fileNode('placeholder')], { lazy: true }),
    dirNode('cut', [fileNode('cut/a.ts')], { truncated: true })
  ])
  const notes: NoteMap = {
    'README.md': { text: '门面', t: 1 },
    'deleted/old.ts': { text: '孤儿:这个目录已经不在树上了', t: 2 },
    'lazy-dir/reports/file.ts': { text: '还没展开的深处', t: 3 },
    'cut/hidden.ts': { text: '被预算掐住没露面的', t: 4 }
  }
  const pruned = pruneNotesAgainstTree(notes, tree)
  assert.ok(pruned['README.md'] !== undefined, '活着的保留')
  assert.equal(pruned['deleted/old.ts'], undefined, '确知已删的孤儿回收')
  assert.ok(pruned['lazy-dir/reports/file.ts'] !== undefined, 'lazy 目录底下不误删')
  assert.ok(pruned['cut/hidden.ts'] !== undefined, 'truncated 目录底下不误删')

  // ── 5. 存储键归一化:同一项目不裂成两份 ──
  assert.equal(notesStorageKey('E:\\A\\B'), notesStorageKey('e:/a/b/'), '大小写和斜杠方向归一')

  console.log('✅ 手动备注自测全部通过')
  console.log('   parse 垃圾回收 · 截断与上限 · upsert 增改删 · 孤儿清收(懒/截断不误删) · 存储键归一化')
}

main()
