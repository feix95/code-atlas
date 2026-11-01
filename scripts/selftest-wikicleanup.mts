// Wiki 清理自测:只删记账内的文档、索引与记账,用户文件保留;空根连标记一起收;
// 单项目清理不动别家;记账损坏整次拒绝;生成中拒绝;扫描篇数与占用。
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { cleanupWiki, scanWikiRoot } from '../src/wiki/wikiCleanup.ts'
import {
  createWikiState,
  languageDir,
  pageFilePath,
  WIKI_README,
  WIKI_STATE_DIR,
  WIKI_STATE_FILE,
  writeWikiState,
  type WikiPageRecord
} from '../src/wiki/wikiStore.ts'
import { WIKI_MARKER_FILE } from '../src/shared/wikiTypes.ts'

const LANG = 'zh-CN'
const LANG_DIR = '简体中文'

async function exists(path: string): Promise<boolean> {
  return fs.access(path).then(
    () => true,
    () => false
  )
}

async function seedRoot(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(join(root, WIKI_MARKER_FILE), '{"schema":1}')
}

async function seedProject(dir: string, files: string[]): Promise<void> {
  const state = createWikiState(dir, dir)
  const pages: Record<string, WikiPageRecord> = {}
  for (const file of files) {
    const pageId = `m:${file}`
    pages[pageId] = {
      pageId,
      kind: 'module',
      file,
      inputHash: 'hash',
      promptVersion: 1,
      model: 'test-model',
      generatedAt: '2026-11-02T12:00:00.000Z',
      status: 'done',
      name: file
    }
    const full = pageFilePath(dir, LANG, { file })
    await fs.mkdir(dirname(full), { recursive: true })
    await fs.writeFile(full, `# ${file}`)
  }
  state.languages[LANG] = { code: LANG, label: LANG_DIR, pages }
  await writeWikiState(dir, state)
  await fs.writeFile(join(languageDir(dir, LANG), WIKI_README), '# index')
}

async function checkCleanupAll(base: string): Promise<void> {
  const root = join(base, 'all', 'wiki')
  const projectA = join(root, 'demo-a')
  const projectB = join(root, 'demo-b')
  await seedRoot(root)
  await seedProject(projectA, ['模块/a.md', '模块/b.md'])
  await seedProject(projectB, ['未归类/c.md'])
  await fs.writeFile(join(languageDir(projectA, LANG), 'user-notes.txt'), 'mine')

  const before = await scanWikiRoot(root)
  assert.equal(before.projects, 2, '扫描认出两个项目')
  assert.equal(before.pages, 3, '扫描篇数按记账')
  assert.equal(before.files, 3, '扫描文件数只算还在磁盘上的')
  assert.ok(before.bytes > 0, '扫描占用大于 0')
  assert.deepEqual(before.damaged, [], '没有损坏项目')

  const result = await cleanupWiki({ root, isGenerating: false })
  assert.equal(result.ok, true, '清理应当成功')
  if (!result.ok) return
  assert.equal(result.projects, 2)
  assert.equal(result.files, 5, '三段文档加两个索引页')
  assert.ok(result.bytes > 0)
  assert.equal(result.removedRoot, false, '还有用户文件,根目录要保留')

  assert.equal(await exists(pageFilePath(projectA, LANG, { file: '模块/a.md' })), false)
  assert.equal(await exists(join(languageDir(projectA, LANG), WIKI_README)), false, '索引页一起清')
  assert.equal(await exists(join(projectA, WIKI_STATE_DIR, WIKI_STATE_FILE)), false, '记账本身也删')
  assert.equal(await exists(projectA), true, '项目目录还有用户文件,保留')
  assert.equal(
    await exists(join(languageDir(projectA, LANG), 'user-notes.txt')),
    true,
    '用户文件不动'
  )
  assert.equal(await exists(projectB), false, '清空的项目目录一起收掉')
  assert.equal(await exists(join(root, WIKI_MARKER_FILE)), true, '根目录还没空,标记保留')
}

async function checkRootRemoval(base: string): Promise<void> {
  const root = join(base, 'root', 'wiki')
  await seedRoot(root)
  await seedProject(join(root, 'demo'), ['模块/a.md'])
  const result = await cleanupWiki({ root, isGenerating: false })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.removedRoot, true, '只剩标记时连根一起收')
  assert.equal(await exists(root), false, '根目录已删除')

  const emptyRoot = join(base, 'empty', 'wiki')
  await seedRoot(emptyRoot)
  const empty = await cleanupWiki({ root: emptyRoot, isGenerating: false })
  assert.equal(empty.ok, true)
  if (empty.ok) {
    assert.equal(empty.projects, 0)
    assert.equal(empty.removedRoot, true, '只有标记的空根也收掉')
  }
  assert.equal(await exists(emptyRoot), false)
}

async function checkProjectScope(base: string): Promise<void> {
  const root = join(base, 'scope', 'wiki')
  const projectA = join(root, 'demo-a')
  const projectB = join(root, 'demo-b')
  await seedRoot(root)
  await seedProject(projectA, ['模块/a.md'])
  await seedProject(projectB, ['模块/b.md'])
  const result = await cleanupWiki({ root, projectDir: projectA, isGenerating: false })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.projects, 1)
  assert.equal(await exists(projectA), false)
  assert.equal(
    await exists(pageFilePath(projectB, LANG, { file: '模块/b.md' })),
    true,
    '别的项目不动'
  )
  assert.equal(await exists(join(root, WIKI_MARKER_FILE)), true, '单项目清理不删根标记')
}

async function checkDamaged(base: string): Promise<void> {
  const root = join(base, 'damaged', 'wiki')
  const projectA = join(root, 'demo-a')
  const projectB = join(root, 'demo-b')
  await seedRoot(root)
  await seedProject(projectA, ['模块/a.md'])
  await seedProject(projectB, ['模块/b.md'])
  await fs.writeFile(join(projectB, WIKI_STATE_DIR, WIKI_STATE_FILE), '{ not json')

  const scan = await scanWikiRoot(root)
  assert.deepEqual(scan.damaged, [projectB], '扫描标出损坏项目')

  const all = await cleanupWiki({ root, isGenerating: false })
  assert.equal(all.ok, false, '有损坏项目时整次拒绝')
  if (!all.ok) assert.deepEqual(all.damaged, [projectB])
  assert.equal(
    await exists(pageFilePath(projectA, LANG, { file: '模块/a.md' })),
    true,
    '拒绝时不能先删好项目'
  )
  assert.equal(await exists(join(projectB, WIKI_STATE_DIR, WIKI_STATE_FILE)), true, '损坏记账不删')

  const one = await cleanupWiki({ root, projectDir: projectB, isGenerating: false })
  assert.equal(one.ok, false, '单项目清理同样拒绝')
}

async function checkRefusals(base: string): Promise<void> {
  const root = join(base, 'refuse', 'wiki')
  const project = join(root, 'demo')
  await seedRoot(root)
  await seedProject(project, ['模块/a.md'])

  const busy = await cleanupWiki({ root, isGenerating: true })
  assert.equal(busy.ok, false, '生成中拒绝清理')
  if (!busy.ok) assert.match(busy.reason, /生成/)
  assert.equal(
    await exists(pageFilePath(project, LANG, { file: '模块/a.md' })),
    true,
    '拒绝时文件还在'
  )

  const outside = await cleanupWiki({
    root,
    projectDir: join(base, 'refuse', 'outside'),
    isGenerating: false
  })
  assert.equal(outside.ok, false, '根目录外的项目拒绝清理')

  const missing = await cleanupWiki({ root: join(base, 'refuse', 'gone'), isGenerating: false })
  assert.equal(missing.ok, false, '根目录不存在时报告清楚')
}

async function main(): Promise<void> {
  const base = join(tmpdir(), `codeatlas-wikicleanup-${Date.now()}`)
  await fs.mkdir(base, { recursive: true })
  try {
    await checkCleanupAll(base)
    await checkRootRemoval(base)
    await checkProjectScope(base)
    await checkDamaged(base)
    await checkRefusals(base)
    console.log('✅ Wiki 清理自测全部通过')
    console.log('   只删记账文档与索引 · 用户文件保留 · 空根连标记一起收 · 单项目不动别家')
    console.log('   记账损坏整次拒绝 · 生成中拒绝 · 越界项目拒绝 · 扫描篇数与占用')
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ Wiki 清理自测失败:', err)
  process.exit(1)
})
