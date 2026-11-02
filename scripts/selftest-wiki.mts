// Wiki 自测:设置默认值/坏值回退/读写往返;位置校验(空、不存在、文件、仓库内、空目录直接用、
// 非空无标记改用子目录、已带标记直接用);Windows 路径大小写不敏感;提示词只带当前页、
// 隐私清洗、语种注入;输出逐字段校验与重试注记;8 语种文案齐全;预算裁剪顺序。
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
  WIKI_README,
  writeWikiState,
  type WikiPageRecord
} from '../src/wiki/wikiStore.ts'
import { WIKI_PROMPT_VERSION, wikiInputHash } from '../src/wiki/wikiHash.ts'
import { groupScatteredFiles } from '../src/shared/wikiGroups.ts'
import {
  DEFAULT_WIKI_LANGUAGE,
  WIKI_DOC_MAX_CHARS,
  WIKI_MARKER_FILE,
  WIKI_SUBDIRECTORY,
  type WikiPageFacts,
  type WikiPageSource
} from '../src/shared/wikiTypes.ts'
import {
  buildWikiMessages,
  fitWikiFactsToBudget,
  isAbsoluteWikiPath,
  isSensitiveWikiPath,
  sanitizeWikiFacts,
  withWikiRetryNote
} from '../src/ai/wikiPrompt.ts'
import {
  displayModelName,
  languageMatches,
  parseWikiOutput,
  renderWikiMarkdown,
  requestWikiContent,
  wikiDocExcerpt
} from '../src/ai/wikiOutput.ts'
import { panelPageOf } from '../src/wiki/wikiPanel.ts'
import { renderWikiIndex, wikiIndexLink, writeWikiIndex } from '../src/wiki/wikiIndex.ts'
import { WIKI_COPY, wikiCopy, wikiSectionTitles } from '../src/ai/wikiCopy.ts'
import { TRANSLATE_LANGS } from '../src/shared/translateLangs.ts'
import { estimateTokens } from '../src/shared/aiText.ts'
import { prepareWikiPageFacts } from '../src/wiki/wikiPageFacts.ts'

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
  saveWikiSettings(userData, {
    location: join(base, 'wiki'),
    language: 'fr',
    hasChosenLocation: true
  })
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
    assert.equal(
      isInsideRoot('C:\\Work\\ProjTwo', 'C:\\Work\\Proj'),
      false,
      '同前缀的兄弟目录不算包含'
    )
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
  assert.equal(dirB, join(wikiRoot, `demo-${shortProjectCode(projectB)}`), '重名项目加短编号')
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

  state.languages[code].pages['m:src/a.ts'] = pageRecord({
    file: '模块/B.md',
    summary: '  一句话简介  ',
    tags: ['UI', 'UI', '   ', 'a'.repeat(25), '图谱'],
    keyFiles: ['src/a.ts', 'src/a.ts', 7] as unknown as string[],
    excerpt: 'x'.repeat(401)
  })
  await writeWikiState(projectDir, state)
  const metaRead = await readWikiState(projectDir)
  assert.equal(metaRead.status, 'ok')
  if (metaRead.status === 'ok') {
    const page = metaRead.state.languages[code].pages['m:src/a.ts']
    assert.equal(page.summary, '一句话简介', '摘要去空白后保留')
    assert.deepEqual(page.tags, ['UI', '图谱'], '标签去重,空白与超长的丢掉')
    assert.deepEqual(page.keyFiles, ['src/a.ts'], '关键文件只留非空字符串')
    assert.equal(page.excerpt, undefined, '超长摘录整条丢掉')
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

/** 侧栏面板状态:缺失优先于过期,拿不到当前哈希不判过期,失败状态原样保留 */
function checkPanel(): void {
  const source: WikiPageSource = {
    pageId: 'm:src/a.ts',
    kind: 'module',
    name: 'A',
    files: [],
    attachedFiles: [],
    folders: [],
    dependsOn: [],
    usedBy: []
  }
  const record = pageRecord({
    summary: '简介',
    tags: ['文件'],
    keyFiles: ['src/a.ts'],
    excerpt: '摘要'
  })
  const done = panelPageOf({ source, record, exists: true, currentHash: 'h' })
  assert.equal(done.status, 'done')
  assert.equal(done.summary, '简介', '摘要带进面板')
  assert.deepEqual(done.tags, ['文件'], '标签带进面板')
  assert.deepEqual(done.keyFiles, ['src/a.ts'], '关键文件带进面板')
  assert.equal(done.excerpt, '摘要')
  assert.equal(
    panelPageOf({ source, record, exists: false, currentHash: 'h' }).status,
    'missing',
    '文件不在优先报缺失'
  )
  assert.equal(
    panelPageOf({ source, record, exists: true, currentHash: 'other' }).status,
    'stale',
    '内容变了报过期'
  )
  assert.equal(
    panelPageOf({ source, record, exists: true, currentHash: null }).status,
    'done',
    '拿不到当前哈希(分析未完成)不判过期'
  )
  assert.equal(
    panelPageOf({
      source,
      record: { ...record, promptVersion: WIKI_PROMPT_VERSION + 1 },
      exists: true,
      currentHash: 'h'
    }).status,
    'stale',
    '提示词版本变了也过期'
  )
  assert.equal(
    panelPageOf({ source, record: { ...record, status: 'failed' }, exists: true, currentHash: 'h' })
      .status,
    'failed',
    '失败状态原样保留'
  )
  const none = panelPageOf({ source, record: undefined, exists: false, currentHash: null })
  assert.equal(none.status, 'none', '没有记账 = 未生成')
  assert.deepEqual([none.name, none.summary, none.file], ['', '', ''], '未生成页给空字段')
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

function checkGroups(): void {
  const files = [
    'src/logo.png',
    'README.md',
    'package.json',
    '.git/hooks/pre-commit',
    '.husky/pre-push',
    'docs/guide.md',
    'assets/app.css',
    'config/app.json',
    'scripts/tool.py',
    'README.md'
  ]
  const groups = groupScatteredFiles(files)
  assert.deepEqual(
    groups.map((group) => group.kind),
    ['root-config', 'git-hooks', 'docs-assets', 'other'],
    '四组按固定顺序排列'
  )
  const byKind = Object.fromEntries(groups.map((group) => [group.kind, group]))
  assert.deepEqual(byKind['root-config'].files, ['package.json'], '根目录配置归项目根配置')
  assert.deepEqual(
    byKind['git-hooks'].files,
    ['.git/hooks/pre-commit', '.husky/pre-push'],
    'Git 钩子单列一组'
  )
  assert.deepEqual(
    byKind['docs-assets'].files,
    ['README.md', 'assets/app.css', 'docs/guide.md', 'src/logo.png'],
    '文档与静态资源归一组,重复路径只算一次'
  )
  assert.deepEqual(
    byKind['other'].files,
    ['config/app.json', 'scripts/tool.py'],
    '其余散件归其他目录散件'
  )
  assert.equal(byKind['git-hooks'].name, 'Git 钩子', '组名固定')
  assert.equal(byKind['root-config'].id, 'g:root-config', '组 id 带 g: 前缀')
  assert.equal(
    JSON.stringify(groupScatteredFiles([...files].reverse())),
    JSON.stringify(groups),
    '输入顺序不影响分组结果'
  )
  assert.deepEqual(groupScatteredFiles([]), [], '没有散件就没有组')
}

function moduleFacts(): WikiPageFacts {
  return {
    language: { code: 'en', name: 'English' },
    kind: 'module',
    project: { name: 'demo', moduleCount: 2, groupCount: 4, knownTags: ['UI'] },
    module: {
      id: 'm:src/a.ts',
      folders: ['src'],
      files: [
        {
          path: 'src/a.ts',
          language: 'typescript',
          inCount: 5,
          outCount: 2,
          exports: ['run'],
          functions: ['run'],
          classes: [],
          interfaces: [],
          reactComponents: []
        },
        {
          path: 'src/b.ts',
          language: 'typescript',
          inCount: 1,
          outCount: 1,
          exports: ['helper'],
          functions: ['helper'],
          classes: [],
          interfaces: [],
          reactComponents: []
        }
      ],
      attachedFiles: ['src/a.css'],
      dependsOn: [{ kind: 'module', moduleId: 'm:src/c.ts', name: null, weight: 2 }],
      usedBy: []
    },
    excerpts: [{ path: 'src/a.ts', head: 'export function run() {}' }],
    truncated: { files: 0, symbols: 0, excerpts: 0 }
  }
}

function checkPrompt(): void {
  const facts = moduleFacts()
  const messages = buildWikiMessages(facts)
  const { user } = messages
  assert.ok(
    user.startsWith(
      '<target_language>English - write name, summary, tags and every section in this language.</target_language>'
    ),
    '语种标签沿用翻译功能的写法,并要求全部字段用目标语种'
  )
  assert.ok(
    user.includes('<section_plan>\n1. Introduction\n2. Location') &&
      user.includes('8. Conclusion\n</section_plan>'),
    '八段标题按语种注入 section_plan'
  )
  assert.ok(user.includes('<page_facts>') && user.endsWith('</page_facts>'), '事实只放 page_facts')
  const parsed = JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1)) as {
    kind: string
    module: { id: string; files: Array<{ path: string }> }
  }
  assert.equal(parsed.kind, 'module', '模块篇标 module')
  assert.equal(parsed.module.id, 'm:src/a.ts', '只放当前这一篇')
  assert.deepEqual(
    parsed.module.files.map((file) => file.path),
    ['src/a.ts', 'src/b.ts'],
    '文件清单原样带上'
  )
  assert.ok(!user.includes('m:src/d.ts'), '别的模块不进当前页')
  assert.ok(!user.includes('src/other'), '别的页文件不进当前页')
  for (const lang of TRANSLATE_LANGS) {
    const tagged = buildWikiMessages({
      ...facts,
      language: { code: lang.code, name: lang.enName }
    })
    assert.ok(
      tagged.user.includes(
        `<target_language>${lang.enName} - write name, summary, tags and every section in this language.</target_language>`
      ),
      `${lang.code} 的语种要注入`
    )
    for (const title of wikiSectionTitles(lang.code)) {
      assert.ok(tagged.user.includes(title), `${lang.code} 的段落标题 ${title} 要进 section_plan`)
    }
  }

  const leaky = structuredClone(facts)
  leaky.excerpts = [
    { path: 'src/a.ts', head: 'see C:\\Users\\Alice\\proj\\src\\a.ts and /home/bob/work/x.ts' }
  ]
  const cleaned = buildWikiMessages(leaky).user
  assert.ok(!cleaned.includes('Alice'), '用户名不得进提示词')
  assert.ok(!cleaned.includes('C:\\'), '盘符路径不得进提示词')
  assert.ok(!cleaned.includes('/home/bob'), 'Unix 家目录不得进提示词')
  assert.ok(cleaned.includes('[local-path]'), '本机路径换成占位')
  assert.ok(!JSON.stringify(sanitizeWikiFacts(leaky)).includes('Alice'), '清洗函数可单独使用')

  const urls = structuredClone(facts)
  urls.excerpts = [
    {
      path: 'src/a.ts',
      head: 'docs https://example.com/Users/guide and C:\\Users\\Alice\\a.ts'
    }
  ]
  const urlUser = buildWikiMessages(urls).user
  assert.ok(urlUser.includes('https://example.com/Users/guide'), '公开网址保持原样')
  assert.ok(!urlUser.includes('Alice'), '同一段里的本机路径照常清洗')

  const secret = structuredClone(facts)
  secret.module.files[0] = { ...secret.module.files[0], path: '.env.local' }
  secret.excerpts = [
    { path: '.env.local', head: 'SECRET_TOKEN=abc' },
    { path: 'src/a.ts', head: 'export const ok = 1' }
  ]
  const secretUser = buildWikiMessages(secret).user
  assert.ok(!secretUser.includes('SECRET_TOKEN'), '敏感文件不给摘录')
  assert.ok(secretUser.includes('.env.local'), '敏感文件仍然只列名字')
  assert.ok(secretUser.includes('export const ok = 1'), '正常摘录照常带')

  assert.equal(isSensitiveWikiPath('.env.production'), true, '.env 变体算敏感')
  assert.equal(isSensitiveWikiPath('certs/server.pem'), true, '证书私钥算敏感')
  assert.equal(isSensitiveWikiPath('keys/id_rsa'), true, 'SSH 私钥算敏感')
  assert.equal(isSensitiveWikiPath('src/app.ts'), false, '普通源码不敏感')
  assert.equal(isAbsoluteWikiPath('C:\\proj\\a.ts'), true, '盘符路径算绝对')
  assert.equal(isAbsoluteWikiPath('\\\\server\\share\\a.ts'), true, 'UNC 路径算绝对')
  assert.equal(isAbsoluteWikiPath('/home/a.ts'), true, 'Unix 绝对路径算绝对')
  assert.equal(isAbsoluteWikiPath('src/a.ts'), false, '项目内相对路径放行')

  const absolute = structuredClone(facts)
  absolute.module.files[0].path = 'C:\\proj\\src\\a.ts'
  assert.throws(() => buildWikiMessages(absolute), '绝对路径要当场拦住,不发给模型')

  const retry = withWikiRetryNote(messages, ['name is required'])
  assert.ok(retry.user.includes('<program_note>'), '重试要求放程序注记里')
  assert.ok(retry.user.includes('name is required'), '注记要列出错误')
  assert.ok(retry.user.startsWith(user), '重试不重写原始事实')
  assert.equal(retry.system, messages.system, '系统提示保持原样')
}

function budgetFacts(): WikiPageFacts {
  const files = Array.from({ length: 6 }, (_, index) => ({
    path: `src/f${index}.ts`,
    language: 'typescript',
    inCount: 6 - index,
    outCount: 1,
    exports: [`export${index}`],
    functions: [`fn${index}`],
    classes: [],
    interfaces: [],
    reactComponents: []
  }))
  return {
    language: { code: 'zh-CN', name: 'Simplified Chinese' },
    kind: 'module',
    project: { name: 'demo', moduleCount: 1, groupCount: 4, knownTags: [] },
    module: {
      id: 'm:src/f0.ts',
      folders: ['src'],
      files,
      attachedFiles: [],
      dependsOn: [],
      usedBy: []
    },
    excerpts: Array.from({ length: 3 }, (_, index) => ({
      path: `src/f${index}.ts`,
      head: '中'.repeat(400)
    })),
    truncated: { files: 0, symbols: 0, excerpts: 0 }
  }
}

function checkBudget(): void {
  const facts = budgetFacts()
  const fullTokens = estimateTokens(JSON.stringify(facts))
  assert.equal(
    JSON.stringify(fitWikiFactsToBudget(facts, fullTokens)),
    JSON.stringify(facts),
    '预算够时原样返回'
  )

  const oneLess = structuredClone(facts)
  oneLess.excerpts.pop()
  oneLess.truncated.excerpts = 1
  const excerptFit = fitWikiFactsToBudget(facts, estimateTokens(JSON.stringify(oneLess)))
  if (excerptFit.kind !== 'module') return assert.fail('模块事实不该变成散件组')
  assert.equal(excerptFit.excerpts.length, 2, '先裁摘录')
  assert.equal(excerptFit.truncated.excerpts, 1, '摘录裁剪要记数')
  assert.equal(excerptFit.truncated.symbols, 0, '摘录够省时不碰符号')
  assert.equal(excerptFit.module.files.length, 6, '摘录够省时不碰文件')

  const noExcerpt = structuredClone(facts)
  noExcerpt.excerpts = []
  if (noExcerpt.kind !== 'module') return assert.fail('模块事实不该变成散件组')
  const stripped = structuredClone(noExcerpt)
  const last = stripped.module.files[stripped.module.files.length - 1]
  stripped.module.files[stripped.module.files.length - 1] = {
    path: last.path,
    language: last.language,
    inCount: last.inCount,
    outCount: last.outCount
  }
  stripped.truncated.symbols = 1
  const symbolFit = fitWikiFactsToBudget(noExcerpt, estimateTokens(JSON.stringify(stripped)))
  if (symbolFit.kind !== 'module') return assert.fail('模块事实不该变成散件组')
  assert.equal(symbolFit.truncated.excerpts, 0, '没有摘录时直接进入符号裁剪')
  assert.equal(symbolFit.truncated.symbols, 1, '符号清单按次要文件逐个裁')
  assert.equal(symbolFit.module.files.length, 6, '符号够省时不碰文件')
  assert.ok(symbolFit.module.files[0].functions?.length, '最主要的文件先保留符号')
  assert.equal(symbolFit.module.files[5].functions, undefined, '最次要的文件先丢符号')

  const lean = structuredClone(noExcerpt)
  if (lean.kind !== 'module') return assert.fail('模块事实不该变成散件组')
  lean.module.files = lean.module.files.map((file) => ({
    path: file.path,
    language: file.language,
    inCount: file.inCount,
    outCount: file.outCount
  }))
  const dropped = structuredClone(lean)
  if (dropped.kind !== 'module') return assert.fail('模块事实不该变成散件组')
  dropped.module.files.pop()
  dropped.truncated.files = 1
  const fileFit = fitWikiFactsToBudget(lean, estimateTokens(JSON.stringify(dropped)))
  if (fileFit.kind !== 'module') return assert.fail('模块事实不该变成散件组')
  assert.equal(fileFit.module.files.length, 5, '摘录和符号都省完才裁文件尾部')
  assert.equal(fileFit.truncated.files, 1, '文件裁剪要记数')
  assert.equal(fileFit.module.files[0].path, 'src/f0.ts', '入度最高的文件留在前列')
}

const ZH_TITLES = wikiSectionTitles('zh-CN')
const EN_TITLES = wikiSectionTitles('en')
const JA_TITLES = wikiSectionTitles('ja')

function zhSections(): string[] {
  return Array.from(
    { length: 8 },
    (_, index) =>
      `第${index + 1}段说明：这一页描述模块的职责、文件构成、依赖方向与阅读顺序，所有内容都来自给定事实。`
  )
}

function enSections(): string[] {
  return Array.from(
    { length: 8 },
    (_, index) =>
      `Section ${index + 1} explains the module responsibilities, file composition, dependency direction, and reading order using only the provided facts.`
  )
}

function checkOutput(): void {
  const input = {
    files: ['src/a.ts', 'src/b.ts'],
    attachedFiles: ['src/a.css'],
    knownTags: ['UI', '图谱'],
    language: 'zh-CN',
    sectionTitles: ZH_TITLES
  }
  const sections = zhSections()
  sections[0] = `# 模型自带的标题\n${sections[0]}`
  const raw = [
    '```json',
    JSON.stringify({
      name: ' 关系图谱 ',
      summary: '把文件引用关系画成图',
      tags: [' UI ', 'ui', '图谱', 'x'.repeat(13), '第三'],
      keyFiles: ['src/a.ts', 'nope.ts', 'src/a.css', 'src/b.ts', 'src/a.ts'],
      sections,
      module: 'evil'
    }),
    '```'
  ].join('\n')
  const result = parseWikiOutput(raw, input)
  assert.ok(result.ok, '包在代码围栏里的 JSON 要能解析')
  if (result.ok) {
    assert.equal(result.content.name, '关系图谱', '名称去首尾空格')
    assert.deepEqual(
      result.content.tags,
      ['UI', '图谱', '第三'],
      '标签去重、复用 knownTags 写法、超长丢弃'
    )
    assert.deepEqual(
      result.content.keyFiles,
      ['src/a.ts', 'src/a.css', 'src/b.ts'],
      '只留输入里的路径、去重、最多 5 个'
    )
    assert.ok(result.content.doc.startsWith('## 1. 引言\n\n第1段说明'), '八段标题由程序拼')
    assert.ok(!result.content.doc.includes('# 模型自带的标题'), '模型自带的一级标题要剥掉')
    assert.ok(result.content.doc.includes('## 8. 结论'), '最后一段标题也在')
    assert.ok(!('module' in result.content), '其他字段一律丢弃')
  }

  const parse = (value: unknown) => parseWikiOutput(JSON.stringify(value), input)
  const base = { summary: 's', tags: ['t'], keyFiles: [], sections: zhSections() }

  const codeSection = parseWikiOutput(
    JSON.stringify({
      ...base,
      name: 'AB',
      sections: [
        ...zhSections().slice(0, 7),
        '下面这段代码说明为什么要包含这个头文件，以及它在文件开头的作用。\n```c\n#include <stdio.h>\n```'
      ]
    }),
    input
  )
  assert.ok(codeSection.ok, '段内代码块不影响校验')
  if (codeSection.ok) {
    assert.ok(
      codeSection.content.doc.includes('#include <stdio.h>'),
      '只剥段首一级标题,不误删代码里的 #'
    )
  }

  assert.equal(parse({ ...base, name: 'A' }).ok, false, '1 个字符的名称不合规')
  assert.equal(parse({ ...base, name: 'x'.repeat(17) }).ok, false, '超过 16 个字符的名称不合规')
  assert.equal(parse({ ...base, name: 'AB' }).ok, true, '2 个字符的名称合规')
  assert.equal(parse({ ...base, name: 'x'.repeat(16) }).ok, true, '16 个字符的名称合规')
  const spaced = parse({ ...base, name: 'Graph\nView', summary: 'one\ntwo' })
  assert.ok(spaced.ok, '名称里的换行要压成空格')
  if (spaced.ok) {
    assert.equal(spaced.content.name, 'Graph View', '名称只留单空格')
    assert.equal(spaced.content.summary, 'one two', '摘要只留单空格')
  }
  assert.equal(
    parse({ ...base, name: 'AB', summary: '中'.repeat(81) }).ok,
    false,
    '摘要超过 80 字不合规'
  )
  assert.equal(parse({ ...base, name: 'AB', summary: '中'.repeat(80) }).ok, true, '摘要 80 字合规')
  assert.equal(parse({ ...base, name: 'AB', summary: ' ' }).ok, false, '摘要必填')
  assert.equal(parse({ ...base, name: 'AB', tags: [] }).ok, false, '标签至少一个')
  const five = parse({ ...base, name: 'AB', tags: ['1', '2', '3', '4', '5', '6'] })
  assert.ok(five.ok, '标签多了留前五个')
  if (five.ok) assert.deepEqual(five.content.tags, ['1', '2', '3', '4', '5'])
  assert.equal(
    parse({ ...base, name: 'AB', tags: ['x'.repeat(13)] }).ok,
    false,
    '全是超长标签视为没有标签'
  )
  assert.equal(parse({ ...base, name: 'AB', sections: [] }).ok, false, '段落数量不够不合规')
  assert.equal(
    parse({ ...base, name: 'AB', sections: zhSections().slice(1) }).ok,
    false,
    '段落少了不合规'
  )
  const shortSection = zhSections()
  shortSection[2] = '短'
  assert.equal(parse({ ...base, name: 'AB', sections: shortSection }).ok, false, '单段太短不合规')
  const emptySection = zhSections()
  emptySection[5] = '   '
  assert.equal(parse({ ...base, name: 'AB', sections: emptySection }).ok, false, '单段空白不合规')

  const english = { ...input, language: 'en', sectionTitles: EN_TITLES }
  assert.equal(
    parseWikiOutput(
      JSON.stringify({
        name: 'AB',
        summary: 's',
        tags: ['t'],
        keyFiles: [],
        sections: zhSections()
      }),
      english
    ).ok,
    false,
    '英文目标写了中文正文要拦下'
  )
  const japanese = { ...english, language: 'ja', sectionTitles: JA_TITLES }
  const enBody = JSON.stringify({
    name: 'AB',
    summary: 's',
    tags: ['t'],
    keyFiles: [],
    sections: enSections()
  })
  assert.equal(parseWikiOutput(enBody, japanese).ok, false, '日文目标写了英文正文要拦下')
  const copiedName = parseWikiOutput(
    JSON.stringify({
      name: 'Core Module',
      summary: 'Core runtime module owns all application responsibilities.',
      tags: ['t'],
      keyFiles: [],
      sections: enSections()
    }),
    { ...english, sourceName: 'Core Module' }
  )
  assert.equal(copiedName.ok, false, '非中文目标照抄程序页名要拦下')
  if (!copiedName.ok) {
    assert.ok(
      copiedName.errors.some((error) => error.includes('name must be translated')),
      '错误清单点明名称没翻译'
    )
  }
  const localized = parseWikiOutput(
    JSON.stringify({
      name: 'Core Module',
      summary: 'Core runtime module owns all application responsibilities.',
      tags: ['t'],
      keyFiles: [],
      sections: enSections()
    }),
    english
  )
  assert.ok(localized.ok, '英文目标写英文正文可过')

  assert.equal(parseWikiOutput('not json', input).ok, false, '非 JSON 要报错')
  assert.equal(parseWikiOutput('[]', input).ok, false, '数组不是对象')
  const longDoc = parse({
    ...base,
    name: 'AB',
    sections: zhSections().map(() => '中'.repeat(600))
  })
  assert.ok(longDoc.ok, '超长正文截断后仍可用')
  if (longDoc.ok) {
    assert.equal([...longDoc.content.doc].length, WIKI_DOC_MAX_CHARS, '正文截到上限')
    assert.equal(longDoc.content.docTruncated, true, '截断要标注')
  }
}

async function checkDependencyFacts(): Promise<void> {
  const source: WikiPageSource = {
    pageId: 'm:src/a.ts',
    kind: 'module',
    name: 'A',
    files: [{ path: 'src/a.ts', language: 'typescript', inCount: 0, outCount: 2 }],
    attachedFiles: [],
    folders: ['src'],
    dependsOn: [
      {
        kind: 'module',
        moduleId: 'm:src/shared/types.ts',
        name: 'shared · types.ts',
        path: 'src/shared/types.ts',
        weight: 3
      }
    ],
    usedBy: [{ kind: 'module', moduleId: 'm:src/b.ts', name: 'b.ts', weight: 1 }]
  }
  const facts = await prepareWikiPageFacts(
    source,
    {
      language: 'zh-CN',
      projectName: 'demo',
      moduleCount: 1,
      groupCount: 0,
      knownTags: [],
      contextSize: 8192,
      replyCap: 2048
    },
    { factOf: () => null, readHead: async () => 'export const a = 1' }
  )
  assert.equal(facts.kind, 'module')
  if (facts.kind !== 'module') return
  assert.equal(facts.module.dependsOn[0].name, null, '有真路径时展示名不进提示词')
  assert.equal(facts.module.dependsOn[0].path, 'src/shared/types.ts', '依赖带上真路径')
  assert.equal(facts.module.usedBy[0].name, 'b.ts', '没有路径时保留展示名')
}

async function checkRetry(): Promise<void> {
  const input = {
    files: ['src/a.ts'],
    knownTags: [],
    language: 'zh-CN',
    sectionTitles: ZH_TITLES
  }
  const valid = JSON.stringify({
    name: 'AB',
    summary: 's',
    tags: ['t'],
    keyFiles: ['src/a.ts'],
    sections: zhSections()
  })
  const messages = { system: 'sys', user: 'facts' }
  let calls = 0
  const firstTry = await requestWikiContent(messages, input, async () => {
    calls += 1
    return valid
  })
  assert.equal(firstTry.ok, true, '第一次通过就直接用')
  assert.equal(calls, 1, '第一次通过不再请求')

  calls = 0
  const seen: Array<{ system: string; user: string }> = []
  const recovered = await requestWikiContent(messages, input, async (sent) => {
    calls += 1
    seen.push(sent)
    return calls === 1 ? 'not json' : valid
  })
  assert.equal(recovered.ok, true, '重试一次后可恢复')
  assert.equal(recovered.attempts, 2, '恢复那次算第二次机会')
  assert.equal(calls, 2, '失败后只重试一次')
  assert.ok(seen[1].user.includes('<program_note>'), '重试请求带程序注记')
  assert.ok(seen[1].user.includes('the output is not a JSON object'), '注记列出错误')

  calls = 0
  const failed = await requestWikiContent(messages, input, async () => {
    calls += 1
    return 'not json'
  })
  assert.equal(failed.ok, false, '两次都不行就交失败')
  assert.equal(failed.attempts, 2, '失败也停在第二次')
  assert.equal(calls, 2, '两次失败后不再纠缠模型')
  assert.ok(failed.errors.length > 0, '失败要带错误清单')
}

function checkMarkdown(): void {
  const content = {
    name: '关系图谱',
    summary: '把文件引用关系画成图',
    tags: ['UI', '图谱'],
    keyFiles: ['src/a.ts'],
    doc: '## 职责\n画图。',
    docTruncated: false
  }
  const md = renderWikiMarkdown(content, {
    language: 'zh-CN',
    model: 'qwen',
    generatedAt: '2026-11-02T12:34:56.000Z',
    truncated: { files: 0, symbols: 0, excerpts: 0 }
  })
  assert.ok(md.startsWith('# 关系图谱\n'), '一级标题用名称')
  assert.ok(md.includes('> 把文件引用关系画成图'), '摘要用引用块')
  assert.ok(md.includes('- 标签: UI · 图谱'), '标签行用当前语种文案')
  assert.ok(md.includes('- 关键文件: `src/a.ts`'), '关键文件带代码样式')
  assert.ok(md.includes('生成时间: 2026-11-02 12:34'), '时间只留到分钟')
  assert.ok(md.includes('模型: qwen') && md.includes('语种: 中文（简体）'), '模型与语种')
  assert.ok(!md.includes('已裁剪'), '没有裁剪不写这一行')
  assert.ok(md.includes('## 职责'), '正文原样接在后面')
  assert.ok(md.endsWith('\n'), '文件末尾留换行')
  assert.ok(!md.includes('C:\\'), 'Markdown 不写盘符')

  const fullPath = renderWikiMarkdown(content, {
    language: 'zh-CN',
    model: 'F:\\models\\qwen3-27b.gguf',
    generatedAt: '2026-11-02T12:34:56.000Z',
    truncated: { files: 0, symbols: 0, excerpts: 0 }
  })
  assert.ok(fullPath.includes('模型: qwen3-27b.gguf'), '模型只留文件名')
  assert.ok(!fullPath.includes('models\\'), '模型所在目录不进文档')
  assert.equal(displayModelName('  '), '—', '空模型名给占位')
  assert.equal(displayModelName('/opt/models/x.gguf'), 'x.gguf', 'Unix 路径同样只留文件名')

  assert.equal(languageMatches(zhSections()[0], 'zh-CN'), true, '中文正文通过中文闸')
  assert.equal(
    languageMatches(
      'これは日本語の説明文です。ひらがなとカタカナが十分に含まれています。モジュールの責任を説明します。',
      'ja'
    ),
    true,
    '日文正文通过日文闸'
  )
  assert.equal(languageMatches(zhSections().join('\n'), 'ja'), false, '中文正文过不了日文闸')
  assert.equal(languageMatches(enSections().join('\n'), 'en'), true, '英文正文通过英文闸')
  assert.equal(languageMatches(enSections().join('\n'), 'zh-CN'), false, '英文正文过不了中文闸')
  assert.equal(languageMatches('short', 'ja'), true, '太短的文字不做判断')
  const mixedSummary = 'Electron 预加载层，向渲染进程暴露主进程 IPC 能力。'
  assert.equal(languageMatches(mixedSummary, 'zh-CN', 'summary'), true, '中文摘要允许夹技术词')
  assert.equal(languageMatches(mixedSummary, 'zh-CN'), false, '同样文字按正文口径不够长')
  const technicalSummary = 'Electron preload 模块，负责 IPC 通信与 UI 缩放。'
  assert.equal(
    languageMatches(technicalSummary, 'zh-CN', 'summary'),
    true,
    '中文摘要里技术词占大半也算中文'
  )
  assert.equal(
    languageMatches('Electron preload bridge exposing IPC.', 'zh-CN', 'summary'),
    false,
    '整句英文过不了中文摘要闸'
  )
  const shortEnglish = 'Electron preload bridge exposing IPC APIs to the renderer.'
  assert.equal(languageMatches(shortEnglish, 'en', 'summary'), true, '英文短摘要可过')
  assert.equal(languageMatches(shortEnglish, 'en'), false, '英文短句按正文口径不够长')
  assert.equal(
    languageMatches('Electron のプリロード層です。', 'ja', 'summary'),
    true,
    '日文短摘要按假名判断'
  )

  const trimmed = renderWikiMarkdown(
    { ...content, docTruncated: true },
    {
      language: 'en',
      model: 'm',
      generatedAt: '2026-11-02T00:00:00.000Z',
      truncated: { files: 2, symbols: 3, excerpts: 1 }
    }
  )
  assert.ok(trimmed.includes('- Truncated: files 2 · symbols 3 · excerpts 1'), '裁剪计数按语种写')
  assert.ok(trimmed.includes(wikiCopy('en').truncatedDoc), '正文截断要标注')

  const empty = renderWikiMarkdown(
    { ...content, keyFiles: [] },
    {
      language: 'zh-CN',
      model: 'm',
      generatedAt: '2026-11-02T00:00:00.000Z',
      truncated: { files: 0, symbols: 0, excerpts: 0 }
    }
  )
  assert.ok(empty.includes('- 关键文件: —'), '没有关键文件时留占位')

  assert.equal(
    wikiDocExcerpt('## 标题\n\n第一段  摘要。\n第二行'),
    '第一段 摘要。',
    '侧栏摘要跳过标题与空行,压成一行'
  )
  assert.equal(wikiDocExcerpt(''), '', '空正文给空摘要')
  const longExcerpt = wikiDocExcerpt('字'.repeat(200))
  assert.equal([...longExcerpt].length, 141, '超过上限按字截断并留省略号')
  assert.ok(longExcerpt.endsWith('…'))
}

async function checkIndex(base: string): Promise<void> {
  const projectDir = join(base, 'index', 'wiki')
  const input = {
    projectName: 'demo project',
    language: 'en',
    model: 'test-model',
    generatedAt: '2026-11-02T12:34:56.000Z',
    pages: [
      { kind: 'module' as const, name: 'Core module', file: '模块/Core module.md' },
      { kind: 'group' as const, name: 'Docs', file: '未归类/Docs.md' }
    ]
  }
  const markdown = renderWikiIndex(input)
  assert.ok(markdown.startsWith('# Repository Wiki'), '标题按语种取文案')
  assert.ok(markdown.includes('- Project: demo project'), '目录页写项目名')
  assert.ok(markdown.includes('- Language: English'), '目录页写语种')
  assert.ok(markdown.includes('- Model: test-model'), '目录页写模型')
  assert.ok(markdown.includes('- Generated: 2026-11-02 12:34'), '目录页写生成时间')
  assert.ok(
    markdown.includes('## Module\n\n- [Core module](./模块/Core%20module.md)'),
    '模块链接相对语种目录并转义空格'
  )
  assert.ok(markdown.includes('## Scattered files\n\n- [Docs](./未归类/Docs.md)'), '散件组单列一节')
  assert.ok(!markdown.includes(base), '目录页不写本机绝对路径')

  const empty = renderWikiIndex({ ...input, pages: [] })
  assert.ok(!empty.includes('## '), '没有页时不落空小节')

  await writeWikiIndex(projectDir, input)
  const written = await fs.readFile(join(languageDir(projectDir, 'en'), WIKI_README), 'utf8')
  assert.equal(written, markdown, '目录页按语种目录落盘')
  assert.equal(wikiIndexLink('模块/a#b.md'), './模块/a%23b.md', '链接里的 # 要转义')
}

function checkCopy(): void {
  assert.equal(Object.keys(WIKI_COPY).length, TRANSLATE_LANGS.length, '8 个语种一份不少')
  for (const lang of TRANSLATE_LANGS) {
    const copy = WIKI_COPY[lang.code]
    assert.ok(copy, `${lang.code} 要有文案`)
    if (!copy) continue
    for (const [key, value] of Object.entries(copy)) {
      if (key === 'sectionTitles') continue
      assert.equal(typeof value, 'string', `${lang.code}.${key} 是字符串`)
      assert.ok(value.trim().length > 0, `${lang.code}.${key} 不能空`)
    }
    const titles = wikiSectionTitles(lang.code)
    assert.equal(titles.length, 8, `${lang.code} 固定八段`)
    assert.equal(new Set(titles).size, 8, `${lang.code} 段标题不重复`)
    for (const title of titles) {
      assert.ok(title.trim().length > 0, `${lang.code} 段标题不能空`)
    }
  }
  assert.equal(wikiCopy('xx'), WIKI_COPY[DEFAULT_WIKI_LANGUAGE], '不认识的语种回默认')
}

async function main(): Promise<void> {
  const base = join(tmpdir(), `codeatlas-wiki-${Date.now()}`)
  await fs.mkdir(base, { recursive: true })
  try {
    checkSettings(base)
    await checkLocation(base)
    await checkStore(base)
    checkPanel()
    checkHash()
    checkGroups()
    checkPrompt()
    checkBudget()
    checkOutput()
    await checkDependencyFacts()
    await checkRetry()
    checkMarkdown()
    await checkIndex(base)
    checkCopy()
    console.log('✅ Wiki 自测全部通过')
    console.log(
      '   设置默认值与回退 · 配置读写往返 · 仓库内拒绝 · 非空无标记改用子目录 · 大小写不敏感'
    )
    console.log(
      '   文件名清洗与重名 · 项目目录防冲突 · MD 原子写 · 记账读写与损坏识别 · 改名删旧 · 缓存键含语种'
    )
    console.log(
      '   提示词只带当前页 · 语种注入 · 依赖按真路径引用 · 本机路径与敏感摘录清洗 · 输出逐字段校验 · 只重试一次 · 8 语种文案 · 预算裁剪顺序'
    )
    console.log('   README 目录页按语种落盘 · 相对链接与转义 · 空目录不落空壳')
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ Wiki 存储自测失败:', err)
  process.exit(1)
})
