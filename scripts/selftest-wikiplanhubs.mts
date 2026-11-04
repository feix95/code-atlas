// Wiki 主题切分自测(公共文件、孤立文件、功能章):npm run test:wikiplanhubs(纯函数,不读盘不联网)
// 公共文件请出聚类单独成页、孤立单文件按引用就近归属不进杂物页、功能主题归到「核心功能」一章、
// 功能名只收同名文件里互相引用连成一团的部分。
import assert from 'node:assert/strict'
import { buildWikiPlan } from '../src/wiki/wikiPlan.ts'
import { placeOrphans } from '../src/wiki/wikiPlanHubs.ts'
import type {
  DraftGroup,
  WikiPlan,
  WikiPlanFileInput,
  WikiPlanInput,
  WikiPlanPage,
  WikiPlanTopic
} from '../src/wiki/wikiPlanTypes.ts'

/** 按边算好入度,免得手填出错 */
function plan(paths: string[], edges: [string, string][]): WikiPlan {
  const inCount = new Map<string, number>()
  for (const [, to] of edges) inCount.set(to, (inCount.get(to) ?? 0) + 1)
  const files: WikiPlanFileInput[] = paths.map((relPath) => ({
    relPath,
    languageId: 'typescript',
    sizeBytes: 3000,
    exports: [],
    functions: [],
    classes: [],
    reactComponents: [],
    inCount: inCount.get(relPath) ?? 0,
    outCount: 0
  }))
  const input: WikiPlanInput = {
    projectName: 'demo',
    files,
    edges: edges.map(([from, to]) => ({ from, to })),
    rootDocs: [],
    manifestPath: null,
    manifestScripts: []
  }
  return buildWikiPlan(input)
}

function pageOf(result: WikiPlan, path: string): WikiPlanPage | undefined {
  return result.pages.find(
    (p) => p.kind === 'leaf' && p.members.some((m) => m.path === path && m.role !== 'attached')
  )
}

function roleIn(result: WikiPlan, path: string): string | undefined {
  return pageOf(result, path)?.members.find((m) => m.path === path)?.role
}

function topicByDir(topics: WikiPlanTopic[], dir: string): WikiPlanTopic | undefined {
  for (const topic of topics) {
    if (topic.dir === dir) return topic
    const found = topicByDir(topic.children, dir)
    if (found) return found
  }
  return undefined
}

function main(): void {
  // 一、公共文件:被十几个目录引用的类型表与通道定义文件请出聚类,按目录单独成页
  const users = Array.from({ length: 12 }, (_, i) => `src/m${i}/user${i}.ts`)
  const hubPlan = plan(
    [...users, 'src/shared/types.ts', 'src/shared/ipcChannels.ts', 'src/shared/format.ts'],
    [
      ...users.map((u): [string, string] => [u, 'src/shared/types.ts']),
      ['src/m0/user0.ts', 'src/shared/ipcChannels.ts'],
      ['src/m1/user1.ts', 'src/shared/format.ts']
    ]
  )
  assert.deepEqual(hubPlan.hubs, ['src/shared/ipcChannels.ts', 'src/shared/types.ts'])
  const hubPage = pageOf(hubPlan, 'src/shared/types.ts')!
  assert.deepEqual(
    hubPage.members.map((m) => m.path),
    ['src/shared/ipcChannels.ts', 'src/shared/types.ts'],
    '同目录的公共文件同页,不夹带非公共文件'
  )
  assert.ok(hubPage.basis[0]!.startsWith('公共文件'), '依据写明是公共文件页')
  assert.notEqual(pageOf(hubPlan, 'src/shared/format.ts'), hubPage, '普通文件不进公共文件页')
  assert.equal(hubPlan.version, 2, '切分口径变了,规划器版本加一')

  // 二、孤立单文件:大目录里与本目录无引用的文件不再一律塞进最大一组;
  // 跟别处有引用的按票数就近当配角,一条引用都没有的自成一页
  const groupA: DraftGroup = {
    primary: ['a/1.ts', 'a/2.ts'],
    supporting: [],
    basis: [],
    crossDir: false
  }
  const groupB: DraftGroup = { primary: ['b/1.ts'], supporting: [], basis: [], crossDir: false }
  const drafts = [groupA, groupB]
  placeOrphans(['x/bridge.ts', 'x/alone.ts'], drafts, [
    { from: 'x/bridge.ts', to: 'b/1.ts' },
    { from: 'x/bridge.ts', to: 'a/1.ts' },
    { from: 'a/2.ts', to: 'x/bridge.ts' }
  ])
  assert.deepEqual(groupA.supporting, ['x/bridge.ts'], '按引用票数归到最亲的组当配角')
  assert.deepEqual(groupB.supporting, [])
  assert.equal(drafts.length, 3, '零票的孤立文件自成一组')
  assert.deepEqual(drafts[2]!.primary, ['x/alone.ts'])
  const core = Array.from({ length: 6 }, (_, i) => `src/big/core${i}.ts`)
  const side = ['src/big/sideA.ts', 'src/big/sideB.ts', 'src/big/sideC.ts']
  const orphanPlan = plan(
    [...core, ...side, 'src/big/lonely.ts'],
    [
      ...core.slice(1).map((c): [string, string] => [c, core[0]!]),
      ['src/big/sideA.ts', 'src/big/sideB.ts'],
      ['src/big/sideB.ts', 'src/big/sideC.ts']
    ]
  )
  assert.equal(roleIn(orphanPlan, 'src/big/lonely.ts'), 'primary', '零引用的孤立文件自成一页')
  assert.notEqual(
    pageOf(orphanPlan, 'src/big/lonely.ts'),
    pageOf(orphanPlan, core[0]!),
    '不塞进本目录最大的一组'
  )

  // 三、功能主题归到「核心功能」一章;同名文件只收互相引用连成一团的部分
  const featurePlan = plan(
    [
      'src/main/exportJob.ts',
      'src/renderer/exportPanel.ts',
      'src/shared/exportTypes.ts',
      'src/main/searchIndex.ts',
      'src/renderer/searchBox.ts',
      'src/shared/searchQuery.ts',
      'src/tools/searchLegacy.ts',
      'src/misc/searchNotes.ts',
      'src/a/menuOne.ts',
      'src/b/menuTwo.ts',
      'src/c/menuThree.ts'
    ],
    [
      ['src/main/exportJob.ts', 'src/shared/exportTypes.ts'],
      ['src/renderer/exportPanel.ts', 'src/shared/exportTypes.ts'],
      ['src/main/searchIndex.ts', 'src/shared/searchQuery.ts'],
      ['src/renderer/searchBox.ts', 'src/shared/searchQuery.ts'],
      ['src/a/menuOne.ts', 'src/b/menuTwo.ts']
    ]
  )
  const featureRoot = topicByDir(featurePlan.topics, 'feature:')
  assert.ok(featureRoot, '有「核心功能」一章')
  assert.equal(featureRoot.title, '核心功能')
  assert.deepEqual(
    featureRoot.children.map((t) => t.dir),
    ['feature:export', 'feature:search'],
    '各功能主题挂在核心功能下,不再散在根下'
  )
  assert.ok(
    featurePlan.topics.every((root) =>
      root.children.every((t) => t.dir === 'feature:' || !t.dir.startsWith('feature:'))
    ),
    '根下没有游离的功能主题'
  )
  const searchPage = pageOf(featurePlan, 'src/main/searchIndex.ts')!
  assert.equal(searchPage.topicDir, 'feature:search')
  assert.ok(
    pageOf(featurePlan, 'src/tools/searchLegacy.ts')?.topicDir !== 'feature:search',
    '同名但没引用连上的文件不算进功能'
  )
  assert.equal(
    topicByDir(featurePlan.topics, 'feature:menu'),
    undefined,
    '连成一团不足三个不成功能'
  )
}

main()
console.log('selftest-wikiplanhubs ok')
