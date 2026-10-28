// 模块切分自测:确定性(两次相同、打乱输入相同)、文件夹偏置、无导入文件归属、锚点 id 稳定、小社区合并、
// 以及经 buildDependencyGraph 的端到端形态(modules 字段存在、不夹带全仓结构清单、路径全用 '/')。
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { cutModules, type ModuleCutInput } from '../src/modules/cutModules.ts'
import { mergeSmallCommunities } from '../src/modules/moduleAssign.ts'
import { createSeededRandom } from '../src/modules/seededRandom.ts'
import { DEFAULT_MODULE_PARAMS } from '../src/modules/moduleConfig.ts'
import { buildDependencyGraph } from '../src/depgraph/index.ts'
import type { DepEdge, ModuleMap } from '../src/shared/types.ts'

const e = (from: string, to: string): DepEdge => ({ from, to })

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function moduleOf(map: ModuleMap, file: string): string | undefined {
  return Object.hasOwn(map.fileToModule, file) ? map.fileToModule[file] : undefined
}

/** 随机生成一个中等规模项目:dirs 个目录、每目录若干文件,目录内导入多、跨目录导入少 */
function randomProject(seed: number, dirs: number, perDir: number): ModuleCutInput {
  const rand = createSeededRandom(seed)
  const analyzable: string[] = []
  for (let d = 0; d < dirs; d++) {
    for (let f = 0; f < perDir; f++) analyzable.push(`pkg${d % 4}/dir${d}/file${f}.ts`)
  }
  const edges: DepEdge[] = []
  for (const from of analyzable) {
    for (let k = 0; k < 3; k++) {
      const sameDir = rand() < 0.8
      const dir = sameDir
        ? dirname(from)
        : `pkg${Math.floor(rand() * 4)}/dir${Math.floor(rand() * dirs)}`
      const to = `${dir}/file${Math.floor(rand() * perDir)}.ts`
      if (analyzable.includes(to)) edges.push(e(from, to))
    }
  }
  const files = [...analyzable, 'README.md', 'docs/guide.md', 'pkg0/dir0/style.css']
  return { files, analyzable, edges }
}

function checkDeterminism(): void {
  const input = randomProject(7, 24, 12)
  const first = JSON.stringify(cutModules(input))
  assert.equal(JSON.stringify(cutModules(input)), first, '同一输入切两次结果必须逐字段相同')
  const rand = createSeededRandom(99)
  for (let round = 0; round < 6; round++) {
    const shuffledInput: ModuleCutInput = {
      files: shuffled(input.files, rand),
      analyzable: shuffled(input.analyzable, rand),
      edges: shuffled(input.edges, rand)
    }
    assert.equal(
      JSON.stringify(cutModules(shuffledInput)),
      first,
      `打乱输入顺序后结果变了(第 ${round + 1} 轮)`
    )
  }
  const duplicated = { ...input, edges: [...input.edges, ...input.edges] }
  assert.equal(JSON.stringify(cutModules(duplicated)), first, '重复的边不应改变结果')
  const map = JSON.parse(first) as ModuleMap
  assert.ok(map.modules.length > 1, '随机项目应切出多个模块')
}

// 规则类用例固定分辨率 1,只验证归属规则本身;调 MODULE_RESOLUTION 不应让这些用例跟着改。
// 确定性与端到端用例走默认参数,覆盖定稿值。
const RULE_PARAMS = { ...DEFAULT_MODULE_PARAMS, resolution: 1 }
const cutWithRuleParams = (input: ModuleCutInput): ModuleMap => cutModules(input, RULE_PARAMS)

function checkFolderBias(): void {
  const weak = cutWithRuleParams({
    files: [],
    analyzable: ['a/a1.ts', 'a/a2.ts', 'a/a3.ts', 'b/b1.ts', 'b/b2.ts', 'b/b3.ts'],
    edges: [
      e('a/a1.ts', 'a/a2.ts'),
      e('a/a2.ts', 'a/a3.ts'),
      e('a/a3.ts', 'a/a1.ts'),
      e('b/b1.ts', 'b/b2.ts'),
      e('b/b2.ts', 'b/b3.ts'),
      e('b/b3.ts', 'b/b1.ts'),
      e('a/a1.ts', 'b/b1.ts')
    ]
  })
  assert.equal(weak.modules.length, 2, '目录间只有 1 条引用时应切成两个模块')
  assert.deepEqual(
    weak.modules.map((m) => m.folders),
    [['a'], ['b']],
    '两个模块各占一个目录'
  )
  assert.deepEqual(
    weak.links,
    [{ from: 'm:a/a1.ts', to: 'm:b/b1.ts', weight: 1 }],
    '模块间边按引用条数聚合'
  )

  const pairs = ['x', 'y', 'z']
  const strong = cutWithRuleParams({
    files: [],
    analyzable: pairs.flatMap((p) => [`ui/${p}.tsx`, `core/${p}.ts`]),
    edges: pairs.flatMap((p) => [
      e(`ui/${p}.tsx`, `core/${p}.ts`),
      e(`core/${p}.ts`, `ui/${p}.tsx`)
    ])
  })
  for (const p of pairs) {
    assert.equal(
      moduleOf(strong, `ui/${p}.tsx`),
      moduleOf(strong, `core/${p}.ts`),
      `跨目录强互引的 ${p} 应同模块`
    )
  }
  assert.ok(
    strong.modules.some((m) => m.folders.length === 2),
    '强互引模块应跨两个目录'
  )
}

function checkLooseFiles(): void {
  const map = cutWithRuleParams({
    files: [
      'README.md',
      'docs/guide.md',
      'a/style.css',
      'a/logo.png',
      'a/assets/icon.png',
      'config.ts',
      'a/lonely.ts',
      'build/out.js'
    ],
    analyzable: ['a/a1.ts', 'a/a2.ts', 'a/lonely.ts', 'config.ts', 'build/out.js'],
    edges: [e('a/a1.ts', 'a/a2.ts')]
  })
  const home = moduleOf(map, 'a/a1.ts')
  assert.ok(home, 'a/a1.ts 应属于某个模块')
  for (const f of ['a/style.css', 'a/logo.png', 'a/lonely.ts', 'a/assets/icon.png']) {
    assert.equal(moduleOf(map, f), home, `${f} 应就近归入 a 目录的模块`)
  }
  for (const f of ['README.md', 'docs/guide.md', 'config.ts', 'build/out.js']) {
    assert.equal(moduleOf(map, f), undefined, `${f} 应为未归类`)
  }
  const module = map.modules.find((m) => m.id === home)
  assert.deepEqual(module?.attached, [
    'a/assets/icon.png',
    'a/logo.png',
    'a/lonely.ts',
    'a/style.css'
  ])
  assert.deepEqual(module?.folders, ['a', 'a/assets'], 'folders 含就近归入文件的目录')

  const tie = cutWithRuleParams({
    files: ['tie/readme.md'],
    analyzable: ['m1/p.ts', 'm1/q.ts', 'tie/a1.ts', 'm2/r.ts', 'm2/s.ts', 'tie/b1.ts'],
    edges: [
      e('tie/a1.ts', 'm1/p.ts'),
      e('tie/a1.ts', 'm1/q.ts'),
      e('m1/p.ts', 'm1/q.ts'),
      e('m1/q.ts', 'm1/p.ts'),
      e('tie/b1.ts', 'm2/r.ts'),
      e('tie/b1.ts', 'm2/s.ts'),
      e('m2/r.ts', 'm2/s.ts'),
      e('m2/s.ts', 'm2/r.ts')
    ]
  })
  const left = moduleOf(tie, 'tie/a1.ts')
  const right = moduleOf(tie, 'tie/b1.ts')
  assert.ok(left && right && left !== right, '平票夹具应切出两个模块')
  assert.equal(
    moduleOf(tie, 'tie/readme.md'),
    [left, right].sort()[0],
    '平票时归入 id 字典序小的模块'
  )
}

function checkAnchorStability(): void {
  // 单独一个模块的图上 Louvain 总会找到正模块度的拆法(整图一个社区的模块度恒为 0),
  // 所以夹具按真实形态放两个模块,只看 s 模块的 id
  const cluster = (d: string, hub: string, others: string[]): DepEdge[] => [
    ...others.map((o) => e(`${d}/${o}.ts`, `${d}/${hub}.ts`)),
    ...others.map((o, i) => e(`${d}/${o}.ts`, `${d}/${others[(i + 1) % others.length]}.ts`))
  ]
  const base: ModuleCutInput = {
    files: [],
    analyzable: [
      's/hub.ts',
      's/a.ts',
      's/b.ts',
      's/c.ts',
      't/hub.ts',
      't/x.ts',
      't/y.ts',
      't/z.ts'
    ],
    edges: [
      ...cluster('s', 'hub', ['a', 'b', 'c']),
      ...cluster('t', 'hub', ['x', 'y', 'z']),
      e('s/a.ts', 't/x.ts')
    ]
  }
  const before = cutWithRuleParams(base)
  assert.deepEqual(
    before.modules.map((m) => m.id).sort(),
    ['m:s/hub.ts', 'm:t/hub.ts'],
    '锚点应为入度最高的 hub.ts'
  )
  const after = cutWithRuleParams({
    ...base,
    analyzable: [...base.analyzable, 's/new.ts'],
    edges: [...base.edges, e('s/new.ts', 's/hub.ts')]
  })
  assert.equal(moduleOf(after, 's/new.ts'), 'm:s/hub.ts', '新增低入度文件进入 s 模块')
  assert.deepEqual(
    after.modules.map((m) => m.id).sort(),
    ['m:s/hub.ts', 'm:t/hub.ts'],
    '新增低入度文件后模块 id 不变'
  )
  const tied = cutWithRuleParams({
    files: [],
    analyzable: ['t/b.ts', 't/a.ts'],
    edges: [e('t/a.ts', 't/b.ts'), e('t/b.ts', 't/a.ts')]
  })
  assert.equal(tied.modules[0]?.anchor, 't/a.ts', '入度平票取字典序最小者')
}

function checkSmallMerge(): void {
  const inDegree = new Map<string, number>()
  assert.deepEqual(
    mergeSmallCommunities([['a/x.ts', 'a/y.ts'], ['a/w.ts']], inDegree, 2),
    [['a/w.ts', 'a/x.ts', 'a/y.ts']],
    '单文件社区并入所在目录的模块'
  )
  assert.deepEqual(
    mergeSmallCommunities([['p/a.ts', 'p/b.ts'], ['p/sub/c.ts']], inDegree, 2),
    [['p/a.ts', 'p/b.ts', 'p/sub/c.ts']],
    '所在目录没有模块时向上找祖先目录'
  )
  assert.deepEqual(
    mergeSmallCommunities([['b/1.ts', 'b/2.ts'], ['c/q.ts'], ['root.ts']], inDegree, 2),
    [['b/1.ts', 'b/2.ts'], ['c/q.ts'], ['root.ts']],
    '找不到就近模块(含项目根下)时单独成模块'
  )
  const twoLarge = mergeSmallCommunities(
    [['d/k1.ts', 'e/k2.ts'], ['d/m1.ts', 'd/m2.ts'], ['d/z.ts']],
    inDegree,
    2
  )
  assert.deepEqual(twoLarge[1], ['d/m1.ts', 'd/m2.ts', 'd/z.ts'], '并入该目录直接成员最多的模块')
}

function checkEdgeCases(): void {
  const empty = cutWithRuleParams({ files: ['README.md'], analyzable: [], edges: [] })
  assert.deepEqual(empty.modules, [], '没有可分析文件时没有模块')
  assert.deepEqual(empty.fileToModule, {}, '没有模块时全部未归类')
  const noEdges = cutWithRuleParams({
    files: ['a/x.css'],
    analyzable: ['a/x.ts', 'a/y.ts'],
    edges: []
  })
  assert.deepEqual(noEdges.modules, [], '全是孤立文件时没有模块')
  const selfLoop = cutWithRuleParams({
    files: [],
    analyzable: ['a/x.ts'],
    edges: [e('a/x.ts', 'a/x.ts')]
  })
  assert.deepEqual(selfLoop.modules, [], '自引用不算导入边')
  const dangling = cutWithRuleParams({
    files: [],
    analyzable: ['a/x.ts'],
    edges: [e('a/x.ts', 'a/ghost.ts')]
  })
  assert.deepEqual(dangling.modules, [], '端点不在可分析文件里的边被忽略')
  const proto = cutWithRuleParams({
    files: [],
    analyzable: ['__proto__', 'constructor'],
    edges: [e('__proto__', 'constructor')]
  })
  assert.equal(moduleOf(proto, '__proto__'), 'm:constructor', '特殊文件名不污染映射表')
  assert.deepEqual(
    cutModules({ files: [], analyzable: [], edges: [] }).params,
    DEFAULT_MODULE_PARAMS
  )
}

async function checkDepGraphShape(): Promise<void> {
  const root = join(tmpdir(), `codeatlas-modules-${Date.now()}`, 'mod-project')
  const put = async (rel: string, content: string): Promise<void> => {
    await fs.mkdir(dirname(join(root, rel)), { recursive: true })
    await fs.writeFile(join(root, rel), content, 'utf8')
  }
  await put(
    'tsconfig.json',
    '{ "compilerOptions": { "paths": { "@shared/*": ["./src/shared/*"] } } }\n'
  )
  await put(
    'src/ui/App.tsx',
    "import { t } from '@shared/types'\nimport { b } from './Button'\nimport './app.css'\nexport const A = [t, b]\n"
  )
  await put('src/ui/Button.tsx', "import { t } from '@shared/types'\nexport const b = t\n")
  await put('src/ui/app.css', 'body { margin: 0 }\n')
  await put('src/shared/types.ts', 'export const t = 1\n')
  await put('README.md', '# demo\n')
  try {
    const graph = await buildDependencyGraph(root)
    assert.deepEqual(
      Object.keys(graph).sort(),
      ['durationMs', 'edges', 'hubs', 'modules', 'nodes', 'rootPath', 'stats'],
      '返回值只多 modules 字段,不夹带全仓结构清单'
    )
    const modules = graph.modules
    assert.ok(modules, 'modules 字段应存在')
    assert.equal(
      moduleOf(modules, 'src/ui/app.css'),
      moduleOf(modules, 'src/ui/App.tsx'),
      'css 就近归入'
    )
    assert.equal(moduleOf(modules, 'README.md'), undefined, '根目录 README 未归类')
    const text = JSON.stringify(modules)
    assert.ok(!text.includes('\\\\'), '模块数据里的路径只用 / 分隔')
    assert.ok(!text.includes(root.replaceAll('\\', '\\\\')), '模块数据不含绝对路径')
  } finally {
    await fs.rm(dirname(root), { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  checkDeterminism()
  checkFolderBias()
  checkLooseFiles()
  checkAnchorStability()
  checkSmallMerge()
  checkEdgeCases()
  await checkDepGraphShape()
  console.log('selftest-modules: 全部通过')
}

main().catch((err) => {
  console.error('selftest-modules 失败:', err)
  process.exit(1)
})
