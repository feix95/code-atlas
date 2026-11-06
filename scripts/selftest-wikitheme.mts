// 主题规划自测:摘要、亲和边、确定性聚类、提示词修补、归属与层级。
import assert from 'node:assert/strict'
import { buildWikiPlan } from '../src/wiki/wikiPlan.ts'
import type { WikiPlanFileInput, WikiPlanInput } from '../src/wiki/wikiPlanTypes.ts'
import { PLAN_LEAF_MAX_PRIMARY, PLAN_THEME_MAX_DEPTH } from '../src/wiki/wikiPlanTypes.ts'
import {
  CONTRACT_COPIES,
  CONTRACT_MAX_ATOMS,
  IMPORT_COPIES,
  TOKEN_MAX_ATOMS,
  affinityEdges,
  atomBrief,
  edgeCopies,
  type ThemeAtom
} from '../src/wiki/wikiThemeAtoms.ts'
import { clusterPlacements } from '../src/wiki/wikiThemeCluster.ts'
import { parseC1, parseC2, parseC3, parseModelJson } from '../src/wiki/wikiThemePrompt.ts'
import { placementsFromCatalog } from '../src/wiki/wikiThemeCatalog.ts'
import { resolveCatalog, type WikiCatalog } from '../src/wiki/wikiCatalogStore.ts'

function atom(id: string, primary: string[], feature: string | null = null): ThemeAtom {
  return {
    id,
    title: id,
    primary,
    feature,
    anchorDir: primary[0]?.split('/').slice(0, -1).join('/') ?? '',
    anchorSymbol: null,
    symbols: [],
    reactFiles: 0,
    shellFiles: 0
  }
}

function file(relPath: string, opts: Partial<WikiPlanFileInput> = {}): WikiPlanFileInput {
  return {
    relPath,
    languageId: 'typescript',
    sizeBytes: 3000,
    exports: [],
    functions: [],
    classes: [],
    reactComponents: [],
    inCount: 0,
    outCount: 0,
    ...opts
  }
}

const atoms = [
  atom('a', ['src/chat/thread.ts'], 'chat'),
  atom('b', ['src/ui/chatBox.tsx'], 'chat'),
  atom('c', ['src/graph/layout.ts'], 'graph'),
  atom('d', ['src/lone/solo.ts'])
]
assert.ok(!atomBrief(atoms[0]!).includes('/home/'), '摘要不含绝对路径')
assert.ok(!/^[A-Za-z]:\\/.test(atomBrief(atoms[0]!)), '摘要不含盘符')
assert.ok(atomBrief(atoms[0]!).includes('src/chat/thread.ts'), '摘要用仓库内相对路径')

const edges = affinityEdges(
  atoms,
  [
    { from: 'src/chat/thread.ts', to: 'src/ui/chatBox.tsx' },
    { from: 'src/chat/thread.ts', to: 'src/hub/types.ts' }
  ],
  new Set(['src/hub/types.ts']),
  [
    { file: 'src/chat/thread.ts', hub: 'src/hub/channels.ts', member: 'send' },
    { file: 'src/graph/layout.ts', hub: 'src/hub/channels.ts', member: 'send' }
  ]
)
assert.equal(edgeCopies(edges, 'a', 'b'), IMPORT_COPIES + 1, '引用边一份,同功能词再加一份')
assert.equal(edgeCopies(edges, 'a', 'c'), CONTRACT_COPIES, '共用导出成员按契约权重连边')
assert.equal(edgeCopies(edges, 'a', 'd'), 0, '没有共同信号就不连')
assert.equal(
  affinityEdges(
    Array.from({ length: TOKEN_MAX_ATOMS + 1 }, (_, i) =>
      atom(`t${i}`, [`src/m${i}/widget${i}.ts`])
    ),
    [],
    new Set(),
    []
  ).length,
  0,
  '功能词超过上限不连,避免把全仓粘住'
)

const many = Array.from({ length: CONTRACT_MAX_ATOMS + 2 }, (_, i) =>
  atom(`k${i}`, [`src/k/f${i}.ts`])
)
const contractEdges = affinityEdges(
  many,
  [],
  new Set(),
  many.map((item) => ({ file: item.primary[0]!, hub: 'h.ts', member: 'ping' }))
)
const linked = new Set<string>()
for (const edge of contractEdges) {
  linked.add(edge.from)
  linked.add(edge.to)
}
assert.equal(linked.size, CONTRACT_MAX_ATOMS, '同一个通道成员最多连有限个原子')

const open = new Set(['features', 'components', 'architecture'])
const once = clusterPlacements(
  atoms,
  [{ from: 'src/chat/thread.ts', to: 'src/ui/chatBox.tsx' }],
  new Set(),
  [],
  open
)
const twice = clusterPlacements(
  atoms,
  [{ from: 'src/chat/thread.ts', to: 'src/ui/chatBox.tsx' }],
  new Set(),
  [],
  open
)
assert.deepEqual(once, twice, '固定种子下聚类结果不变')
assert.equal(new Set(once.map((place) => place.atomId)).size, atoms.length, '每个原子恰好一个落点')

assert.equal(parseModelJson('不是 json'), null, '坏 JSON 交给兜底')
assert.equal(
  parseC1('{"themes":[{"title":"只有一个","slug":"one","oneLine":""}]}'),
  null,
  '主题太少不当成功'
)
const known = new Set(['a', 'b'])
const categories = new Set(['chat', 'features'])
const parsed = parseC2(
  '{"items":[{"atomId":"a","category":"chat"},{"atomId":"nope","category":"chat"},{"atomId":"a","category":"features"},{"atomId":"b","category":"nope"}]}',
  known,
  categories
)
assert.deepEqual(
  parsed,
  [{ atomId: 'a', category: 'chat' }],
  '未知标识丢掉,重复只留第一次,非法类别丢掉'
)
assert.equal(parseC2('[]', known, categories), null, '坏形状走兜底')
const named = parseC3(
  '{"sections":[],"pages":[{"atomId":"a","title":"对话","slug":"chat","section":"","prompt":"写对话"}]}',
  known
)
assert.equal(named?.pages[0]?.title, '对话')

const catalog: WikiCatalog = {
  version: 1,
  planVersion: 3,
  model: 'm',
  membersHash: 'stale',
  themes: [{ slug: 'chat', title: '对话', oneLine: '', parent: 'features' }],
  atoms: [
    {
      atomId: 'a',
      membersKey: 'src/chat/thread.ts',
      category: 'chat',
      section: null,
      sectionTitle: null,
      title: '对话线程',
      slug: 'thread',
      prompt: ''
    }
  ]
}
assert.equal(
  resolveCatalog(
    catalog,
    atoms.map((item) => ({ atomId: item.id, membersKey: item.primary.join('\n') }))
  ),
  null,
  '变化太多就不用旧目录'
)
const same = resolveCatalog(catalog, [{ atomId: 'a', membersKey: 'src/chat/thread.ts' }])
assert.equal(same?.atoms.length, 1, '成员没变就复用')
const placed = placementsFromCatalog(catalog, [atoms[0]!], new Set(['features']))
assert.equal(placed?.[0]?.theme, null, '只有一个原子的主题并回章,不单留空壳')

const plan = buildWikiPlan({
  projectName: 'demo',
  files: [
    file('src/chat/a.ts'),
    file('src/chat/b.ts'),
    file('src/other/c.ts'),
    file('src/other/d.ts')
  ],
  edges: [
    { from: 'src/chat/a.ts', to: 'src/chat/b.ts' },
    { from: 'src/other/c.ts', to: 'src/other/d.ts' }
  ],
  rootDocs: [],
  manifestPath: null,
  manifestScripts: []
} satisfies WikiPlanInput)
const leaves = plan.pages.filter((page) => page.kind === 'leaf')
const seen = new Set<string>()
for (const page of leaves) {
  for (const member of page.members) {
    if (member.role !== 'primary') continue
    assert.ok(!seen.has(member.path), '主角只归属一页')
    seen.add(member.path)
  }
  assert.ok(
    page.members.filter((member) => member.role === 'primary').length <= PLAN_LEAF_MAX_PRIMARY,
    '叶子主角不超过上限'
  )
}
const depth = (topics: typeof plan.topics, level: number): number =>
  topics.reduce((max, topic) => Math.max(max, level, depth(topic.children, level + 1)), level)
assert.ok(depth(plan.topics, 1) <= PLAN_THEME_MAX_DEPTH, '主题层级不超过 5')
assert.ok(
  plan.topics.some((topic) => topic.title === '核心功能'),
  '兜底时岛是章,不是目录'
)
assert.ok(!plan.topics.some((topic) => topic.dir.startsWith('src')), '顶层不是 src 目录')

console.log('selftest-wikitheme ok')
