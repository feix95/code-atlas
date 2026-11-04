// 自测:文件到卡的归属反查、文件夹覆盖聚合、扫描树后代文件收集、卡片墙搜索。
import assert from 'node:assert/strict'
import {
  cardOwnerOf,
  cardsForFiles,
  descendantFilesOf
} from '../src/renderer/src/graph/wikiCardOwner.ts'
import { normalizeSearchText, searchWikiCards } from '../src/renderer/src/graph/wikiSearch.ts'
import { folderTree } from '../src/shared/hierarchy.ts'
import type { ScanDirNode, ScanFileNode } from '../src/shared/types.ts'
import type { WikiWallCard } from '../src/shared/wikiTypes.ts'

function card(partial: Partial<WikiWallCard> & { pageId: string }): WikiWallCard {
  return {
    kind: 'leaf',
    title: partial.pageId,
    memberCount: 0,
    members: [],
    keyFiles: [],
    status: 'planned',
    summary: '',
    excerpt: '',
    file: '',
    topicPath: [],
    referenceWeight: 0,
    ...partial
  }
}

const leaf = card({
  pageId: 'leaf-1',
  title: '关系分析',
  members: ['src/a.ts', 'src/b.ts'],
  memberCount: 2
})
const leaf2 = card({
  pageId: 'leaf-2',
  title: '墙面布局',
  members: ['src/c.ts'],
  memberCount: 1
})
const overview = card({
  pageId: 'ov-1',
  kind: 'overview',
  title: '图谱总览',
  members: ['src/a.ts', 'src/c.ts'],
  memberCount: 2
})
const cards = [overview, leaf, leaf2]

// 叶子成员优先于父卡收录
assert.equal(cardOwnerOf(cards, 'src/a.ts')?.card.pageId, 'leaf-1')
assert.equal(cardOwnerOf(cards, 'src/a.ts')?.via, 'member')
// 只被总览收录的文件如实标 included
const onlyOverview = cardOwnerOf([overview], 'src/c.ts')
assert.equal(onlyOverview?.card.pageId, 'ov-1')
assert.equal(onlyOverview?.via, 'included')
// 没人认领
assert.equal(cardOwnerOf(cards, 'src/zzz.ts'), null)

// 文件夹聚合:按覆盖数降序
const coverage = cardsForFiles(cards, ['src/a.ts', 'src/b.ts', 'src/c.ts'])
assert.deepEqual(
  coverage.map((item) => [item.card.pageId, item.count]),
  [
    ['leaf-1', 2],
    ['ov-1', 2],
    ['leaf-2', 1]
  ]
)
assert.deepEqual(cardsForFiles(cards, ['nope.ts']), [])

// 扫描树后代文件
const file = (relPath: string): ScanFileNode => ({
  type: 'file',
  name: relPath.split('/').pop() ?? relPath,
  relPath,
  ext: '.ts'
})
const tree: ScanDirNode = {
  type: 'directory',
  name: 'demo',
  relPath: '',
  children: [
    {
      type: 'directory',
      name: 'src',
      relPath: 'src',
      children: [
        file('src/a.ts'),
        {
          type: 'directory',
          name: 'deep',
          relPath: 'src/deep',
          children: [file('src/deep/d.ts')]
        }
      ]
    },
    file('top.ts')
  ]
}
const group = folderTree(tree)
assert.deepEqual(descendantFilesOf(group, 'src').sort(), ['src/a.ts', 'src/deep/d.ts'])
assert.deepEqual(descendantFilesOf(group, 'missing'), [])

// 卡搜索:名称 > 简介 > 成员路径,命中标 card
const named = card({
  pageId: 's-1',
  title: '引用关系',
  summary: '画连线',
  members: ['src/x.ts']
})
const bySummary = card({
  pageId: 's-2',
  title: '布局',
  summary: '处理引用关系排版',
  members: ['src/y.ts']
})
const byPath = card({ pageId: 's-3', title: '别的', members: ['src/引用关系.ts'] })
const hits = searchWikiCards(normalizeSearchText('引用关系'), [byPath, bySummary, named])
assert.deepEqual(
  hits.map((hit) => hit.pageId),
  ['s-1', 's-2', 's-3']
)
assert.equal(hits[0]?.card, true)
assert.equal(hits[0]?.match, 'name')
assert.equal(hits[2]?.match, 'path')
assert.deepEqual(searchWikiCards('', [named]), [])
assert.deepEqual(searchWikiCards('不存在的词', [named]), [])

console.log('wikicardowner selftest ok')
