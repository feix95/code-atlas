// 模块切分自测:确定性(两次相同、打乱输入相同)、文件夹偏置、无导入文件归属、锚点 id 稳定、小社区合并、
// 以及经 buildDependencyGraph 的端到端形态(modules 字段存在、不夹带全仓结构清单、路径全用 '/')。
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { cutModules, type ModuleCutInput, type StyleLink } from '../src/modules/cutModules.ts'
import { mergeSmallCommunities, pickAnchor } from '../src/modules/moduleAssign.ts'
import { hubWeight } from '../src/modules/communities.ts'
import { isTestFile } from '../src/modules/attachTests.ts'
import { findHubs, hubThreshold } from '../src/modules/hubs.ts'
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
  const files = [...analyzable, 'README.md', 'docs/guide.md', 'pkg0/dir0/style.css', 'css/a.css']
  const styleLinks: StyleLink[] = [
    { from: 'pkg0/dir0/file0.ts', to: 'pkg0/dir0/style.css', kind: 'import', weight: 1 },
    { from: 'pkg0/dir0/style.css', to: 'css/a.css', kind: 'import', weight: 1 },
    ...analyzable
      .filter(() => rand() < 0.1)
      .map((from): StyleLink => ({ from, to: 'css/a.css', kind: 'usage', weight: 1 / 3 }))
  ]
  return { files, analyzable, edges, styleLinks }
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
      edges: shuffled(input.edges, rand),
      styleLinks: shuffled(input.styleLinks ?? [], rand)
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

// 规则类用例固定分辨率 1、目录偏置 0.5,只验证归属规则本身;调 MODULE_RESOLUTION 或
// MODULE_FOLDER_AFFINITY 不应让这些用例跟着改。确定性与端到端用例走默认参数,覆盖定稿值。
const RULE_PARAMS = { ...DEFAULT_MODULE_PARAMS, resolution: 1, folderAffinity: 0.5 }
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

/** 两个各成一团的目录 a、b(三角互引),中间只有一条弱引用;规则类用例共用 */
function twoClusterInput(): ModuleCutInput {
  return {
    files: [],
    analyzable: ['a/a1.ts', 'a/a2.ts', 'a/a3.ts', 'b/b1.tsx', 'b/b2.ts', 'b/b3.ts'],
    edges: [
      e('a/a1.ts', 'a/a2.ts'),
      e('a/a2.ts', 'a/a3.ts'),
      e('a/a3.ts', 'a/a1.ts'),
      e('b/b1.tsx', 'b/b2.ts'),
      e('b/b2.ts', 'b/b3.ts'),
      e('b/b3.ts', 'b/b1.tsx'),
      e('a/a1.ts', 'b/b1.tsx')
    ]
  }
}

function checkStyles(): void {
  const base = twoClusterInput()
  const styleFiles = [
    'styles/main.css',
    'styles/b.css',
    'styles/tokens.css',
    'styles/orphan.css',
    'styles/loop1.css',
    'styles/loop2.css',
    'a/own.css'
  ]
  const link = (from: string, to: string, kind: StyleLink['kind'], weight = 1): StyleLink => ({
    from,
    to,
    kind,
    weight
  })
  const styleLinks = [
    link('a/a1.ts', 'styles/main.css', 'import'),
    link('styles/main.css', 'styles/b.css', 'import'),
    link('styles/main.css', 'styles/tokens.css', 'import'),
    link('b/b1.tsx', 'styles/b.css', 'usage', 2),
    link('a/a2.ts', 'styles/b.css', 'usage', 0.5),
    link('styles/loop1.css', 'styles/loop2.css', 'import'),
    link('styles/loop2.css', 'styles/loop1.css', 'import')
  ]
  const plain = cutWithRuleParams({ ...base, files: styleFiles })
  const map = cutWithRuleParams({ ...base, files: styleFiles, styleLinks })
  const a = moduleOf(map, 'a/a1.ts')
  const b = moduleOf(map, 'b/b1.tsx')
  assert.ok(a && b && a !== b, '夹具应切出 a、b 两个模块')
  assert.equal(moduleOf(map, 'styles/main.css'), a, '被代码文件直接导入的样式跟导入它的文件走')
  assert.equal(moduleOf(map, 'styles/b.css'), b, '没被代码直接导入时,跟类名用得最多的模块走')
  assert.equal(moduleOf(map, 'styles/tokens.css'), a, '只被样式 @import 的,跟导入它的样式走')
  assert.equal(
    moduleOf(map, 'styles/orphan.css'),
    undefined,
    '无人导入也无人使用,目录就近也找不到时未归类'
  )
  assert.equal(
    moduleOf(map, 'styles/loop1.css'),
    undefined,
    '样式互相 @import 成环时不卡死,按就近归属处理'
  )
  assert.equal(moduleOf(map, 'a/own.css'), a, '没有任何关系的样式按目录就近归属')
  for (const f of ['styles/main.css', 'styles/tokens.css']) {
    assert.ok(map.modules.find((m) => m.id === a)?.attached.includes(f), `${f} 记为附挂文件`)
  }
  const membersOnly = (m: ModuleMap): string[][] =>
    m.modules.map((mod) => mod.files.filter((f) => !mod.attached.includes(f)))
  assert.deepEqual(membersOnly(map), membersOnly(plain), '样式只附挂,不参与社区发现')
  assert.deepEqual(map.links, plain.links, '样式不产生模块间边')
}

/** 菱形 @import 长链:每层两份样式都 @import 下一层两份,全链无人认领;不缓存 -1 时重走次数随层数翻倍 */
function checkStyleImportChainSpeed(): void {
  const depth = 22
  const level = (i: number): string[] => {
    const tag = String(i).padStart(2, '0')
    return [`styles/d${tag}a.css`, `styles/d${tag}b.css`]
  }
  const styleLinks: StyleLink[] = []
  for (let i = 0; i < depth; i++) {
    for (const from of level(i + 1)) {
      for (const to of level(i)) styleLinks.push({ from, to, kind: 'import', weight: 1 })
    }
  }
  const files = Array.from({ length: depth + 1 }, (_, i) => level(i)).flat()
  const startedAt = performance.now()
  const map = cutWithRuleParams({ ...twoClusterInput(), files, styleLinks })
  const elapsed = performance.now() - startedAt
  console.log(`  菱形 @import 链 ${depth} 层:${elapsed.toFixed(1)} ms`)
  assert.ok(elapsed < 500, `菱形 @import 链应很快算完,实际 ${elapsed.toFixed(0)} ms`)
  for (const f of files) assert.equal(moduleOf(map, f), undefined, `${f} 无人认领应未归类`)
}

/** 菱形 @import 长链再加一条从底层回到顶层的回边:整条链成一个环,撞环不缓存时重走次数随层数翻倍 */
function checkStyleImportCycleSpeed(): void {
  const depth = 22
  const level = (i: number): string[] => {
    const tag = String(i).padStart(2, '0')
    return [`styles/c${tag}a.css`, `styles/c${tag}b.css`]
  }
  const styleLinks: StyleLink[] = []
  for (let i = 0; i < depth; i++) {
    for (const from of level(i + 1)) {
      for (const to of level(i)) styleLinks.push({ from, to, kind: 'import', weight: 1 })
    }
  }
  styleLinks.push({ from: level(0)[0], to: level(depth)[0], kind: 'import', weight: 1 })
  const files = Array.from({ length: depth + 1 }, (_, i) => level(i)).flat()
  const startedAt = performance.now()
  const map = cutWithRuleParams({ ...twoClusterInput(), files, styleLinks })
  const elapsed = performance.now() - startedAt
  console.log(`  带回边的菱形 @import 环 ${depth} 层:${elapsed.toFixed(1)} ms`)
  assert.ok(elapsed < 100, `带环的菱形 @import 链应很快算完,实际 ${elapsed.toFixed(0)} ms`)
  for (const f of files) assert.equal(moduleOf(map, f), undefined, `${f} 无人认领应未归类`)
  const link = (from: string, to: string, kind: StyleLink['kind']): StyleLink => ({
    from,
    to,
    kind,
    weight: 1
  })
  const ring = cutWithRuleParams({
    ...twoClusterInput(),
    files: ['styles/r1.css', 'styles/r2.css', 'styles/r3.css'],
    styleLinks: [
      link('styles/r1.css', 'styles/r2.css', 'import'),
      link('styles/r2.css', 'styles/r3.css', 'import'),
      link('styles/r3.css', 'styles/r1.css', 'import'),
      link('b/b2.ts', 'styles/r2.css', 'usage')
    ]
  })
  const b = moduleOf(ring, 'b/b1.tsx')
  for (const f of ['styles/r1.css', 'styles/r2.css', 'styles/r3.css']) {
    assert.equal(moduleOf(ring, f), b, `${f}: 环里有一份样式找到归属时,整个环跟它走`)
  }
}

function checkTestFiles(): void {
  const base = twoClusterInput()
  const tests = ['scripts/selftest-a.mts', 'src/b/b.test.ts', 'scripts/selftest-none.mts']
  const withTests: ModuleCutInput = {
    files: [],
    analyzable: [...base.analyzable, ...tests],
    edges: [
      ...base.edges,
      e('scripts/selftest-a.mts', 'a/a1.ts'),
      e('scripts/selftest-a.mts', 'a/a2.ts'),
      e('scripts/selftest-a.mts', 'b/b2.ts'),
      e('src/b/b.test.ts', 'b/b1.tsx'),
      e('src/b/b.test.ts', 'b/b3.ts'),
      e('src/b/b.test.ts', 'a/a3.ts'),
      e('src/b/b.test.ts', 'scripts/selftest-a.mts')
    ]
  }
  const plain = cutWithRuleParams(base)
  const map = cutWithRuleParams(withTests)
  const a = moduleOf(map, 'a/a1.ts')
  const b = moduleOf(map, 'b/b1.tsx')
  assert.ok(a && b && a !== b, '夹具应切出 a、b 两个模块')
  const shape = (m: ModuleMap): unknown =>
    m.modules.map((mod) => ({
      id: mod.id,
      anchor: mod.anchor,
      members: mod.files.filter((f) => !mod.tests.includes(f))
    }))
  assert.deepEqual(shape(map), shape(plain), '自测文件不参与社区发现,也不影响锚点与 id')
  assert.deepEqual(map.links, plain.links, '自测文件的导入不算模块间边')
  assert.equal(moduleOf(map, 'scripts/selftest-a.mts'), a, '自测挂到它导入最多的模块')
  assert.equal(moduleOf(map, 'src/b/b.test.ts'), b, '*.test.* 同样按自测处理,导入自测文件不算票')
  assert.equal(
    moduleOf(map, 'scripts/selftest-none.mts'),
    undefined,
    '什么都没导入的自测在根下目录里找不到模块时未归类'
  )
  assert.deepEqual(
    map.modules.find((m) => m.id === a)?.tests,
    ['scripts/selftest-a.mts'],
    '模块记下相关自测'
  )
  assert.deepEqual(map.modules.find((m) => m.id === b)?.tests, ['src/b/b.test.ts'])
  for (const m of map.modules) {
    for (const t of m.tests)
      assert.ok(!m.attached.includes(t), '自测单独记在 tests,不混进 attached')
  }
}

/** 自测文件识别:常见语言的测试命名与测试目录;只认代码文件,openapi.spec.json 这类数据文件不算 */
function checkTestFilePatterns(): void {
  const tests = [
    'scripts/selftest-a.mts',
    'src/b/b.test.ts',
    'src/x.spec.tsx',
    'src/__tests__/a.ts',
    'tests/helpers.ts',
    'test/util.js',
    'e2e/login.ts',
    'pkg/tests/a.py',
    'server/handler_test.go',
    'pkg/test_util.py',
    'pkg/util_test.py',
    'src/FooTests.cs',
    'src/test/java/com/x/FooTest.java',
    'app/BarTest.kt'
  ]
  for (const f of tests) assert.equal(isTestFile(f), true, `${f} 应识别为自测`)
  const notTests = [
    'docs/openapi.spec.json',
    'tests/fixtures/data.json',
    'e2e/screens/home.png',
    'src/latest.ts',
    'src/contest.py',
    'src/Contest.java',
    'src/testing.ts',
    'e2etools/x.ts',
    'testdata/case.ts',
    'pkg/attest_x.go'
  ]
  for (const f of notTests) assert.equal(isTestFile(f), false, `${f} 不应识别为自测`)
}

function checkHubWeight(): void {
  assert.equal(hubWeight(0), 1, '没人引用的文件(入度 0)按原权重')
  assert.equal(hubWeight(2), 0.5, '入度 2 时权重减半:1 / log2(2 + 2)')
  assert.equal(hubWeight(6), 1 / 3, '入度 6 时权重 1 / log2(8)')
  assert.ok(hubWeight(100) < hubWeight(10), '入度越高权重越轻')
  // 公共文件被三个目录的所有文件引用:不降权时两个公共文件被拆开吸进各功能模块(模块横跨两个目录),
  // 降权后公共文件留在自己的目录模块里,每个模块只占一个目录
  const dirs = ['a', 'b', 'c']
  const files = dirs.flatMap((d) => [0, 1, 2].map((i) => `${d}/${d}${i}.ts`))
  const map = cutWithRuleParams({
    files: [],
    analyzable: [...files, 'shared/types.ts', 'shared/ipc.ts'],
    edges: [
      ...dirs.flatMap((d) => [
        e(`${d}/${d}0.ts`, `${d}/${d}1.ts`),
        e(`${d}/${d}1.ts`, `${d}/${d}2.ts`)
      ]),
      ...files.flatMap((f) => [e(f, 'shared/types.ts'), e(f, 'shared/ipc.ts')]),
      e('shared/ipc.ts', 'shared/types.ts')
    ]
  })
  assert.equal(
    moduleOf(map, 'shared/ipc.ts'),
    moduleOf(map, 'shared/types.ts'),
    '两个公共文件同模块'
  )
  assert.deepEqual(
    map.modules.map((m) => m.folders),
    [['a'], ['b'], ['c'], ['shared']],
    '公共文件不被吸进功能模块,每个模块只占一个目录'
  )
}

/** 公共文件(入度 > max(10, 有入度文件数的 5%))不参与社区发现,分完按目录就近放回、当正式成员 */
function checkHubFiles(): void {
  assert.equal(hubThreshold(50, DEFAULT_MODULE_PARAMS), 10, '小项目门槛保底 10')
  assert.equal(hubThreshold(400, DEFAULT_MODULE_PARAMS), 20, '400 个有入度文件时门槛为 5% 即 20')
  const degrees = new Map<string, number>([
    ...Array.from({ length: 30 }, (_, i) => [`x/f${i}.ts`, 1] as [string, number]),
    ['x/h1.ts', 11],
    ['x/h2.ts', 10]
  ])
  assert.deepEqual([...findHubs(degrees, DEFAULT_MODULE_PARAMS)], ['x/h1.ts'], '入度要严格大于门槛')

  const users = Array.from({ length: 11 }, (_, i) => `a/a${i}.ts`)
  const pulled = cutWithRuleParams({
    files: [],
    analyzable: [...users, 'shared/types.ts', 'shared/x.ts', 'shared/y.ts'],
    edges: [
      ...users.map((f, i) => e(f, users[(i + 1) % users.length])),
      ...users.map((f) => e(f, 'shared/types.ts')),
      e('shared/x.ts', 'shared/y.ts'),
      e('shared/y.ts', 'shared/x.ts')
    ]
  })
  assert.equal(
    moduleOf(pulled, 'shared/types.ts'),
    moduleOf(pulled, 'shared/x.ts'),
    '公共文件按所在目录放回,不被引用它的 a 目录吸走'
  )
  const dirs = ['a', 'b', 'c', 'd']
  const files = dirs.flatMap((d) => [0, 1, 2, 3].map((i) => `${d}/${d}${i}.ts`))
  const map = cutWithRuleParams({
    files: [],
    analyzable: [...files, 'shared/types.ts', 'shared/x.ts', 'shared/y.ts', 'lib/hub.ts'],
    edges: [
      ...dirs.flatMap((d) => [
        e(`${d}/${d}0.ts`, `${d}/${d}1.ts`),
        e(`${d}/${d}1.ts`, `${d}/${d}2.ts`),
        e(`${d}/${d}2.ts`, `${d}/${d}3.ts`)
      ]),
      ...files.map((f) => e(f, 'shared/types.ts')),
      e('shared/x.ts', 'shared/y.ts'),
      e('shared/y.ts', 'shared/x.ts'),
      e('shared/x.ts', 'shared/types.ts'),
      ...files
        .filter((f) => !f.endsWith('3.ts') || f.startsWith('b/'))
        .map((f) => e(f, 'lib/hub.ts')),
      e('c/c0.ts', 'b/b0.ts')
    ]
  })
  const shared = map.modules.find((m) => m.files.includes('shared/x.ts'))
  assert.ok(shared, '应有 shared 目录的模块')
  assert.ok(shared.files.includes('shared/types.ts'), '公共文件按目录放回 shared 模块')
  assert.ok(!shared.attached.includes('shared/types.ts'), '放回的公共文件是正式成员,不是附挂')
  assert.equal(shared.anchor, 'shared/types.ts', '锚点按含公共文件在内的完整入度挑')
  for (const d of dirs) {
    const mod = map.modules.find((m) => m.files.includes(`${d}/${d}0.ts`))
    assert.deepEqual(mod?.folders, d === 'b' ? ['b', 'lib'] : [d], `${d} 目录的模块只占自己的目录`)
  }
  const hubHome = moduleOf(map, 'lib/hub.ts')
  assert.equal(hubHome, moduleOf(map, 'b/b0.ts'), '目录里找不到模块的公共文件,跟引用它最多的模块走')
  assert.ok(
    !map.modules.find((m) => m.id === hubHome)?.attached.includes('lib/hub.ts'),
    '跟引用方走的公共文件同样是正式成员'
  )
  assert.ok(
    map.links.some((l) => l.to === shared.id),
    '公共文件的导入照样算模块间边'
  )
}

function checkMajorityAnchor(): void {
  const inDegree = new Map([
    ['shared/ipc.ts', 10],
    ['ui/b.tsx', 2],
    ['ui/a.tsx', 1]
  ])
  assert.equal(
    pickAnchor(['shared/ipc.ts', 'ui/a.tsx', 'ui/b.tsx', 'ui/c.tsx'], inDegree),
    'ui/b.tsx',
    '锚点先取成员最多的目录,再在该目录里取入度最高者;公共文件不当锚点'
  )
  assert.equal(
    pickAnchor(['y/p.ts', 'x/q.ts', 'y/r.ts', 'x/s.ts'], new Map([['y/p.ts', 3]])),
    'x/q.ts',
    '目录成员数平票时取字典序小的目录'
  )
  const map = cutWithRuleParams(twoClusterInput())
  assert.deepEqual(
    map.modules.map((m) => m.folder).sort(),
    ['a', 'b'],
    '模块记下主目录(成员最多的目录),显示名由它而来'
  )
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
  await put(
    'src/ui/Card.tsx',
    'import { b } from \'./Button\'\nexport const C = () => <div className="card-frame">{b}</div>\n'
  )
  await put('src/theme/card.css', '.card-frame { margin: 0 }\n')
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
      'css 跟导入它的文件走'
    )
    assert.ok(
      !graph.stats.unresolved.some((u) => u.spec.endsWith('.css')),
      '存在的 css 导入不再记 unresolved'
    )
    assert.equal(
      moduleOf(modules, 'src/theme/card.css'),
      moduleOf(modules, 'src/ui/Card.tsx'),
      '别的目录里的样式跟用到它类名的文件走'
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
  checkStyles()
  checkStyleImportChainSpeed()
  checkStyleImportCycleSpeed()
  checkTestFiles()
  checkTestFilePatterns()
  checkHubWeight()
  checkHubFiles()
  checkMajorityAnchor()
  checkSmallMerge()
  checkEdgeCases()
  await checkDepGraphShape()
  console.log('selftest-modules: 全部通过')
}

main().catch((err) => {
  console.error('selftest-modules 失败:', err)
  process.exit(1)
})
