// Wiki 请求边界自测:页面清单只收项目内相对路径,绝对路径与 .. 一律丢掉;
// 打开文档只认语种目录下记账形状的相对路径,越界或缺失都拒绝。
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { parseProjectRoot, parseWikiPanelRequest, parseWikiStart } from '../src/main/wikiRequest.ts'
import { resolveWikiDocPath } from '../src/main/wikiDocPath.ts'
import { createWikiState, resolveProjectDir, writeWikiState } from '../src/wiki/wikiStore.ts'

function basePage(): Record<string, unknown> {
  return {
    pageId: 'm:src/a.ts',
    kind: 'module',
    name: '模块 A',
    files: [{ path: 'src\\a.ts', inCount: 2, outCount: 1 }],
    attachedFiles: ['src\\b.css'],
    folders: ['src'],
    dependsOn: [{ moduleId: 'm:x', name: 'X', weight: 2 }],
    usedBy: []
  }
}

function startRequest(projectRoot: string): Record<string, unknown> {
  return {
    requestId: 'req-1',
    projectRoot,
    language: 'zh-CN',
    pages: [basePage()]
  }
}

function checkParse(base: string): void {
  const root = join(base, 'parse-project')
  const parsed = parseWikiStart(startRequest(root))
  assert.equal(parsed.ok, true, '正常请求能过')
  if (!parsed.ok) return
  assert.equal(parsed.request.pages.length, 1)
  const page = parsed.request.pages[0]
  assert.equal(page.files[0].path, 'src/a.ts', '反斜杠统一成相对路径')
  assert.equal(page.files[0].inCount, 2)
  assert.deepEqual(page.attachedFiles, ['src/b.css'])
  assert.deepEqual(page.folders, ['src'])
  assert.equal(page.dependsOn[0].moduleId, 'm:x')

  const absolutePage = basePage()
  absolutePage.files = [{ path: 'C:\\Windows\\win.ini' }]
  const absolute = parseWikiStart({ ...startRequest(root), pages: [absolutePage] })
  assert.equal(absolute.ok, false, '绝对路径页整页丢掉')

  const parentPage = basePage()
  parentPage.files = [{ path: '../secret.ts' }]
  assert.equal(parseWikiStart({ ...startRequest(root), pages: [parentPage] }).ok, false)

  const duplicate = parseWikiStart({
    ...startRequest(root),
    pages: [basePage(), { ...basePage(), name: '第二个同名页' }]
  })
  assert.equal(duplicate.ok, true)
  if (duplicate.ok) {
    assert.equal(duplicate.request.pages.length, 1, '重复页 id 只留第一个')
    assert.equal(duplicate.request.pages[0].name, '模块 A')
  }

  const options = parseWikiStart({
    ...startRequest(root),
    only: ['m:src/a.ts', '', 7],
    force: true,
    knownTags: ['UI', 'ui', '图谱']
  })
  assert.equal(options.ok, true)
  if (options.ok) {
    assert.deepEqual(options.request.only, ['m:src/a.ts'])
    assert.equal(options.request.force, true)
    assert.deepEqual(options.request.knownTags, ['UI', '图谱'], '标签去重按大小写')
  }

  assert.equal(parseWikiStart({ ...startRequest(root), requestId: '' }).ok, false)
  assert.equal(parseWikiStart({ ...startRequest(root), pages: [] }).ok, false)
  assert.equal(parseWikiStart(null).ok, false)

  assert.equal(parseProjectRoot(root), root)
  assert.equal(parseProjectRoot('relative/path'), null)
  assert.equal(parseProjectRoot(7), null)
}

/** 侧栏快照请求:页清单可以为空,但越界路径要丢、重复页只留第一个 */
function checkPanelRequest(base: string): void {
  const root = join(base, 'panel-project')
  const parsed = parseWikiPanelRequest({
    projectRoot: root,
    language: 'ja',
    pages: [basePage(), { ...basePage(), name: '重复页' }]
  })
  assert.equal(parsed.ok, true, '正常快照请求能过')
  if (parsed.ok) {
    assert.equal(parsed.request.language, 'ja', '语种原样带过')
    assert.equal(parsed.request.pages.length, 1, '重复页 id 只留第一个')
    assert.equal(parsed.request.pages[0].files[0].path, 'src/a.ts', '反斜杠统一')
  }

  const absolutePage = basePage()
  absolutePage.files = [{ path: 'C:\\Windows\\win.ini' }]
  const dropped = parseWikiPanelRequest({
    projectRoot: root,
    language: 'zh-CN',
    pages: [absolutePage]
  })
  assert.equal(dropped.ok, true, '越界页丢掉但请求本身不失败')
  if (dropped.ok) assert.equal(dropped.request.pages.length, 0, '绝对路径页不进快照')

  const empty = parseWikiPanelRequest({ projectRoot: root, language: 'zh-CN', pages: [] })
  assert.equal(empty.ok, true, '页清单可以为空')
  assert.equal(parseWikiPanelRequest({ projectRoot: root, language: '', pages: [] }).ok, false)
  assert.equal(parseWikiPanelRequest({ projectRoot: 'relative', language: 'zh-CN' }).ok, false)
  assert.equal(parseWikiPanelRequest(null).ok, false)
}

async function checkDocPath(base: string): Promise<void> {
  const wiki = join(base, 'doc', 'wiki')
  const project = join(base, 'doc', 'demo')
  await fs.mkdir(wiki, { recursive: true })
  const projectDir = await resolveProjectDir(wiki, project)
  await writeWikiState(projectDir, createWikiState(project, projectDir))
  const doc = join(projectDir, '中文（简体）', '模块', 'a.md')
  await fs.mkdir(dirname(doc), { recursive: true })
  await fs.writeFile(doc, '# A')

  const ok = await resolveWikiDocPath(
    { projectRoot: project, language: 'zh-CN', file: '模块/a.md' },
    wiki
  )
  assert.ok('path' in ok, '登记形状的文档能打开')

  const reject = async (payload: unknown, reason: string): Promise<void> => {
    const result = await resolveWikiDocPath(payload, wiki)
    assert.ok('error' in result, reason)
  }
  await reject({ projectRoot: project, language: 'zh-CN', file: '../x.md' }, '带 .. 的路径拒绝')
  await reject({ projectRoot: project, language: 'zh-CN', file: '模块/../a.md' }, '目录内绕路拒绝')
  await reject(
    { projectRoot: project, language: 'zh-CN', file: join(wiki, 'demo', '模块', 'a.md') },
    '绝对路径拒绝'
  )
  await reject({ projectRoot: project, language: 'xx', file: '模块/a.md' }, '未登记语种拒绝')
  await reject({ projectRoot: 'relative', language: 'zh-CN', file: '模块/a.md' }, '相对项目根拒绝')
  await reject({ projectRoot: project, language: 'zh-CN', file: '模块/missing.md' }, '文件缺失拒绝')
  const noLocation = await resolveWikiDocPath(
    { projectRoot: project, language: 'zh-CN', file: '模块/a.md' },
    null
  )
  assert.ok('error' in noLocation, '没选位置拒绝')
}

async function main(): Promise<void> {
  const base = join(tmpdir(), `codeatlas-wikirequest-${Date.now()}`)
  await fs.mkdir(base, { recursive: true })
  try {
    checkParse(base)
    checkPanelRequest(base)
    await checkDocPath(base)
    console.log('✅ Wiki 请求边界自测全部通过')
    console.log('   页面路径只收项目内相对路径 · 绝对路径与 .. 丢弃 · 重复页去重')
    console.log('   侧栏快照页清单可为空 · 越界页单独丢弃 · 语种与项目根缺一即拒')
    console.log('   打开文档越界/缺失/未登记语种一律拒绝 · 相对项目根拒绝')
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ Wiki 请求边界自测失败:', err)
  process.exit(1)
})
