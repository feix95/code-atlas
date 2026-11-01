// 图谱搜索自测:虚词与全角规范化、标签 / 名称 / 简介 / 路径的优先级、
// 未生成 Wiki 时回退程序名、命中集合与文件夹角标计数。
import assert from 'node:assert/strict'
import {
  SEARCH_FILLER_WORDS,
  SEARCH_RESULTS_MAX,
  countSearchFilesUnder,
  focusOfHits,
  normalizeSearchText,
  pickLocateFile,
  searchWikiPages
} from '../src/renderer/src/graph/wikiSearch.ts'
import type { WikiPageSource, WikiPanelPage } from '../src/shared/wikiTypes.ts'

function source(
  pageId: string,
  kind: 'module' | 'group',
  name: string,
  files: string[],
  attached: string[] = []
): WikiPageSource {
  return {
    pageId,
    kind,
    name,
    files: files.map((path) => ({ path })),
    attachedFiles: attached,
    folders: [],
    dependsOn: [],
    usedBy: []
  }
}

function panel(
  pageId: string,
  kind: 'module' | 'group',
  name: string,
  summary: string,
  tags: string[],
  status: WikiPanelPage['status'] = 'done'
): WikiPanelPage {
  return {
    pageId,
    kind,
    status,
    name,
    summary,
    tags,
    keyFiles: [],
    excerpt: '',
    file: `${pageId}.md`,
    generatedAt: '',
    model: ''
  }
}

function checkNormalize(): void {
  assert.deepEqual([...SEARCH_FILLER_WORDS], ['相关', '有关', '部分', '模块', '的'])
  assert.equal(normalizeSearchText('  ＵＩ　相关 '), 'ui', '全角转半角、去虚词、转小写')
  assert.equal(normalizeSearchText('UI相关'), 'ui', '夹在词里的虚词也去掉')
  assert.equal(normalizeSearchText('相关的部分模块'), '', '全是虚词 = 没搜')
  assert.equal(normalizeSearchText('   '), '', '空白等于没搜')
  assert.equal(normalizeSearchText('React'), 'react')
}

function checkPriority(): void {
  const entries = [
    {
      source: source('m:tag', 'module', '前端界面', ['src/tag.ts']),
      page: panel('m:tag', 'module', '前端界面', '组件说明', ['UI'])
    },
    {
      source: source('m:name', 'module', 'UI 工具', ['src/name.ts']),
      page: panel('m:name', 'module', 'UI 工具', '', [])
    },
    {
      source: source('m:summary', 'module', '其他', ['src/summary.ts']),
      page: panel('m:summary', 'module', '其他', 'UI 配色说明', [])
    },
    { source: source('g:path', 'group', '根目录散件', ['src/ui/path.ts']), page: null }
  ]
  const hits = searchWikiPages('ui', entries)
  assert.deepEqual(
    hits.map((hit) => hit.match),
    ['tag', 'name', 'summary', 'path'],
    '标签 → 名称 → 简介 → 路径'
  )
  assert.deepEqual(
    hits.map((hit) => hit.pageId),
    ['m:tag', 'm:name', 'm:summary', 'g:path']
  )
  assert.equal(hits[0].matched, 'UI', '标签命中原样返回')
  assert.equal(searchWikiPages(normalizeSearchText('UI 相关'), entries).length, 4, '虚词不影响结果')
  assert.deepEqual(searchWikiPages(normalizeSearchText('模块'), entries), [], '虚词清空后不搜索')

  const ranked = searchWikiPages('x', [
    { source: source('m:small', 'module', 'x1', ['a.ts']), page: null },
    { source: source('m:big', 'module', 'x2', ['a.ts', 'b.ts']), page: null }
  ])
  assert.deepEqual(
    ranked.map((hit) => hit.pageId),
    ['m:big', 'm:small'],
    '同档按文件数降序'
  )
  assert.equal(SEARCH_RESULTS_MAX, 12)
}

function checkNoWikiFallback(): void {
  const none = panel('m:prog', 'module', '不该被搜到', '不该被搜到', ['旧标签'], 'none')
  const entry = {
    source: source('m:prog', 'module', '计划名', ['src/prog.ts']),
    page: none
  }
  const byProgram = searchWikiPages(normalizeSearchText('计划'), [entry])
  assert.equal(byProgram.length, 1, '没有 Wiki 时按程序名匹配')
  assert.equal(byProgram[0].match, 'name')
  assert.deepEqual(
    searchWikiPages(normalizeSearchText('不该'), [entry]),
    [],
    '没有 Wiki 时不搜 AI 字段'
  )
  assert.deepEqual(searchWikiPages('', [entry]), [], '空查询不搜索')
}

function checkFocus(): void {
  const hits = searchWikiPages('ui', [
    {
      source: source('m:a', 'module', 'A', ['src/a.ts', 'src/b.ts'], ['src/attached.ts']),
      page: panel('m:a', 'module', 'A', '', ['UI'])
    },
    { source: source('g:b', 'group', 'B', ['lib/b.ts']), page: null }
  ])
  const focus = focusOfHits(hits)
  assert.equal(focus.files.size, 3, '成员与附挂都算命中')
  assert.ok(focus.files.has('src/attached.ts'))
  assert.ok(focus.modules.has('m:a'))
  assert.ok(!focus.modules.has('g:b'), '散件组不产生模块高亮')
  assert.equal(
    focusOfHits(searchWikiPages('ui', [{ source: source('g:c', 'group', 'C', []), page: null }]))
      .files.size,
    0
  )
}

function checkFolderCounts(): void {
  const files = new Set(['src/a.ts', 'src/b.ts', 'srcx/c.ts', 'lib/d.ts', 'root.ts'])
  assert.equal(countSearchFilesUnder(files, ''), 5, '根目录算全部')
  assert.equal(countSearchFilesUnder(files, 'src'), 2, '只算真正的子路径')
  assert.equal(countSearchFilesUnder(files, 'srcx'), 1)
  assert.equal(countSearchFilesUnder(files, 'none'), 0)
}

function checkLocate(): void {
  assert.equal(pickLocateFile([]), null)
  assert.equal(pickLocateFile(['a/b/c.ts', 'd.ts', 'a/e.ts']), 'd.ts', '优先最浅的一层')
  assert.equal(pickLocateFile(['b/x.ts', 'a/x.ts']), 'a/x.ts', '同层按路径定序')
}

checkNormalize()
checkPriority()
checkNoWikiFallback()
checkFocus()
checkFolderCounts()
checkLocate()
console.log('✅ 图谱搜索自测全部通过')
