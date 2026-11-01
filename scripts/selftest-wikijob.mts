// Wiki 任务自测:逐页请求与进度、缓存命中不发请求、只重请求变化页、取消后不再请求、
// 重启续跑、项目切换后迟到结果不落盘、失败记录与重试、超大页裁剪标记、敏感文件不摘录。
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  runWikiJob,
  wikiOutputTokens,
  type WikiJobDeps,
  type WikiJobOptions
} from '../src/wiki/wikiJob.ts'
import { readWikiState, WIKI_README } from '../src/wiki/wikiStore.ts'
import type { FileFact } from '../src/depgraph/factCache.ts'
import type { WikiJobEvent, WikiPageSource } from '../src/shared/wikiTypes.ts'
import type { WikiPromptMessages } from '../src/ai/wikiPrompt.ts'

const NOW = '2026-11-02T12:00:00.000Z'
const LANGUAGE_DIR = '中文（简体）'

function fact(hashSeed: string): FileFact {
  return {
    sha256: hashSeed.padEnd(64, '0').slice(0, 64),
    structure: {
      languageId: 'typescript',
      imports: [],
      exports: ['run'],
      functions: ['run'],
      classes: [],
      interfaces: [],
      reactComponents: []
    }
  }
}

function page(id: string, paths: string[], kind: 'module' | 'group' = 'module'): WikiPageSource {
  return {
    pageId: id,
    kind,
    name: `${kind === 'module' ? '模块' : '散件组'} ${id}`,
    files: paths.map((path, index) => ({
      path,
      language: 'typescript',
      inCount: index === 0 ? 3 : 1,
      outCount: 1
    })),
    attachedFiles: [],
    folders: ['src'],
    dependsOn: [],
    usedBy: []
  }
}

function outputFrom(messages: WikiPromptMessages, name: string): string {
  const facts = JSON.parse(
    messages.user.slice(messages.user.indexOf('{'), messages.user.lastIndexOf('}') + 1)
  ) as {
    kind: 'module' | 'group'
    module?: { files: Array<{ path: string }> }
    group?: { files: Array<{ path: string }> }
  }
  const first = facts.kind === 'module' ? facts.module?.files[0]?.path : facts.group?.files[0]?.path
  return JSON.stringify({
    name,
    summary: 'summary',
    tags: ['t'],
    keyFiles: first ? [first] : [],
    doc: '## Body'
  })
}

interface Harness {
  deps: WikiJobDeps
  requests: WikiPromptMessages[]
  reads: string[]
  facts: Map<string, FileFact>
}

function harness(): Harness {
  const facts = new Map<string, FileFact>()
  const requests: WikiPromptMessages[] = []
  const reads: string[] = []
  const deps: WikiJobDeps = {
    factOf: (path) => facts.get(path) ?? null,
    readHead: async (path) => {
      reads.push(path)
      return `// ${path}\nconst x = 1`
    },
    request: async (messages) => {
      requests.push(messages)
      return outputFrom(messages, `P${requests.length}`)
    },
    now: () => NOW
  }
  return { deps, requests, reads, facts }
}

function options(
  root: string,
  projectDir: string,
  pages: WikiPageSource[],
  overrides: Partial<WikiJobOptions> = {}
): WikiJobOptions {
  return {
    projectRoot: root,
    projectName: 'demo',
    projectDir,
    language: 'zh-CN',
    model: 'test-model',
    contextSize: 16384,
    replyCap: 2048,
    knownTags: ['UI'],
    pages,
    ...overrides
  }
}

async function records(projectDir: string): Promise<Record<string, string>> {
  const read = await readWikiState(projectDir)
  assert.equal(read.status, 'ok', '记账应当写好')
  if (read.status !== 'ok') return {}
  const pages = read.state.languages['zh-CN'].pages
  return Object.fromEntries(Object.entries(pages).map(([id, record]) => [id, record.file]))
}

async function checkRunAndCache(base: string): Promise<void> {
  const root = join(base, 'cache', 'project')
  const projectDir = join(base, 'cache', 'wiki')
  const pages = [page('m:src/a.ts', ['src/a.ts']), page('g:root', ['README.md'], 'group')]
  const h = harness()
  h.facts.set('src/a.ts', fact('a'))
  h.facts.set('README.md', fact('r'))
  const events: WikiJobEvent[] = []
  h.deps.emit = (event) => events.push(event)

  const first = await runWikiJob(options(root, projectDir, pages), h.deps)
  assert.equal(first.status, 'done', '两个页面都成功')
  assert.equal(first.done, 2)
  assert.equal(h.requests.length, 2)
  assert.ok(
    events.some((event) => event.page.status === 'done' && event.processed === 2),
    '进度按页推进到 2'
  )
  const files = await records(projectDir)
  assert.equal(Object.keys(files).length, 2, '两页都记账')
  for (const file of Object.values(files)) {
    await fs.access(join(projectDir, LANGUAGE_DIR, file))
  }
  assert.ok(
    (await fs.readFile(join(projectDir, LANGUAGE_DIR, files['m:src/a.ts']), 'utf8')).includes(
      '# P1'
    ),
    'Markdown 用 AI 名称'
  )
  const index = await fs.readFile(join(projectDir, LANGUAGE_DIR, WIKI_README), 'utf8')
  assert.ok(index.includes('# 仓库 Wiki'), '目录页按语种生成')
  assert.ok(
    index.includes('(./模块/P1.md)') && index.includes('(./未归类/P2.md)'),
    '目录页链接到每篇已完成文档'
  )

  const second = await runWikiJob(options(root, projectDir, pages), h.deps)
  assert.equal(second.status, 'done')
  assert.equal(second.skipped, 2, '缓存命中直接跳过')
  assert.equal(second.done, 0)
  assert.equal(h.requests.length, 2, '缓存命中不发请求')
  assert.ok(
    events.some((event) => event.page.status === 'skipped'),
    '跳过也要推进度'
  )

  const forced = await runWikiJob(options(root, projectDir, pages, { force: true }), h.deps)
  assert.equal(forced.done, 2, '强制重写不看缓存')
  assert.equal(forced.skipped, 0)
  assert.equal(h.requests.length, 4, '强制重写重新请求每一页')
}

async function checkChangedPage(base: string): Promise<void> {
  const root = join(base, 'changed', 'project')
  const projectDir = join(base, 'changed', 'wiki')
  const pages = [page('m:src/a.ts', ['src/a.ts']), page('m:src/b.ts', ['src/b.ts'])]
  const h = harness()
  h.facts.set('src/a.ts', fact('a'))
  h.facts.set('src/b.ts', fact('b'))
  await runWikiJob(options(root, projectDir, pages), h.deps)
  assert.equal(h.requests.length, 2)

  h.facts.set('src/a.ts', fact('a2'))
  const second = await runWikiJob(options(root, projectDir, pages), h.deps)
  assert.equal(second.done, 1, '只重生成变化页')
  assert.equal(second.skipped, 1, '没变的页跳过')
  assert.equal(h.requests.length, 3, '只多发一次请求')
}

async function checkCancel(base: string): Promise<void> {
  const root = join(base, 'cancel', 'project')
  const projectDir = join(base, 'cancel', 'wiki')
  const controller = new AbortController()
  const h = harness()
  h.facts.set('src/a.ts', fact('a'))
  h.facts.set('src/b.ts', fact('b'))
  h.deps.emit = (event) => {
    if (event.page.status === 'done') controller.abort()
  }
  const result = await runWikiJob(
    options(
      root,
      projectDir,
      [page('m:src/a.ts', ['src/a.ts']), page('m:src/b.ts', ['src/b.ts'])],
      {
        signal: controller.signal
      }
    ),
    h.deps
  )
  assert.equal(result.status, 'cancelled', '取消后任务收场')
  assert.equal(result.done, 1)
  assert.equal(result.cancelled, 1)
  assert.equal(h.requests.length, 1, '取消后不再请求下一页')
  const files = await records(projectDir)
  assert.equal(Object.keys(files).length, 1, '只完成一页')
  await assert.rejects(
    fs.access(join(projectDir, LANGUAGE_DIR, WIKI_README)),
    '取消的半轮不写目录页'
  )
}

async function checkProjectSwitch(base: string): Promise<void> {
  const root = join(base, 'switch', 'project')
  const projectDir = join(base, 'switch', 'wiki')
  const h = harness()
  h.facts.set('src/a.ts', fact('a'))
  let active = true
  const original = h.deps.request
  h.deps.isActive = () => active
  h.deps.request = async (messages, signal) => {
    const text = await original(messages, signal)
    active = false
    return text
  }
  const result = await runWikiJob(
    options(root, projectDir, [page('m:src/a.ts', ['src/a.ts'])]),
    h.deps
  )
  assert.equal(result.status, 'cancelled', '项目切走后任务作废')
  assert.equal(result.done, 0)
  assert.equal(h.requests.length, 1, '迟到请求已经发出,但结果不落盘')
  assert.equal((await readWikiState(projectDir)).status, 'missing', '没有写记账')
  const rootDir = join(projectDir, LANGUAGE_DIR, '模块')
  const entries = await fs.readdir(rootDir).catch(() => [])
  assert.deepEqual(entries, [], '没有写 Markdown')
}

async function checkFailureAndRetry(base: string): Promise<void> {
  const root = join(base, 'fail', 'project')
  const projectDir = join(base, 'fail', 'wiki')
  const h = harness()
  h.facts.set('src/a.ts', fact('a'))
  h.deps.request = async (messages) => {
    h.requests.push(messages)
    return 'not json'
  }
  const first = await runWikiJob(
    options(root, projectDir, [page('m:src/a.ts', ['src/a.ts'])]),
    h.deps
  )
  assert.equal(first.status, 'done', '单页失败不拖垮整轮')
  assert.equal(first.failed, 1)
  assert.equal(h.requests.length, 2, '解析失败只重试一次')
  const read = await readWikiState(projectDir)
  assert.equal(read.status, 'ok')
  if (read.status === 'ok') {
    const record = read.state.languages['zh-CN'].pages['m:src/a.ts']
    assert.equal(record.status, 'failed', '失败页要记账')
    await assert.rejects(
      fs.access(join(projectDir, LANGUAGE_DIR, record.file)),
      '失败页不写 Markdown'
    )
  }

  const second = await runWikiJob(
    options(root, projectDir, [page('m:src/a.ts', ['src/a.ts'])]),
    h.deps
  )
  assert.equal(second.failed, 1)
  assert.equal(h.requests.length, 4, '失败页下次重跑再给两次机会')
}

async function checkTrim(base: string): Promise<void> {
  const root = join(base, 'trim', 'project')
  const projectDir = join(base, 'trim', 'wiki')
  const paths = Array.from({ length: 30 }, (_, index) => `src/f${index}.ts`)
  const h = harness()
  for (const path of paths) h.facts.set(path, fact(path))
  h.deps.readHead = async () => `// ${'中'.repeat(3000)}`
  let captured: { truncated: { files: number; symbols: number; excerpts: number } } | null = null
  h.deps.request = async (messages) => {
    h.requests.push(messages)
    captured = JSON.parse(
      messages.user.slice(messages.user.indexOf('{'), messages.user.lastIndexOf('}') + 1)
    ) as typeof captured
    return outputFrom(messages, 'Big')
  }
  const result = await runWikiJob(
    options(root, projectDir, [page('m:big', paths)], { contextSize: 8192, replyCap: 2048 }),
    h.deps
  )
  assert.equal(result.done, 1)
  assert.ok(captured, '请求已发出')
  const truncated = captured?.truncated
  assert.ok(
    truncated !== undefined && truncated.files + truncated.symbols + truncated.excerpts > 0,
    '超大页必须留下裁剪计数'
  )
  const read = await readWikiState(projectDir)
  assert.equal(read.status, 'ok')
  if (read.status === 'ok') {
    const record = read.state.languages['zh-CN'].pages['m:big']
    assert.equal(record.truncated, true, '记账标记裁剪')
    const markdown = await fs.readFile(join(projectDir, LANGUAGE_DIR, record.file), 'utf8')
    assert.ok(markdown.includes('已裁剪'), 'Markdown 写明裁剪')
  }
}

async function checkSensitive(base: string): Promise<void> {
  const root = join(base, 'sensitive', 'project')
  const projectDir = join(base, 'sensitive', 'wiki')
  const h = harness()
  h.facts.set('.env.local', fact('e'))
  h.facts.set('src/a.ts', fact('a'))
  const result = await runWikiJob(
    options(root, projectDir, [page('m:src/a.ts', ['.env.local', 'src/a.ts'])]),
    h.deps
  )
  assert.equal(result.done, 1)
  assert.ok(!h.reads.includes('.env.local'), '敏感文件不读摘录')
  assert.ok(h.reads.includes('src/a.ts'), '普通文件照常读')
  const files = JSON.parse(
    h.requests[0].user.slice(
      h.requests[0].user.indexOf('{'),
      h.requests[0].user.lastIndexOf('}') + 1
    )
  ) as { module: { files: Array<{ path: string }> } }
  assert.ok(
    files.module.files.some((file) => file.path === '.env.local'),
    '敏感文件仍然只列名字'
  )
}

function checkOutputTokens(): void {
  assert.equal(wikiOutputTokens(4096), 1024)
  assert.equal(wikiOutputTokens(8192), 1024)
  assert.equal(wikiOutputTokens(10240), 2048)
  assert.equal(wikiOutputTokens(16384), 2048)
}

async function main(): Promise<void> {
  const base = join(tmpdir(), `codeatlas-wikijob-${Date.now()}`)
  await fs.mkdir(base, { recursive: true })
  try {
    await checkRunAndCache(base)
    await checkChangedPage(base)
    await checkCancel(base)
    await checkProjectSwitch(base)
    await checkFailureAndRetry(base)
    await checkTrim(base)
    await checkSensitive(base)
    checkOutputTokens()
    console.log('✅ Wiki 任务自测全部通过')
    console.log('   逐页请求与进度 · 缓存命中不发请求 · 只重请求变化页 · 取消后不再请求 · 重启续跑')
    console.log(
      '   项目切换不落盘 · 失败记账与重试 · 超大页裁剪标记 · 敏感文件只列名 · 输出上限分档'
    )
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ Wiki 任务自测失败:', err)
  process.exit(1)
})
