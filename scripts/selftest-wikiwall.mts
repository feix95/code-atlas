// 自测:卡片墙装配。从属线、引用聚合权重(归属只认叶子页、公共文件不画线)、记账名称与状态合并、主题链。
import assert from 'node:assert/strict'
import { buildWikiWall } from '../src/wiki/wikiWall.ts'
import {
  parentChildInputs,
  parentChildrenOf,
  parentFingerprint
} from '../src/wiki/wikiParentTree.ts'
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

// 父页过期看下属指纹:指纹对得上是已生成,下属摘要一变立刻标过期
const childrenOf = parentChildrenOf(plan)
const fingerprintNow = parentFingerprint(parentChildInputs(plan, language, childrenOf.get('ov-1')!))
language.pages['ov-1'] = {
  pageId: 'ov-1',
  kind: 'overview',
  file: 'src/ov.md',
  name: 'src 总览',
  nameSource: 'program',
  status: 'done',
  model: 'm',
  generatedAt: '2026-01-01',
  members: [],
  budgetNotes: [],
  inputHash: fingerprintNow
}
const wallFresh = buildWikiWall(plan, [], language)
assert.equal(
  wallFresh.cards.find((card) => card.pageId === 'ov-1')!.status,
  'done',
  '指纹一致时父页为已生成'
)
language.pages['leaf-a']!.summary = '改过的摘要'
const wallStale = buildWikiWall(plan, [], language)
assert.equal(
  wallStale.cards.find((card) => card.pageId === 'ov-1')!.status,
  'stale',
  '下属摘要变化后父页应标过期'
)
language.pages['leaf-a']!.summary = '甲页摘要'

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

// 归属只认叶子页:总览页、根主题页列着成员(引用而非归属),不能把文件抢走、把引用线拉到自己身上;
// 指向公共文件(hubs)的引用不画
const withHub: WikiPlan = {
  ...plan,
  hubs: ['src/types.ts'],
  pages: plan.pages.map((page) =>
    page.kind === 'overview' || page.kind === 'root'
      ? {
          ...page,
          members: [
            { path: 'src/a.ts', role: 'supporting' as const },
            { path: 'src/b.ts', role: 'supporting' as const }
          ]
        }
      : page.id === 'leaf-b'
        ? {
            ...page,
            members: [...page.members, { path: 'src/types.ts', role: 'primary' as const }]
          }
        : page
  )
}
const hubRefs = buildWikiWall(
  withHub,
  [
    { from: 'src/a.ts', to: 'src/b.ts' },
    { from: 'src/aHelper.ts', to: 'src/b.ts' },
    { from: 'src/a.ts', to: 'src/types.ts' },
    { from: 'src/aHelper.ts', to: 'src/types.ts' }
  ],
  language
).links.filter((link) => link.kind === 'reference')
assert.deepEqual(
  hubRefs.map((link) => [link.from, link.to, link.weight]),
  [['leaf-a', 'leaf-b', 2]],
  '总览与根主题页不抢归属,指向公共文件的引用不画'
)

// reference 只是出处:即使写在叶子页上,也不参加归属,不因此多画一条线
const cited = buildWikiWall(
  {
    ...plan,
    hubs: [],
    pages: plan.pages.map((page) =>
      page.id === 'leaf-a'
        ? {
            ...page,
            members: [...page.members, { path: 'src/onlyRef.ts', role: 'reference' as const }]
          }
        : page
    )
  },
  [
    { from: 'src/onlyRef.ts', to: 'src/b.ts' },
    { from: 'src/a.ts', to: 'src/b.ts' }
  ],
  language
).links.filter((link) => link.kind === 'reference')
assert.deepEqual(
  cited.map((link) => [link.from, link.to, link.weight]),
  [['leaf-a', 'leaf-b', 1]],
  'reference 成员不产生连线,主角之间的引用仍在'
)

console.log('selftest-wikiwall ok')
