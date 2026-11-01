// Wiki 存储自测:设置默认值/坏值回退/读写往返;位置校验(空、不存在、文件、仓库内、空目录直接用、
// 非空无标记改用子目录、已带标记直接用);Windows 路径大小写不敏感。
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  sanitizeWikiSettings,
  loadWikiSettings,
  saveWikiSettings,
  wikiSettingsFilePath
} from '../src/wiki/wikiSettings.ts'
import { isInsideRoot, resolveWikiLocation } from '../src/wiki/wikiLocation.ts'
import {
  allocatePageFile,
  createWikiState,
  languageDir,
  pageFileExists,
  readWikiState,
  removePageFile,
  resolveProjectDir,
  sanitizeFileName,
  savePage,
  shortProjectCode,
  writeWikiState,
  type WikiPageRecord
} from '../src/wiki/wikiStore.ts'
import { WIKI_PROMPT_VERSION, wikiInputHash } from '../src/wiki/wikiHash.ts'
import { DEFAULT_WIKI_LANGUAGE, WIKI_MARKER_FILE, WIKI_SUBDIRECTORY } from '../src/shared/wikiTypes.ts'

function checkSettings(base: string): void {
  const defaults = {
    location: null,
    language: DEFAULT_WIKI_LANGUAGE,
    hasChosenLocation: false
  }
  assert.deepEqual(sanitizeWikiSettings(null), defaults, '没存过时用默认值')
  assert.deepEqual(
    sanitizeWikiSettings({ location: '   ', language: 'xx', hasChosenLocation: true }),
    defaults,
    '空白位置与不认识的语种都回落默认'
  )
  const chosen = sanitizeWikiSettings({
    location: join(base, 'wiki'),
    language: 'ja',
    hasChosenLocation: false
  })
  assert.equal(chosen.language, 'ja', '认识的语种要保留')
  assert.equal(chosen.hasChosenLocation, true, '有位置就视为用户已选过,不认自相矛盾的旧字段')

  const userData = join(base, 'user-data')
  assert.deepEqual(loadWikiSettings(userData), defaults, '没写过配置文件时回默认')
  saveWikiSettings(userData, { location: join(base, 'wiki'), language: 'fr', hasChosenLocation: true })
  assert.deepEqual(
    loadWikiSettings(userData),
    { location: join(base, 'wiki'), language: 'fr', hasChosenLocation: true },
    '写进去的值要能原样读回'
  )
  assert.ok(wikiSettingsFilePath(userData).endsWith('wiki-settings.json'), '配置文件名固定')
  assert.equal(
    loadWikiSettings(join(base, 'missing-user-data')).location,
    null,
    '配置文件读不到时不抛错'
  )
}

async function checkLocation(base: string): Promise<void> {
  const project = join(base, 'project')
  const empty = join(base, 'empty')
  const busy = join(base, 'busy')
  const marked = join(base, 'marked')
  await fs.mkdir(join(project, 'src'), { recursive: true })
  await fs.mkdir(empty, { recursive: true })
  await fs.mkdir(busy, { recursive: true })
  await fs.mkdir(marked, { recursive: true })
  await fs.writeFile(join(busy, 'user.txt'), 'mine', 'utf8')
  await fs.writeFile(join(marked, WIKI_MARKER_FILE), '{}', 'utf8')
  const projectRoots = [project]

  const reject = async (chosen: string, why: string): Promise<void> => {
    const result = await resolveWikiLocation({ chosen, projectRoots })
    assert.equal(result.ok, false, why)
    if (!result.ok) assert.ok(result.reason.length > 0, `${why}: 要说明原因`)
  }
  await reject('', '空路径应拒绝')
  await reject(join(base, 'never-created'), '不存在的文件夹应拒绝')
  await reject(join(project, 'src'), '仓库内的文件夹应拒绝')
  await reject(join(project, 'src', '..', '..', 'project', 'src'), '带 .. 的仓库内路径同样应拒绝')

  const emptyResult = await resolveWikiLocation({ chosen: empty, projectRoots })
  assert.ok(emptyResult.ok, '空文件夹可以直接用')
  if (emptyResult.ok) {
    assert.equal(emptyResult.location, await fs.realpath(empty), '空文件夹用用户选的原位置')
    assert.equal(emptyResult.usedSubdirectory, false, '空文件夹不建子目录')
  }

  const busyResult = await resolveWikiLocation({ chosen: busy, projectRoots })
  assert.ok(busyResult.ok, '非空但无标记的文件夹也应接受')
  if (busyResult.ok) {
    assert.equal(
      busyResult.location,
      join(await fs.realpath(busy), WIKI_SUBDIRECTORY),
      '非空且没有应用标记时改用其下 CodeAtlasWiki'
    )
    assert.equal(busyResult.usedSubdirectory, true, '要告诉界面换了子目录')
  }

  const markedResult = await resolveWikiLocation({ chosen: marked, projectRoots })
  assert.ok(markedResult.ok, '已带标记的文件夹直接可用')
  if (markedResult.ok) {
    assert.equal(markedResult.location, await fs.realpath(marked), '有标记就不再套子目录')
    assert.equal(markedResult.usedSubdirectory, false, '有标记不算换目录')
  }

  if (process.platform === 'win32') {
    await reject(project.toUpperCase(), 'Windows 下大小写不同的仓库内路径也应拒绝')
    assert.equal(isInsideRoot('C:\\Work\\Proj\\src', 'c:\\work\\proj'), true, '包含判断不分大小写')
    assert.equal(isInsideRoot('C:\\Work\\ProjTwo', 'C:\\Work\\Proj'), false, '同前缀的兄弟目录不算包含')
  }
  assert.equal(isInsideRoot('/a/b/c', '/a/b'), true, '子路径算包含')
  assert.equal(isInsideRoot('/a/bc', '/a/b'), false, '只是前缀相同不算包含')
}

function pageRecord(overrides: Partial<WikiPageRecord> = {}): WikiPageRecord {
  return {
    pageId: 'm:src/a.ts',
    kind: 'module',
    file: '模块/A.md',
    inputHash: 'h',
    promptVersion: WIKI_PROMPT_VERSION,
    model: 'test-model',
    generatedAt: '2026-11-02T00:00:00.000Z',
    status: 'done',
    name: 'A',
    ...overrides
  }
}

async function checkStore(base: string): Promise<void> {
  assert.ok(!/[<>:"/\\|?*]/.test(sanitizeFileName('a/b:c*?"<>|')), '文件名不得留 Windows 非法字符')
  assert.ok(sanitizeFileName('a/b:c*?"<>|').startsWith('a-b-c'), '非法字符换成连字符')
  assert.equal(sanitizeFileName('CON'), '_CON', '设备保留名要避开')
  assert.equal(sanitizeFileName('con.txt'), '_con.txt', '带扩展名的保留名同样避开')
  assert.equal(sanitizeFileName('  ..  '), 'untitled', '只剩点和空格时给占位名')
  assert.equal(sanitizeFileName('x'.repeat(200)).length, 80, '超长名截到 80')

  const wikiRoot = join(base, 'wiki-root')
  await fs.mkdir(wikiRoot, { recursive: true })
  const projectA = join(base, 'projects', 'demo')
  const projectB = join(base, 'elsewhere', 'demo')
  const dirA = await resolveProjectDir(wikiRoot, projectA)
  assert.equal(dirA, join(wikiRoot, 'demo'), '不重名时直接用项目名')
  await writeWikiState(dirA, createWikiState(projectA, dirA))
  assert.equal(await resolveProjectDir(wikiRoot, projectA), dirA, '同一项目重解析稳定')
  const dirB = await resolveProjectDir(wikiRoot, projectB)
  assert.equal(
    dirB,
    join(wikiRoot, `demo-${shortProjectCode(projectB)}`),
    '重名项目加短编号'
  )
  assert.equal(await resolveProjectDir(wikiRoot, projectB), dirB, '重名项目重解析也稳定')

  assert.equal(allocatePageFile([], 'module', 'A', 'm:src/a.ts'), '模块/A.md', '模块页进模块目录')
  assert.equal(allocatePageFile([], 'group', 'G', 'g:root'), '未归类/G.md', '散件组进未归类目录')
  assert.equal(
    allocatePageFile([pageRecord()], 'module', 'A', 'm:src/a.ts'),
    '模块/A.md',
    '同一页重生成沿用原路径'
  )
  const collided = allocatePageFile(
    [pageRecord({ pageId: 'm:src/b.ts', file: '模块/A.md' })],
    'module',
    'A',
    'm:src/a.ts'
  )
  assert.notEqual(collided, '模块/A.md', '重名要换文件名')
  assert.ok(collided.startsWith('模块/A-') && collided.endsWith('.md'), '重名追加短编号')

  const projectDir = join(base, 'project-store')
  const code = 'zh-CN'
  const own = pageRecord({ file: allocatePageFile([], 'module', 'A', 'm:src/a.ts') })
  await savePage({ projectDir, languageCode: code, record: own, markdown: '# A\n' })
  assert.equal(await pageFileExists(projectDir, code, own), true, '写完后文件存在')
  assert.equal(
    await fs.readFile(join(languageDir(projectDir, code), own.file), 'utf8'),
    '# A\n',
    '内容原样落盘'
  )
  const moduleDir = join(languageDir(projectDir, code), '模块')
  assert.ok(
    !(await fs.readdir(moduleDir)).some((name) => name.includes('.tmp')),
    '原子写不留下临时文件'
  )

  const renamed = pageRecord({ name: 'B', file: '模块/B.md' })
  await savePage({
    projectDir,
    languageCode: code,
    record: renamed,
    markdown: '# B\n',
    previousFile: own.file
  })
  assert.equal(await pageFileExists(projectDir, code, renamed), true, '改名后新文件存在')
  assert.equal(await pageFileExists(projectDir, code, own), false, '改名后旧文件删除')

  const userFile = join(moduleDir, 'user.md')
  await fs.writeFile(userFile, 'mine', 'utf8')
  await removePageFile(projectDir, code, renamed.file)
  assert.equal(await fs.readFile(userFile, 'utf8'), 'mine', '清理不碰用户自己放的文件')
  assert.equal(await pageFileExists(projectDir, code, renamed), false, '文件缺失能被识别')

  assert.equal((await readWikiState(join(base, 'no-state'))).status, 'missing', '没记过账')
  const state = createWikiState(projectA, projectDir)
  state.languages[code] = {
    code,
    label: '中文（简体）',
    pages: { 'm:src/a.ts': pageRecord({ file: '模块/B.md' }) }
  }
  await writeWikiState(projectDir, state)
  const read = await readWikiState(projectDir)
  assert.equal(read.status, 'ok', '正常记账能读回')
  if (read.status === 'ok') {
    assert.equal(read.state.languages[code].pages['m:src/a.ts'].file, '模块/B.md')
  }
  const badDir = join(base, 'bad-state')
  await fs.mkdir(join(badDir, '.codeatlas'), { recursive: true })
  await fs.writeFile(join(badDir, '.codeatlas', 'state.json'), 'not json', 'utf8')
  assert.equal((await readWikiState(badDir)).status, 'damaged', '坏 JSON 记为损坏')
  const wrongDir = join(base, 'wrong-state')
  await fs.mkdir(join(wrongDir, '.codeatlas'), { recursive: true })
  await fs.writeFile(join(wrongDir, '.codeatlas', 'state.json'), '{"schema":2}', 'utf8')
  assert.equal((await readWikiState(wrongDir)).status, 'damaged', '不认识的版本记为损坏')
}

function checkHash(): void {
  const input = {
    language: 'zh-CN',
    members: ['src/a.ts', 'src/b.ts'],
    contentHashes: new Map<string, string | null>([
      ['src/a.ts', 'a'.repeat(64)],
      ['src/b.ts', null]
    ]),
    attached: ['src/a.css']
  }
  const hash = wikiInputHash(input)
  assert.match(hash, /^[0-9a-f]{64}$/, '缓存键是 SHA-256')
  assert.equal(
    wikiInputHash({ ...input, members: ['src/b.ts', 'src/a.ts'] }),
    hash,
    '成员顺序不影响缓存键'
  )
  assert.notEqual(
    wikiInputHash({
      ...input,
      contentHashes: new Map<string, string | null>([
        ['src/a.ts', 'b'.repeat(64)],
        ['src/b.ts', null]
      ])
    }),
    hash,
    '内容变化必须换缓存键'
  )
  assert.notEqual(wikiInputHash({ ...input, language: 'en' }), hash, '换语种要重新生成')
  assert.notEqual(wikiInputHash({ ...input, attached: [] }), hash, '附挂文件变化要重新生成')
  assert.notEqual(
    wikiInputHash({ ...input, groupMembers: ['README.md'] }),
    hash,
    '散件组成员变化要重新生成'
  )
}

async function main(): Promise<void> {
  const base = join(tmpdir(), `codeatlas-wiki-${Date.now()}`)
  await fs.mkdir(base, { recursive: true })
  try {
    checkSettings(base)
    await checkLocation(base)
    await checkStore(base)
    checkHash()
    console.log('✅ Wiki 存储自测全部通过')
    console.log(
      '   设置默认值与回退 · 配置读写往返 · 仓库内拒绝 · 非空无标记改用子目录 · 大小写不敏感'
    )
    console.log(
      '   文件名清洗与重名 · 项目目录防冲突 · MD 原子写 · 记账读写与损坏识别 · 改名删旧 · 缓存键含语种'
    )
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ Wiki 存储自测失败:', err)
  process.exit(1)
})
