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
  const typePage = hubPlan.pages.find((page) =>
    page.members.some(
      (member) => member.path === 'src/shared/types.ts' && member.role === 'primary'
    )
  )!
  assert.equal(typePage.title, '共享类型', '类型公共文件归共享类型页')
  assert.ok(typePage.basis[0]!.startsWith('骨架'), '依据写明是骨架页')
  assert.ok(
    !typePage.members.some((member) => member.path === 'src/shared/format.ts'),
    '普通文件不进公共类型页'
  )
  const channelOwner = hubPlan.pages.find((page) =>
    page.members.some(
      (member) => member.path === 'src/shared/ipcChannels.ts' && member.role === 'primary'
    )
  )
  assert.ok(channelOwner, '通道定义文件有唯一主角归属')
  assert.notEqual(channelOwner, typePage, '通道定义与类型表分开归属')
  assert.ok(
    users.every(
      (path) =>
        !typePage.members.some((member) => member.path === path && member.role === 'primary')
    ),
    '引用方不进公共类型页当主角'
  )
  assert.equal(hubPlan.version, 3, '主题树口径变了,规划器版本再加一')

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
  const featureRoot = featurePlan.topics.find((topic) => topic.title === '核心功能')
  assert.ok(featureRoot, '有「核心功能」一章')
  assert.ok(
    featurePlan.topics.every((topic) => !topic.title.includes('/') && !topic.dir.startsWith('src')),
    '根上不再是 src 目录岛'
  )
  const under = (topic: WikiPlanTopic, pageId: string): boolean =>
    topic.pageIds.includes(pageId) || topic.children.some((child) => under(child, pageId))
  const exportPage = pageOf(featurePlan, 'src/main/exportJob.ts')!
  const searchPage = pageOf(featurePlan, 'src/main/searchIndex.ts')!
  assert.ok(under(featureRoot, exportPage.id), '导出功能挂在核心功能下')
  assert.ok(under(featureRoot, searchPage.id), '搜索功能挂在核心功能下')
  assert.notEqual(exportPage.id, searchPage.id, '两个功能仍是两页')
  assert.ok(
    !exportPage.members.some((member) => member.path === 'src/tools/searchLegacy.ts'),
    '同名但没引用连上的文件不算进功能页'
  )
  const menuPage = pageOf(featurePlan, 'src/a/menuOne.ts')!
  assert.ok(!menuPage.basis.some((line) => line.includes('功能名')), '连成一团不足三个不成功能页')
}

main()
console.log('selftest-wikiplanhubs ok')
