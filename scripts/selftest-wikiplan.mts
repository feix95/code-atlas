// Wiki 主题树切分自测:npm run test:wikiplan(纯函数,不读盘不联网)
import assert from 'node:assert/strict'
import { buildWikiPlan } from '../src/wiki/wikiPlan.ts'
import type { WikiPlanFileInput, WikiPlanInput, WikiPlanPage } from '../src/wiki/wikiPlanTypes.ts'

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

function input(
  files: WikiPlanFileInput[],
  edges: [string, string][],
  extra: Partial<WikiPlanInput> = {}
): WikiPlanInput {
  return {
    projectName: 'demo',
    files,
    edges: edges.map(([from, to]) => ({ from, to })),
    rootDocs: [],
    manifestPath: null,
    manifestScripts: [],
    ...extra
  }
}

function leafPages(plan: ReturnType<typeof buildWikiPlan>): WikiPlanPage[] {
  return plan.pages.filter((p) => p.kind === 'leaf')
}

function primaryOwner(plan: ReturnType<typeof buildWikiPlan>): Map<string, string> {
  const owner = new Map<string, string>()
  for (const page of plan.pages) {
    for (const member of page.members) {
      if (member.role === 'primary') {
        assert.ok(!owner.has(member.path), `${member.path} 不能同时是两页的主角`)
        owner.set(member.path, page.id)
      }
    }
  }
  return owner
}

function roleOf(plan: ReturnType<typeof buildWikiPlan>, path: string): string | undefined {
  for (const page of plan.pages) {
    const member = page.members.find((m) => m.path === path)
    if (member) return member.role
  }
  return undefined
}

function chainEdges(prefix: string, names: string[]): [string, string][] {
  const edges: [string, string][] = []
  for (let i = 0; i + 1 < names.length; i++)
    edges.push([`${prefix}/${names[i]}`, `${prefix}/${names[i + 1]}`])
  return edges
}

function main(): void {
  // 一、目录过大按社区细切;小目录整页;结果可复现;代码文件归属唯一
  const bigA = ['a1.ts', 'a2.ts', 'a3.ts', 'a4.ts', 'a5.ts']
  const bigB = ['b1.ts', 'b2.ts', 'b3.ts', 'b4.ts', 'b5.ts']
  const files1 = [
    ...bigA.map((n) => file(`src/big/${n}`)),
    ...bigB.map((n) => file(`src/big/${n}`)),
    file('src/small/x.ts'),
    file('src/small/y.ts')
  ]
  const edges1: [string, string][] = [
    ...chainEdges('src/big', bigA),
    ...chainEdges('src/big', bigB),
    ['src/big/a1.ts', 'src/big/a3.ts'],
    ['src/big/b2.ts', 'src/big/b4.ts'],
    ['src/small/x.ts', 'src/small/y.ts']
  ]
  const plan1 = buildWikiPlan(input(files1, edges1))
  assert.equal(leafPages(plan1).length, 3, '大目录切两页 + 小目录一页')
  assert.equal(primaryOwner(plan1).size, 12, '12 个代码文件各有唯一归属')
  assert.deepEqual(
    JSON.parse(JSON.stringify(buildWikiPlan(input(files1, edges1)))),
    JSON.parse(JSON.stringify(plan1)),
    '同输入重复规划结果一致'
  )
  const bigTopicPages = leafPages(plan1).filter((p) => p.anchorDir === 'src/big')
  assert.equal(bigTopicPages.length, 2, 'src/big 下两页')
  assert.notEqual(bigTopicPages[0]!.title, bigTopicPages[1]!.title, '同目录多页标题不许重名')

  // 二、强内聚跨目录社区打破目录边界成一页
  const cross = ['src/x/p.ts', 'src/x/q.ts', 'src/y/r.ts', 'src/y/s.ts']
  const crossEdges: [string, string][] = []
  for (let i = 0; i < cross.length; i++)
    for (let j = i + 1; j < cross.length; j++) crossEdges.push([cross[i]!, cross[j]!])
  const plan2 = buildWikiPlan(
    input(
      cross.map((p) => file(p, { inCount: 3 })),
      crossEdges
    )
  )
  const crossPages = leafPages(plan2).filter((p) => p.basis.some((b) => b.includes('跨目录')))
  assert.equal(crossPages.length, 1, '跨目录社区成一页')
  assert.equal(crossPages[0]!.members.filter((m) => m.role === 'primary').length, 4, '四文件同页')

  // 三、角色:界面页的样式升配角,普通样式与自测挂附属,二进制资源不进页
  const files3 = [
    file('src/ui/App.tsx', { reactComponents: ['App'], exports: ['App'] }),
    file('src/ui/app.css', { languageId: '' }),
    file('src/core/run.ts', { exports: ['run'] }),
    file('src/core/util.css', { languageId: '' }),
    file('scripts/selftest-run.mts'),
    file('assets/logo.png', { languageId: '', sizeBytes: 5000 }),
    file('.husky/_/husky.sh', { languageId: '' })
  ]
  const plan3 = buildWikiPlan(
    input(files3, [
      ['src/ui/App.tsx', 'src/ui/app.css'],
      ['scripts/selftest-run.mts', 'src/core/run.ts']
    ])
  )
  assert.equal(roleOf(plan3, 'src/ui/app.css'), 'supporting', '被组件引用的样式升配角')
  assert.equal(roleOf(plan3, 'src/core/util.css'), 'attached', '无引用的样式作附属')
  assert.equal(roleOf(plan3, 'scripts/selftest-run.mts'), 'attached', '自测挂到被测文件所在页')
  assert.ok(
    plan3.unassigned.some((u) => u.path === 'assets/logo.png'),
    '二进制资源进未归属清单,不静默消失'
  )
  assert.ok(
    plan3.unassigned.some((u) => u.path === '.husky/_/husky.sh'),
    '隐藏目录的工具内部文件不进规划'
  )

  // 四、根主题提名:有依据才提名
  const plan4 = buildWikiPlan(
    input(
      [
        file('src/a.ts'),
        file('README.md', { languageId: '' }),
        file('package.json', { languageId: '' })
      ],
      [],
      {
        rootDocs: ['README.md'],
        manifestPath: 'package.json',
        manifestScripts: ['dev', 'build']
      }
    )
  )
  const rootTitles = plan4.pages.filter((p) => p.kind === 'root').map((p) => p.title)
  assert.deepEqual(rootTitles, ['项目概述', '快速开始', '构建与部署'], '根主题按信号提名')
  const plan4b = buildWikiPlan(input([file('src/a.ts')], []))
  assert.deepEqual(
    plan4b.pages.filter((p) => p.kind === 'root').map((p) => p.title),
    ['项目概述'],
    '无信号时只留项目概述,不硬凑'
  )

  // 五、超大文件拆不动时标记 oversized,不丢文件
  const plan5 = buildWikiPlan(
    input([file('src/huge/big.ts', { sizeBytes: 300_000, exports: ['big'] })], [])
  )
  assert.equal(leafPages(plan5).length, 1, '单文件成页')
  assert.equal(leafPages(plan5)[0]!.oversized, true, '超证据预算标记 oversized')

  // 六、主题树深度封顶 4 层
  const plan6 = buildWikiPlan(
    input(
      [file('a/b/c/d/e/f/deep.ts'), file('a/b/c/d/e/f/deep2.ts')],
      [['a/b/c/d/e/f/deep.ts', 'a/b/c/d/e/f/deep2.ts']]
    )
  )
  let maxDepth = 0
  const walk = (topics: typeof plan6.topics, depth: number): void => {
    for (const topic of topics) {
      maxDepth = Math.max(maxDepth, topic.dir === '' ? depth : topic.dir.split('/').length)
      walk(topic.children, depth + 1)
    }
  }
  walk(plan6.topics, 0)
  assert.ok(maxDepth <= 4, `主题目录最深 4 层,实际 ${maxDepth}`)
  assert.equal(primaryOwner(plan6).size, 2, '深层文件仍有归属')

  console.log('✅ Wiki 主题树切分自测全部通过')
  console.log(
    `   细切 ${leafPages(plan1).length} 页 · 跨目录 ${crossPages.length} 页 · 根主题 [${rootTitles.join(', ')}]`
  )
}

main()
