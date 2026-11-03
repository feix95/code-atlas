// 自测:卡片墙装配。从属线、引用聚合权重、记账名称与状态合并、主题链。
import assert from 'node:assert/strict'
import { buildWikiWall } from '../src/wiki/wikiWall.ts'
import type { WikiPlan } from '../src/wiki/wikiPlanTypes.ts'
import type { WikiLanguageStateV2 } from '../src/wiki/wikiStoreV2.ts'

const plan: WikiPlan = {
  version: 1,
  projectName: 'demo',
  rootPageIds: ['root-1'],
  unassigned: [],
  stats: { files: 4, codeFiles: 4, leafPages: 2, overviewPages: 1, rootPages: 1 },
  topics: [
    {
      id: 't-src',
      title: 'src',
      dir: 'src',
      overviewPageId: 'ov-1',
      pageIds: ['leaf-a', 'leaf-b'],
      children: []
    }
  ],
  pages: [
    {
      id: 'root-1',
      kind: 'root',
      title: '项目概述',
      topicDir: null,
      anchorDir: '',
      anchorSymbol: null,
      topicId: null,
      members: [],
      evidenceTokens: 0
    },
    {
      id: 'ov-1',
      kind: 'overview',
      title: 'src 总览',
      topicDir: null,
      anchorDir: 'src',
      anchorSymbol: null,
      topicId: 't-src',
      members: [],
      evidenceTokens: 0
    },
    {
      id: 'leaf-a',
      kind: 'leaf',
      title: 'a',
      topicDir: null,
      anchorDir: 'src',
      anchorSymbol: 'runA',
      topicId: 't-src',
      members: [
        { path: 'src/a.ts', role: 'primary' },
        { path: 'src/aHelper.ts', role: 'supporting' }
      ],
      evidenceTokens: 10
    },
    {
      id: 'leaf-b',
      kind: 'leaf',
      title: 'b',
      topicDir: null,
      anchorDir: 'src',
      anchorSymbol: 'runB',
      topicId: 't-src',
      members: [{ path: 'src/b.ts', role: 'primary' }],
      evidenceTokens: 10
    }
  ]
} as WikiPlan

const language: WikiLanguageStateV2 = {
  code: 'zh-CN',
  label: '中文（简体）',
  origin: 'generated',
  legacy: {},
  pages: {
    'leaf-a': {
      pageId: 'leaf-a',
      kind: 'leaf',
      file: 'src/a.md',
      name: '甲页',
      nameSource: 'locked',
      status: 'done',
      model: 'm',
      generatedAt: '2026-01-01',
      members: [],
      budgetNotes: [],
      summary: '甲页摘要',
      keyFiles: ['src/a.ts']
    }
  }
}

const wall = buildWikiWall(
  plan,
  [
    { from: 'src/a.ts', to: 'src/b.ts' },
    { from: 'src/aHelper.ts', to: 'src/b.ts' },
    { from: 'src/b.ts', to: 'src/b.ts' }
  ],
  language
)

const cardA = wall.cards.find((card) => card.pageId === 'leaf-a')!
assert.equal(cardA.title, '甲页', '记账 AI 名称优先')
assert.equal(cardA.status, 'done')
assert.equal(cardA.summary, '甲页摘要')
assert.deepEqual(cardA.topicPath, ['src'])
const cardB = wall.cards.find((card) => card.pageId === 'leaf-b')!
assert.equal(cardB.status, 'planned', '无记账即待生成')
assert.deepEqual(cardB.keyFiles, ['src/b.ts'], '未生成时关键文件取主角成员')
const contains = wall.links.filter((link) => link.kind === 'contains')
assert.equal(contains.length, 2, '总览连两张叶子卡')
const refs = wall.links.filter((link) => link.kind === 'reference')
assert.equal(refs.length, 1, '同页自引用不画线')
assert.equal(refs[0].weight, 2, '两条文件引用聚合成权重 2')
assert.equal(refs[0].from, 'leaf-a')
assert.equal(refs[0].to, 'leaf-b')

console.log('selftest-wikiwall ok')
