// Wiki 单页全链路原型自测:npm run test:wikipage
// 用替身模型把「证据装配 -> 分段笔记 -> 分节生成 -> 拼装」跑全:
// 钉死分档与切段、覆盖校验、账本缓存命中、白名单校验触发重写、成品结构完整。
import assert from 'node:assert/strict'
import { buildWikiPlan } from '../src/wiki/wikiPlan.ts'
import type { WikiPlanFileInput, WikiPlanInput } from '../src/wiki/wikiPlanTypes.ts'
import type { FileFact } from '../src/depgraph/factCache.ts'
import { buildPageEvidence } from '../src/wiki/wikiEvidence.ts'
import { WikiNoteLedger } from '../src/wiki/wikiNotes.ts'
import { runWikiPage } from '../src/wiki/wikiPageRun.ts'
import type { WikiCompleter } from '../src/wiki/wikiReadTypes.ts'

const ALPHA = [
  "import { BetaStore } from './beta.ts'",
  '',
  'export function alphaRun(store: BetaStore): number {',
  '  const value = store.read()',
  '  return value + 1',
  '}',
  '',
  'function alphaHelper(): void {',
  '  // 内部辅助',
  '}'
].join('\n')
const BETA = [
  'export class BetaStore {',
  '  private value = 0',
  '  read(): number {',
  '    return this.value',
  '  }',
  '  write(next: number): void {',
  '    this.value = next',
  '  }',
  '}'
].join('\n')

const FACTS = new Map<string, FileFact>([
  [
    'src/core/alpha.ts',
    {
      sha256: 'a',
      structure: {
        languageId: 'typescript',
        imports: ['./beta.ts'],
        exports: ['alphaRun'],
        functions: ['alphaRun', 'alphaHelper'],
        classes: [],
        interfaces: [],
        reactComponents: [],
        symbolRanges: [
          { name: 'alphaRun', kind: 'function', startLine: 3, endLine: 6 },
          { name: 'alphaHelper', kind: 'function', startLine: 8, endLine: 10 }
        ]
      }
    }
  ],
  [
    'src/core/beta.ts',
    {
      sha256: 'b',
      structure: {
        languageId: 'typescript',
        imports: [],
        exports: ['BetaStore'],
        functions: [],
        classes: ['BetaStore'],
        interfaces: [],
        reactComponents: [],
        symbolRanges: [{ name: 'BetaStore', kind: 'class', startLine: 1, endLine: 9 }]
      }
    }
  ]
])
const CONTENTS = new Map([
  ['src/core/alpha.ts', ALPHA],
  ['src/core/beta.ts', BETA]
])

function planFile(relPath: string, opts: Partial<WikiPlanFileInput> = {}): WikiPlanFileInput {
  return {
    relPath,
    languageId: 'typescript',
    sizeBytes: 400,
    exports: [],
    functions: [],
    classes: [],
    reactComponents: [],
    inCount: 0,
    outCount: 0,
    ...opts
  }
}

const planInput: WikiPlanInput = {
  projectName: 'demo',
  files: [
    planFile('src/core/alpha.ts', {
      exports: ['alphaRun'],
      functions: ['alphaRun', 'alphaHelper'],
      outCount: 1
    }),
    planFile('src/core/beta.ts', { exports: ['BetaStore'], classes: ['BetaStore'], inCount: 1 })
  ],
  edges: [{ from: 'src/core/alpha.ts', to: 'src/core/beta.ts' }],
  rootDocs: [],
  manifestPath: null,
  manifestScripts: []
}
const plan = buildWikiPlan(planInput)
const page = plan.pages.find((p) => p.kind === 'leaf')!
assert.ok(page, '规划应产出叶子页')

/** 替身模型:按提示词类型返回合规内容;职责节首答故意写错名字,验证白名单重写 */
function makeCompleter(): { complete: WikiCompleter; state: { badOnce: boolean } } {
  const state = { badOnce: true }
  const complete: WikiCompleter = async (system, user) => {
    if (system.includes('代码阅读员')) {
      // 按本段行号范围,把落在段内的每个符号各记一条,和真实笔记的字段口径一致
      const range = /第 (\d+)-(\d+) 行/.exec(user)
      const from = range ? Number(range[1]) : 1
      const to = range ? Number(range[2]) : 9999
      const listed = [...user.matchAll(/(\w+)\((?:function|class|interface|method) (\d+)-(\d+)\)/g)]
        .filter((m) => Number(m[2]) >= from && Number(m[3]) <= to)
        .map((m) => m[1]!)
      const names = listed.length > 0 ? listed : ['BetaStore']
      return JSON.stringify({
        symbols: names.map((name) => ({
          name,
          role: `${name} 的作用`,
          deps: [],
          sideEffects: '无',
          crossRefs: []
        })),
        summary: `本段讲 ${names.join(' 与 ')}`
      })
    }
    if (user.includes('一句话职责')) {
      return JSON.stringify({
        duties: [
          { path: 'src/core/alpha.ts', duty: '负责运行主流程' },
          { path: 'src/core/beta.ts', duty: '负责保存数值' }
        ]
      })
    }
    if (system.includes('产品说明'))
      return '解决数值读写的问题,流程代码会用到它,没有它数值无处保存。'
    if (user.includes('本节标题') && user.includes('职责与定位') && state.badOnce) {
      state.badOnce = false
      return '本节由 `GhostThing` 主导,证据里其实没有这个名字。'
    }
    if (user.includes('本节标题') && user.includes('职责与定位')) {
      return '本页由 `alphaRun` 发起流程,数据保存在 `BetaStore` 中。'
    }
    if (user.includes('本节标题') && user.includes('结构与协作')) {
      return '`alpha.ts` 依赖 `beta.ts`,分工清楚。'
    }
    if (user.includes('本节标题')) return '`alphaRun` 对外提供运行入口,`BetaStore` 提供读写。'
    return '完成。'
  }
  return { complete, state }
}

{
  // 一、证据装配:两文件同为 full 档,按符号切段,预算账完整
  const evidence = await buildPageEvidence(
    { page, topicTitle: null, plan, edges: planInput.edges, contextSize: 8192 },
    { factOf: (p) => FACTS.get(p) ?? null, readFile: async (p) => CONTENTS.get(p) ?? null }
  )
  const alpha = evidence.files.find((f) => f.path === 'src/core/alpha.ts')!
  assert.equal(alpha.tier, 'full', '主角文件应为 full 档')
  assert.ok(
    alpha.segments.some((s) => s.startLine <= 3 && s.endLine >= 6 && s.text.includes('alphaRun')),
    '应有覆盖 alphaRun 声明行段的段'
  )
  assert.ok(evidence.budget.estNoteCalls >= 2, '预算账应预估笔记请求数')
  assert.equal(evidence.internalEdges.length, 1, '页内引用边应有 1 条')

  // 二、全链路:成品结构完整,覆盖全,白名单重写生效
  const { complete } = makeCompleter()
  const ledger = new WikiNoteLedger()
  const deps = {
    factOf: (p: string) => FACTS.get(p) ?? null,
    readFile: async (p: string) => CONTENTS.get(p) ?? null,
    complete,
    modelId: 'fake-model',
    ledger,
    now: () => new Date('2026-11-03T00:00:00Z')
  }
  const result = await runWikiPage(
    { page, topicTitle: null, plan, edges: planInput.edges, contextSize: 8192 },
    deps
  )
  assert.ok(result.markdown.startsWith('# '), '成品应以标题开头')
  assert.ok(result.markdown.includes('```mermaid'), '成品应含程序生成的依赖图')
  assert.ok(
    result.markdown.includes('| src/core/alpha.ts | primary | 负责运行主流程 |'),
    '职责表应由模型填句'
  )
  assert.ok(result.markdown.includes('> 出处:'), '每节应有程序标注的出处')
  assert.equal(result.stats.symbolsCovered, result.stats.symbolsTotal, '符号覆盖应全')
  assert.equal(result.stats.degradedNotes, 0, '替身合规时不应有降级笔记')
  assert.ok(result.stats.retries >= 1, '白名单违规应触发一次重写')
  assert.deepEqual(result.stats.checkFailedSections, [], '重写后各节应通过校验')
  assert.ok(!result.markdown.includes('GhostThing'), '违规名字不应留在成品里')

  // 三、账本缓存:同账本重跑,笔记零调用
  const again = await runWikiPage(
    { page, topicTitle: null, plan, edges: planInput.edges, contextSize: 8192 },
    deps
  )
  assert.equal(again.stats.noteCalls, 0, '账本命中时笔记不应再调模型')

  // 四、模型全挂:笔记降级兜底,页面仍产出且缺口如实记录
  const dead: WikiCompleter = async () => {
    throw new Error('模型不可用')
  }
  const fallen = await runWikiPage(
    { page, topicTitle: null, plan, edges: planInput.edges, contextSize: 8192 },
    { ...deps, complete: dead, ledger: new WikiNoteLedger() }
  )
  assert.ok(fallen.stats.degradedNotes > 0, '模型失败时应产生降级笔记')
  assert.ok(fallen.stats.coverageGaps.length > 0, '降级不算真覆盖,缺口应记录')
  assert.ok(fallen.markdown.includes('# '), '模型全挂时页面骨架仍应产出')

  console.log('✅ Wiki 单页全链路原型自测全部通过')
}

export {}
