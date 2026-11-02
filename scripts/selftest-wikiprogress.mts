// Wiki 进度页纯数据层自测:待生成页清单的顺序与事实、记账快照与实时事件的合并、重试清单。
import assert from 'node:assert/strict'
import type { DepGraphResult, ScanDirNode, ScanResult } from '../src/shared/types.ts'
import type {
  WikiLanguageSummary,
  WikiPageProgress,
  WikiPageSource
} from '../src/shared/wikiTypes.ts'
import {
  assembleWikiPages,
  countWikiRows,
  eventsForLanguage,
  mergeWikiRows,
  pickWikiPage,
  planWikiRows,
  regeneratePageIds,
  retryPageIds,
  wikiEventKey,
  type WikiProgressRow
} from '../src/renderer/src/wikiProgressModel.ts'

function file(name: string, relPath: string, ext: string): ScanDirNode['children'][number] {
  return { type: 'file', name, relPath, ext }
}

function scanResult(): ScanResult {
  const tree: ScanDirNode = {
    type: 'directory',
    name: 'demo',
    relPath: '',
    children: [
      file('a.ts', 'src/a.ts', '.ts'),
      file('b.ts', 'src/b.ts', '.ts'),
      file('logo.png', 'src/logo.png', '.png'),
      file('README.md', 'README.md', '.md'),
      file('package.json', 'package.json', '.json')
    ]
  }
  return {
    rootPath: 'E:\\demo',
    rootName: 'demo',
    tree,
    stats: {
      fileCount: 5,
      dirCount: 1,
      byExt: {},
      byLanguage: {},
      ignoredCount: 0,
      skippedCount: 0,
      lazyCount: 0
    },
    durationMs: 1
  }
}

function depGraph(): DepGraphResult {
  return {
    rootPath: 'E:\\demo',
    nodes: [
      { relPath: 'src/a.ts', languageId: 'typescript', inCount: 4, outCount: 1 },
      { relPath: 'src/b.ts', languageId: 'typescript', inCount: 1, outCount: 2 }
    ],
    edges: [],
    hubs: [],
    stats: { analyzed: 2, externalCount: 0, skipped: 0, unresolved: [] },
    modules: {
      algorithmVersion: 1,
      params: {
        resolution: 1,
        seed: 1,
        folderAffinity: 1,
        minFiles: 2,
        hubMinInDegree: 5,
        hubShare: 0.2
      },
      modules: [
        {
          id: 'm:src/a.ts',
          anchor: 'src/a.ts',
          folder: 'src',
          files: ['src/a.ts'],
          attached: [],
          tests: [],
          folders: ['src']
        },
        {
          id: 'm:src/b.ts',
          anchor: 'src/b.ts',
          folder: 'src',
          files: ['src/b.ts'],
          attached: [],
          tests: [],
          folders: ['src']
        }
      ],
      fileToModule: { 'src/a.ts': 'm:src/a.ts', 'src/b.ts': 'm:src/b.ts' },
      links: [{ from: 'm:src/b.ts', to: 'm:src/a.ts', weight: 3 }]
    },
    durationMs: 1
  }
}

function findPage(pages: WikiPageSource[], id: string): WikiPageSource {
  const page = pages.find((item) => item.pageId === id)
  assert.ok(page, `应当有 ${id} 这一页`)
  return page
}

function checkAssembly(): WikiPageSource[] {
  assert.deepEqual(assembleWikiPages(scanResult(), null), [], '图谱没算出来时不给页')
  assert.deepEqual(assembleWikiPages(null, depGraph()), [])
  const pages = assembleWikiPages(scanResult(), depGraph())
  assert.deepEqual(
    pages.map((page) => page.pageId),
    ['m:src/a.ts', 'm:src/b.ts', 'g:root-config', 'g:docs-assets'],
    '模块在前、散件组在后,组按固定顺序'
  )
  const first = findPage(pages, 'm:src/a.ts')
  assert.equal(first.name, 'src · a.ts', '模块名沿用图谱显示名')
  assert.deepEqual(first.files[0], {
    path: 'src/a.ts',
    language: 'typescript',
    inCount: 4,
    outCount: 1
  })
  assert.deepEqual(first.usedBy, [
    { kind: 'module', moduleId: 'm:src/b.ts', name: 'src · b.ts', weight: 3 }
  ])
  assert.deepEqual(first.dependsOn, [])
  const docs = findPage(pages, 'g:docs-assets')
  assert.deepEqual(
    docs.files.map((item) => item.path),
    ['README.md', 'src/logo.png']
  )
  assert.deepEqual(findPage(pages, 'g:root-config').files, [{ path: 'package.json' }])
  return pages
}

function checkMerge(pages: WikiPageSource[]): void {
  const language: WikiLanguageSummary = {
    code: 'zh-CN',
    label: '中文（简体）',
    pages: [
      {
        pageId: 'm:src/a.ts',
        kind: 'module',
        name: '甲模块',
        status: 'done',
        file: '模块/甲模块.md',
        generatedAt: '2026-11-02T10:00:00.000Z',
        model: 'qwen',
        truncated: false,
        exists: true
      },
      {
        pageId: 'm:src/b.ts',
        kind: 'module',
        name: '乙模块',
        status: 'stale',
        file: '模块/乙模块.md',
        generatedAt: '2026-11-01T10:00:00.000Z',
        model: 'qwen',
        truncated: true,
        exists: true
      },
      {
        pageId: 'g:old',
        kind: 'group',
        name: '旧散件组',
        status: 'failed',
        file: '未归类/旧散件组.md',
        generatedAt: '2026-11-01T09:00:00.000Z',
        model: 'qwen',
        truncated: false,
        exists: false
      }
    ]
  }
  const events: Record<string, WikiPageProgress> = {
    'm:src/a.ts': {
      pageId: 'm:src/a.ts',
      kind: 'module',
      name: '甲模块',
      status: 'skipped',
      file: '模块/甲模块.md'
    },
    'm:src/b.ts': {
      pageId: 'm:src/b.ts',
      kind: 'module',
      name: '乙模块',
      status: 'running'
    }
  }
  const rows = mergeWikiRows(pages, language, events)
  assert.deepEqual(
    rows.map((row) => [row.pageId, row.status]),
    [
      ['m:src/b.ts', 'running'],
      ['g:old', 'failed'],
      ['g:root-config', 'pending'],
      ['g:docs-assets', 'pending'],
      ['m:src/a.ts', 'done']
    ],
    '异常与进行中的页排在前面,已完成沉底;图谱外的旧页保留'
  )
  const cached = rows.find((row) => row.pageId === 'm:src/a.ts') as WikiProgressRow
  assert.equal(cached.cached, true, '跳过请求的页标记为缓存命中')
  assert.equal(cached.name, '甲模块', '记账里的 AI 名称优先')
  assert.equal(rows[2].name, '项目根配置', '没生成过的页用程序名')
  const counts = countWikiRows(rows)
  assert.deepEqual(
    [counts.total, counts.done, counts.cached, counts.failed, counts.pending, counts.running],
    [5, 1, 1, 1, 2, 1]
  )
  assert.deepEqual(retryPageIds(rows), ['g:old'], '失败页进重试清单')
  assert.deepEqual(regeneratePageIds(rows), [], '正在重跑的不再重复进过期清单')
  assert.deepEqual(
    planWikiRows(rows),
    { total: 5, cached: 1, toGenerate: 4 },
    '确认弹窗里已完成的算缓存,其余都要请求'
  )

  const noEvents = mergeWikiRows(pages, language, {})
  const stale = noEvents.find((row) => row.pageId === 'm:src/b.ts') as WikiProgressRow
  assert.equal(stale.status, 'stale')
  assert.deepEqual(regeneratePageIds(noEvents), ['m:src/b.ts'], '过期页进重新生成清单')
  assert.deepEqual(
    pickWikiPage(pages, ['m:src/a.ts', 'g:docs-assets']).map((page) => page.pageId),
    ['m:src/a.ts', 'g:docs-assets']
  )
}

function checkEventFilter(): void {
  const events: Record<string, WikiPageProgress> = {
    [wikiEventKey('zh-CN', 'm:1')]: {
      pageId: 'm:1',
      kind: 'module',
      name: '中文',
      status: 'done'
    },
    [wikiEventKey('en', 'm:1')]: {
      pageId: 'm:1',
      kind: 'module',
      name: 'English',
      status: 'running'
    }
  }
  const chinese = eventsForLanguage(events, 'zh-CN')
  assert.deepEqual(Object.keys(chinese), ['m:1'], '按语种取事件时键还原成页 id')
  assert.equal(chinese['m:1'].name, '中文')
  assert.equal(eventsForLanguage(events, 'ja')['m:1'], undefined, '别的语种的进度不串过来')
}

function main(): void {
  const pages = checkAssembly()
  checkMerge(pages)
  checkEventFilter()
  console.log('✅ Wiki 进度页数据层自测全部通过')
  console.log(
    '   模块在前散件组在后 · 事实带语言与计数 · 记账与实时事件合并 · 重试/过期清单 · 语种进度隔离'
  )
}

main()
