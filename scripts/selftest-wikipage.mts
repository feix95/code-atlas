// Wiki 单页全链路原型自测:npm run test:wikipage
// 用替身模型把「证据装配 -> 分段笔记 -> 分节生成 -> 拼装」跑全:
// 钉死分档与切段、覆盖校验、账本缓存命中、白名单校验触发重写、成品结构完整。
import assert from 'node:assert/strict'
import { buildWikiPlan } from '../src/wiki/wikiPlan.ts'
import type { WikiPlanFileInput, WikiPlanInput } from '../src/wiki/wikiPlanTypes.ts'
import type { FileFact } from '../src/depgraph/factCache.ts'
import { buildPageEvidence } from '../src/wiki/wikiEvidence.ts'
import { WikiNoteLedger } from '../src/wiki/wikiNotes.ts'
import { balanceInlineCode } from '../src/wiki/wikiPageCheck.ts'
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

  // 五、段内符号数上限:12 个符号的文件必须切成至少 2 段,每段符号不超过 10
  const gammaLines: string[] = []
  const gammaRanges: { name: string; kind: 'function'; startLine: number; endLine: number }[] = []
  for (let i = 1; i <= 12; i++) {
    gammaLines.push(`export function g${i}(): number { return ${i} }`)
    gammaLines.push('')
    gammaRanges.push({
      name: `g${i}`,
      kind: 'function',
      startLine: gammaLines.length - 1,
      endLine: gammaLines.length - 1
    })
  }
  const GAMMA = gammaLines.join('\n')
  const gammaPlan = buildWikiPlan({
    ...planInput,
    files: [
      ...planInput.files,
      planFile('src/gamma/gamma.ts', {
        exports: gammaRanges.map((r) => r.name),
        functions: gammaRanges.map((r) => r.name)
      })
    ]
  })
  const gammaPage = gammaPlan.pages.find(
    (p) => p.kind === 'leaf' && p.members.some((m) => m.path === 'src/gamma/gamma.ts')
  )!
  assert.ok(gammaPage, 'gamma 应自成一页')
  const gammaEvidence = await buildPageEvidence(
    { page: gammaPage, topicTitle: null, plan: gammaPlan, edges: [], contextSize: 8192 },
    {
      factOf: (p) =>
        p === 'src/gamma/gamma.ts'
          ? {
              sha256: 'g',
              structure: {
                languageId: 'typescript',
                imports: [],
                exports: gammaRanges.map((r) => r.name),
                functions: gammaRanges.map((r) => r.name),
                classes: [],
                interfaces: [],
                reactComponents: [],
                symbolRanges: gammaRanges
              }
            }
          : (FACTS.get(p) ?? null),
      readFile: async (p) => (p === 'src/gamma/gamma.ts' ? GAMMA : (CONTENTS.get(p) ?? null))
    }
  )
  const gammaFile = gammaEvidence.files.find((f) => f.path === 'src/gamma/gamma.ts')!
  assert.ok(
    gammaFile.segments.length >= 2,
    `12 符号应切成至少 2 段,实际 ${gammaFile.segments.length}`
  )
  for (const seg of gammaFile.segments) {
    const inside = gammaRanges.filter(
      (r) => r.startLine >= seg.startLine && r.endLine <= seg.endLine
    ).length
    assert.ok(inside <= 8, `单段符号数应不超过 8,实际 ${inside}`)
  }

  // 六、职责填句的证据必须包含后段摘要:捕获职责调用的提示词,断言含第 12 个符号名
  let dutiesPrompt = ''
  const spyBase = makeCompleter().complete
  const spy: WikiCompleter = async (system, user) => {
    if (user.includes('一句话职责')) dutiesPrompt = user
    return spyBase(system, user)
  }
  await runWikiPage(
    { page: gammaPage, topicTitle: null, plan: gammaPlan, edges: [], contextSize: 8192 },
    {
      factOf: (p) =>
        p === 'src/gamma/gamma.ts'
          ? {
              sha256: 'g',
              structure: {
                languageId: 'typescript',
                imports: [],
                exports: gammaRanges.map((r) => r.name),
                functions: gammaRanges.map((r) => r.name),
                classes: [],
                interfaces: [],
                reactComponents: [],
                symbolRanges: gammaRanges
              }
            }
          : (FACTS.get(p) ?? null),
      readFile: async (p) => (p === 'src/gamma/gamma.ts' ? GAMMA : (CONTENTS.get(p) ?? null)),
      complete: spy,
      modelId: 'fake-model',
      ledger: new WikiNoteLedger(),
      now: () => new Date('2026-11-03T00:00:00Z')
    }
  )
  assert.ok(dutiesPrompt.includes('g12'), '职责证据应包含最后一段的符号,不只首段')

  // 七、总述违规走兜底、行内代码配平
  const introBase = makeCompleter().complete
  const badIntro: WikiCompleter = async (system, user) => {
    if (system.includes('产品说明')) {
      return '这里由 `GhostThing` 统筹一切,解决所有问题,谁都会用到它。'
    }
    if (user.includes('本节标题') && user.includes('结构与协作')) {
      return '引用 `alpha.ts 还引用了 `beta.ts`，结构清楚。'
    }
    return introBase(system, user)
  }
  const cleaned = await runWikiPage(
    { page, topicTitle: null, plan, edges: planInput.edges, contextSize: 8192 },
    {
      factOf: (p: string) => FACTS.get(p) ?? null,
      readFile: async (p: string) => CONTENTS.get(p) ?? null,
      complete: badIntro,
      modelId: 'fake-model',
      ledger: new WikiNoteLedger(),
      now: () => new Date('2026-11-03T00:00:00Z')
    }
  )
  const introLine = cleaned.markdown.split('\n')[2] ?? ''
  assert.ok(!introLine.includes('GhostThing'), '违规总述应被兜底替换')
  assert.equal(cleaned.stats.introSource, 'fallback', '违规总述应记录为兜底来源')
  assert.ok(introLine.includes('alphaRun'), '兜底总述应挑点名核心导出符号的句子')
  let inFence = false
  for (const line of cleaned.markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    assert.equal((line.match(/`/g) ?? []).length % 2, 0, `行内代码应配平:${line}`)
  }

  // 八、整段反复失败时按符号拆分升级:长段返回废文本,单符号段合规,最终覆盖应全
  const deltaLines: string[] = ["import { x } from './x.ts'", '']
  const mkFn = (name: string): void => {
    deltaLines.push(`export function ${name}(): number {`)
    for (let i = 0; i < 18; i++) deltaLines.push(`  // ${name} 内部第 ${i} 行`)
    deltaLines.push('}')
    deltaLines.push('')
  }
  mkFn('deltaA')
  mkFn('deltaB')
  const DELTA = deltaLines.join('\n')
  const deltaRanges = [
    { name: 'deltaA', kind: 'function' as const, startLine: 3, endLine: 22 },
    { name: 'deltaB', kind: 'function' as const, startLine: 24, endLine: 43 }
  ]
  const deltaPlan = buildWikiPlan({
    ...planInput,
    files: [
      planFile('src/delta/delta.ts', {
        exports: ['deltaA', 'deltaB'],
        functions: ['deltaA', 'deltaB']
      })
    ],
    edges: []
  })
  const deltaPage = deltaPlan.pages.find((p) => p.kind === 'leaf')!
  const deltaBase = makeCompleter().complete
  const deltaCompleter: WikiCompleter = async (system, user, maxTokens) => {
    if (system.includes('代码阅读员')) {
      const range = /第 (\d+)-(\d+) 行/.exec(user)
      const from = range ? Number(range[1]) : 1
      const to = range ? Number(range[2]) : 9999
      if (to - from > 30) return '这不是 JSON,是一段废话'
      const names = deltaRanges
        .filter((r) => r.startLine >= from && r.endLine <= to)
        .map((r) => r.name)
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
    if (user.includes('本节标题') && user.includes('职责与定位')) {
      return '## 职责与定位\n本页由 `deltaA` 与 `deltaB` 构成。'
    }
    return deltaBase(system, user, maxTokens)
  }
  const deltaResult = await runWikiPage(
    { page: deltaPage, topicTitle: null, plan: deltaPlan, edges: [], contextSize: 8192 },
    {
      factOf: (p) =>
        p === 'src/delta/delta.ts'
          ? {
              sha256: 'd',
              structure: {
                languageId: 'typescript',
                imports: ['./x.ts'],
                exports: ['deltaA', 'deltaB'],
                functions: ['deltaA', 'deltaB'],
                classes: [],
                interfaces: [],
                reactComponents: [],
                symbolRanges: deltaRanges
              }
            }
          : null,
      readFile: async (p) => (p === 'src/delta/delta.ts' ? DELTA : null),
      complete: deltaCompleter,
      modelId: 'fake-model',
      ledger: new WikiNoteLedger(),
      now: () => new Date('2026-11-03T00:00:00Z')
    }
  )
  assert.equal(deltaResult.stats.symbolsCovered, 2, '拆分升级后两符号应全覆盖')
  assert.equal(deltaResult.stats.degradedNotes, 0, '拆分升级成功时不应有降级笔记')
  assert.ok(deltaResult.stats.retries >= 2, '拆分升级应计入重试')
  assert.equal(
    (deltaResult.markdown.match(/## 职责与定位/g) ?? []).length,
    1,
    '正文里重复的节标题应被剥掉'
  )

  // 九、嵌套符号折叠进父符号计覆盖:只记父符号也算全覆盖
  const epsContent = Array.from({ length: 30 }, (_, i) => `// eps 第 ${i + 1} 行`).join('\n')
  const epsRanges = [
    { name: 'outerFn', kind: 'function' as const, startLine: 1, endLine: 30 },
    { name: 'innerFn', kind: 'function' as const, startLine: 10, endLine: 15 }
  ]
  const epsPlan = buildWikiPlan({
    ...planInput,
    files: [
      planFile('src/eps/eps.ts', { exports: ['outerFn'], functions: ['outerFn', 'innerFn'] })
    ],
    edges: []
  })
  const epsPage = epsPlan.pages.find((p) => p.kind === 'leaf')!
  const epsCompleter: WikiCompleter = async (system, user, maxTokens) => {
    if (system.includes('代码阅读员')) {
      return JSON.stringify({
        symbols: [
          {
            name: 'outerFn',
            role: '外层函数,内部含 innerFn',
            deps: [],
            sideEffects: '无',
            crossRefs: []
          }
        ],
        summary: '本段讲 outerFn'
      })
    }
    return deltaBase(system, user, maxTokens)
  }
  const epsResult = await runWikiPage(
    { page: epsPage, topicTitle: null, plan: epsPlan, edges: [], contextSize: 8192 },
    {
      factOf: () => ({
        sha256: 'e',
        structure: {
          languageId: 'typescript',
          imports: [],
          exports: ['outerFn'],
          functions: ['outerFn', 'innerFn'],
          classes: [],
          interfaces: [],
          reactComponents: [],
          symbolRanges: epsRanges
        }
      }),
      readFile: async () => epsContent,
      complete: epsCompleter,
      modelId: 'fake-model',
      ledger: new WikiNoteLedger(),
      now: () => new Date('2026-11-03T00:00:00Z')
    }
  )
  assert.equal(epsResult.stats.symbolsTotal, 1, '嵌套符号不应单独计入覆盖总数')
  assert.deepEqual(epsResult.stats.coverageGaps, [], '父符号已记时嵌套符号不算缺口')

  // 十、白名单对目录放行:成员所在目录可提及,不存在的目录仍拦
  const { checkWhitelist } = await import('../src/wiki/wikiPageCheck.ts')
  const miniEvidence = {
    pageId: 'p',
    pageTitle: 't',
    topicTitle: null,
    files: [
      {
        path: 'src/ai/wikiPrompt.ts',
        role: 'primary' as const,
        tier: 'full' as const,
        contentHash: 'x',
        sizeBytes: 1,
        languageId: 'typescript',
        structure: null,
        symbolRanges: [],
        segments: [],
        dataFacts: null,
        evidenceNote: null
      }
    ],
    internalEdges: [],
    externalNames: [],
    budget: {
      contextSize: 8192,
      segmentTokenCap: 5000,
      filesTotal: 1,
      filesReadable: 1,
      segmentsTotal: 0,
      estNoteCalls: 0,
      estInputTokens: 0,
      decisions: []
    }
  }
  assert.deepEqual(
    checkWhitelist('代码位于 `src/ai/` 目录下。', miniEvidence, new Set(['src/ai/wikiPrompt.ts'])),
    [],
    '成员所在目录应放行'
  )
  assert.ok(
    checkWhitelist('代码位于 `src/zz/` 目录下。', miniEvidence, new Set(['src/ai/wikiPrompt.ts']))
      .length > 0,
    '不存在的目录仍应拦下'
  )

  // 十一、拆分部分失败:失败符号不算覆盖、不入缓存,复跑必须重试它
  const zetaLines: string[] = ["import { x } from './x.ts'", '']
  const mkZeta = (name: string): void => {
    zetaLines.push(`export function ${name}(): number {`)
    for (let i = 0; i < 18; i++) zetaLines.push(`  // ${name} 内部第 ${i} 行`)
    zetaLines.push('}')
    zetaLines.push('')
  }
  mkZeta('zetaA')
  mkZeta('zetaB')
  const zetaRanges = [
    { name: 'zetaA', kind: 'function' as const, startLine: 3, endLine: 22 },
    { name: 'zetaB', kind: 'function' as const, startLine: 24, endLine: 43 }
  ]
  const zetaPlan = buildWikiPlan({
    ...planInput,
    files: [
      planFile('src/zeta/zeta.ts', {
        exports: ['zetaA', 'zetaB'],
        functions: ['zetaA', 'zetaB']
      })
    ],
    edges: []
  })
  const zetaPage = zetaPlan.pages.find((p) => p.kind === 'leaf')!
  const zetaCompleter: WikiCompleter = async (system, user, maxTokens) => {
    if (system.includes('代码阅读员')) {
      if (user.includes('主体符号 zetaB')) return 'garbage,不是 JSON'
      const range = /第 (\d+)-(\d+) 行/.exec(user)
      const from = range ? Number(range[1]) : 1
      const to = range ? Number(range[2]) : 9999
      if (to - from > 30) return 'garbage,不是 JSON'
      const names = zetaRanges
        .filter((r) => r.startLine >= from && r.endLine <= to)
        .map((r) => r.name)
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
    return deltaBase(system, user, maxTokens)
  }
  const zetaDeps = {
    factOf: () => ({
      sha256: 'z',
      structure: {
        languageId: 'typescript',
        imports: ['./x.ts'],
        exports: ['zetaA', 'zetaB'],
        functions: ['zetaA', 'zetaB'],
        classes: [],
        interfaces: [],
        reactComponents: [],
        symbolRanges: zetaRanges
      }
    }),
    readFile: async () => zetaLines.join('\n'),
    complete: zetaCompleter,
    modelId: 'fake-model',
    ledger: new WikiNoteLedger(),
    now: () => new Date('2026-11-03T00:00:00Z')
  }
  const zetaRun1 = await runWikiPage(
    { page: zetaPage, topicTitle: null, plan: zetaPlan, edges: [], contextSize: 8192 },
    zetaDeps
  )
  assert.equal(zetaRun1.stats.symbolsCovered, 1, '失败符号 zetaB 不应算覆盖')
  assert.ok(
    zetaRun1.stats.coverageGaps.some((g) => g.includes('zetaB')),
    'zetaB 应如实出现在覆盖缺口里'
  )
  assert.ok(zetaRun1.noteRawFailures.length >= 1, '失败原始输出应留档')
  const zetaRun2 = await runWikiPage(
    { page: zetaPage, topicTitle: null, plan: zetaPlan, edges: [], contextSize: 8192 },
    zetaDeps
  )
  assert.ok(zetaRun2.stats.noteCalls >= 1, '部分失败的段不应被缓存,复跑必须重试失败符号')
  assert.ok(
    zetaRun2.stats.coverageGaps.some((g) => g.includes('zetaB')),
    '复跑后 zetaB 仍应如实在缺口里'
  )

  // 十二、非导出符号缺口也补记:整段笔记漏记 etaB 时,单符号补记应把它补上
  const etaLines: string[] = ["import { x } from './x.ts'", '']
  const etaRanges: { name: string; kind: 'function'; startLine: number; endLine: number }[] = []
  for (const name of ['etaA', 'etaB', 'etaC']) {
    const start = etaLines.length + 1
    etaLines.push(`export function ${name}(): number {`)
    for (let i = 0; i < 6; i++) etaLines.push(`  // ${name} 内部`)
    etaLines.push('}')
    etaLines.push('')
    etaRanges.push({ name, kind: 'function', startLine: start, endLine: start + 7 })
  }
  const etaPlan = buildWikiPlan({
    ...planInput,
    files: [
      planFile('src/eta/eta.ts', {
        exports: ['etaA'],
        functions: ['etaA', 'etaB', 'etaC']
      })
    ],
    edges: []
  })
  const etaPage = etaPlan.pages.find((p) => p.kind === 'leaf')!
  const etaCompleter: WikiCompleter = async (system, user, maxTokens) => {
    if (system.includes('代码阅读员')) {
      const only = /\(主体符号 (\w+)\)/.exec(user)
      const names = only ? [only[1]!] : ['etaA', 'etaC']
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
    return deltaBase(system, user, maxTokens)
  }
  const etaResult = await runWikiPage(
    { page: etaPage, topicTitle: null, plan: etaPlan, edges: [], contextSize: 8192 },
    {
      factOf: () => ({
        sha256: 't',
        structure: {
          languageId: 'typescript',
          imports: ['./x.ts'],
          exports: ['etaA'],
          functions: ['etaA', 'etaB', 'etaC'],
          classes: [],
          interfaces: [],
          reactComponents: [],
          symbolRanges: etaRanges
        }
      }),
      readFile: async () => etaLines.join('\n'),
      complete: etaCompleter,
      modelId: 'fake-model',
      ledger: new WikiNoteLedger(),
      now: () => new Date('2026-11-03T00:00:00Z')
    }
  )
  assert.equal(etaResult.stats.symbolsTotal, 3, 'eta 页应有 3 个顶层符号')
  assert.equal(etaResult.stats.symbolsCovered, 3, '漏记的非导出符号 etaB 应被补记补上')
  assert.deepEqual(etaResult.stats.coverageGaps, [], '补记后不应有缺口')

  // 十三、符号之间只有空行时,段文本必须与原文逐行对齐,子段要切到正确的代码行
  const thetaLines = [
    "import { x } from './x.ts'",
    '',
    'export function thetaA(): number {',
    '  return 1',
    '}',
    '',
    '',
    'export function thetaB(): number {',
    '  return 2',
    '}',
    '',
    'export function thetaC(): number {',
    '  return 3',
    '}'
  ]
  const thetaRanges = [
    { name: 'thetaA', kind: 'function' as const, startLine: 3, endLine: 5 },
    { name: 'thetaB', kind: 'function' as const, startLine: 8, endLine: 10 },
    { name: 'thetaC', kind: 'function' as const, startLine: 12, endLine: 14 }
  ]
  const thetaStructure = {
    languageId: 'typescript',
    imports: ['./x.ts'],
    exports: ['thetaA', 'thetaB', 'thetaC'],
    functions: ['thetaA', 'thetaB', 'thetaC'],
    classes: [],
    interfaces: [],
    reactComponents: [],
    symbolRanges: thetaRanges
  }
  const thetaPlan = buildWikiPlan({
    ...planInput,
    files: [
      planFile('src/theta/theta.ts', {
        exports: ['thetaA', 'thetaB', 'thetaC'],
        functions: ['thetaA', 'thetaB', 'thetaC']
      })
    ],
    edges: []
  })
  const thetaPage = thetaPlan.pages.find((p) => p.kind === 'leaf')!
  const thetaEvidence = await buildPageEvidence(
    { page: thetaPage, topicTitle: null, plan: thetaPlan, edges: [], contextSize: 8192 },
    {
      factOf: () => ({ sha256: 'h', structure: thetaStructure }),
      readFile: async () => thetaLines.join('\n')
    }
  )
  const thetaFile = thetaEvidence.files[0]!
  assert.equal(thetaFile.segments.length, 1, 'theta 应合并为一段')
  assert.equal(
    thetaFile.segments[0]!.text,
    thetaLines.join('\n'),
    '段文本必须等于原文整段切片,空行间隙不许丢'
  )
  let thetaBCode = ''
  let thetaFirstUser = ''
  const thetaCompleter: WikiCompleter = async (system, user, maxTokens) => {
    if (system.includes('代码阅读员')) {
      if (thetaFirstUser === '') thetaFirstUser = user
      const only = /\(主体符号 (\w+)\)/.exec(user)
      if (!only) return 'garbage,不是 JSON'
      if (only[1] === 'thetaB') thetaBCode = user.split('代码:\n')[1] ?? ''
      return JSON.stringify({
        symbols: [
          { name: only[1], role: `${only[1]} 的作用`, deps: [], sideEffects: '无', crossRefs: [] }
        ],
        summary: `本段讲 ${only[1]}`
      })
    }
    return deltaBase(system, user, maxTokens)
  }
  const thetaResult = await runWikiPage(
    { page: thetaPage, topicTitle: null, plan: thetaPlan, edges: [], contextSize: 8192 },
    {
      factOf: () => ({ sha256: 'h', structure: thetaStructure }),
      readFile: async () => thetaLines.join('\n'),
      complete: thetaCompleter,
      modelId: 'fake-model',
      ledger: new WikiNoteLedger(),
      now: () => new Date('2026-11-03T00:00:00Z')
    }
  )
  assert.equal(thetaResult.stats.symbolsCovered, 3, 'theta 三个符号应全覆盖')
  assert.ok(
    thetaBCode.startsWith('8: export function thetaB(): number {'),
    'thetaB 子段首行必须是它自己的声明行(带正确行号)'
  )
  assert.ok(!thetaBCode.includes('return 1'), 'thetaB 子段不应混进 thetaA 的代码')
  assert.ok(
    thetaFirstUser.includes('本段要写记录的符号只有') && thetaFirstUser.includes('thetaB'),
    '笔记提示词必须明确列出本段目标符号'
  )

  // 十五、行内代码修复:粘连片段拆引号保留文字,未闭合的代码片段补右引号,正常片段不动
  const glued = balanceInlineCode(
    '`src/ai/engineInstaller.ts不仅依赖共享模块，还直接调用 `enginePackage` 的功能'
  )
  assert.ok(!glued.includes('`'), '粘连片段应拆掉全部反引号,只留文字')
  assert.ok(glued.includes('engineInstaller.ts不仅依赖'), '粘连修复不应吞掉正文')
  assert.equal(balanceInlineCode('调用 `alphaRun'), '调用 `alphaRun`', '未闭合代码片段应补右引号')
  assert.equal(
    balanceInlineCode('调用 `alphaRun` 完成'),
    '调用 `alphaRun` 完成',
    '正常片段不应被改动'
  )
  // 带已知名称时,粘连片段应把真名重新包上反引号,而不是整段拆成纯文字
  assert.equal(
    balanceInlineCode(
      '`src/shared/engineCatalog.ts前者提供校验和解压能力`',
      new Set(['src/shared/engineCatalog.ts'])
    ),
    '`src/shared/engineCatalog.ts`前者提供校验和解压能力',
    '已知路径开头的粘连应还原路径的反引号'
  )
  assert.equal(
    balanceInlineCode(
      '引用了 `src/ai/engineInstaller.tssrc/shared/engineCatalog.ts 以及其他模块`',
      new Set(['src/ai/engineInstaller.ts', 'src/shared/engineCatalog.ts'])
    ),
    '引用了 `src/ai/engineInstaller.ts`、`src/shared/engineCatalog.ts` 以及其他模块',
    '两个已知路径直接相连时应各包反引号并补顿号'
  )

  // 十四、子段笔记写错符号:能解析也不算成功,不入缓存,复跑必须重试
  const iotaLines: string[] = ["import { x } from './x.ts'", '']
  const mkIota = (name: string): void => {
    iotaLines.push(`export function ${name}(): number {`)
    for (let i = 0; i < 18; i++) iotaLines.push(`  // ${name} 内部第 ${i} 行`)
    iotaLines.push('}')
    iotaLines.push('')
  }
  mkIota('iotaA')
  mkIota('iotaB')
  const iotaRanges = [
    { name: 'iotaA', kind: 'function' as const, startLine: 3, endLine: 22 },
    { name: 'iotaB', kind: 'function' as const, startLine: 24, endLine: 43 }
  ]
  const iotaPlan = buildWikiPlan({
    ...planInput,
    files: [
      planFile('src/iota/iota.ts', {
        exports: ['iotaA', 'iotaB'],
        functions: ['iotaA', 'iotaB']
      })
    ],
    edges: []
  })
  const iotaPage = iotaPlan.pages.find((p) => p.kind === 'leaf')!
  const iotaCompleter: WikiCompleter = async (system, user, maxTokens) => {
    if (system.includes('代码阅读员')) {
      const range = /第 (\d+)-(\d+) 行/.exec(user)
      const from = range ? Number(range[1]) : 1
      const to = range ? Number(range[2]) : 9999
      if (to - from > 30) return 'garbage,不是 JSON'
      // 不管问哪个符号,都只回 iotaB 的笔记:iotaA 的子段属于写错符号
      return JSON.stringify({
        symbols: [
          { name: 'iotaB', role: 'iotaB 的作用', deps: [], sideEffects: '无', crossRefs: [] }
        ],
        summary: '本段讲 iotaB'
      })
    }
    return deltaBase(system, user, maxTokens)
  }
  const iotaDeps = {
    factOf: () => ({
      sha256: 'i',
      structure: {
        languageId: 'typescript',
        imports: ['./x.ts'],
        exports: ['iotaA', 'iotaB'],
        functions: ['iotaA', 'iotaB'],
        classes: [],
        interfaces: [],
        reactComponents: [],
        symbolRanges: iotaRanges
      }
    }),
    readFile: async () => iotaLines.join('\n'),
    complete: iotaCompleter,
    modelId: 'fake-model',
    ledger: new WikiNoteLedger(),
    now: () => new Date('2026-11-03T00:00:00Z')
  }
  const iotaRun1 = await runWikiPage(
    { page: iotaPage, topicTitle: null, plan: iotaPlan, edges: [], contextSize: 8192 },
    iotaDeps
  )
  assert.equal(iotaRun1.stats.symbolsCovered, 1, '写错符号的笔记不应让 iotaA 算覆盖')
  assert.ok(
    iotaRun1.stats.coverageGaps.some((g) => g.includes('iotaA')),
    'iotaA 应如实留在缺口里'
  )
  assert.ok(
    iotaRun1.noteRawFailures.some((f) => f.reason.includes('未包含目标符号')),
    '写错符号应以「未包含目标符号」留档'
  )
  const iotaRun2 = await runWikiPage(
    { page: iotaPage, topicTitle: null, plan: iotaPlan, edges: [], contextSize: 8192 },
    iotaDeps
  )
  assert.ok(iotaRun2.stats.noteCalls >= 1, '写错符号的子段不应入缓存,复跑必须重试')

  // 十六、节正文漏写右反引号把真实路径与中文粘连时,修复后不应整节判校验失败
  const kappaLines = [
    "import { x } from './x.ts'",
    '',
    'export function kappaRun(): number {',
    '  return 1',
    '}'
  ]
  const kappaRanges = [{ name: 'kappaRun', kind: 'function' as const, startLine: 3, endLine: 5 }]
  const kappaPlan = buildWikiPlan({
    ...planInput,
    files: [planFile('src/kappa/kappa.ts', { exports: ['kappaRun'], functions: ['kappaRun'] })],
    edges: []
  })
  const kappaPage = kappaPlan.pages.find((p) => p.kind === 'leaf')!
  const kappaCompleter: WikiCompleter = async (system, user, maxTokens) => {
    if (system.includes('代码阅读员')) {
      return JSON.stringify({
        symbols: [
          { name: 'kappaRun', role: '启动入口', deps: [], sideEffects: '无', crossRefs: [] }
        ],
        summary: '本段讲 kappaRun'
      })
    }
    if (system.includes('产品说明')) return '本页讲 `kappaRun` 的职责。'
    if (system.includes('技术文档作者')) {
      return '`src/kappa/kappa.ts不仅导出核心函数，还直接调用 `kappaRun` 完成启动。'
    }
    return deltaBase(system, user, maxTokens)
  }
  const kappaResult = await runWikiPage(
    { page: kappaPage, topicTitle: null, plan: kappaPlan, edges: [], contextSize: 8192 },
    {
      factOf: () => ({
        sha256: 'k',
        structure: {
          languageId: 'typescript',
          imports: ['./x.ts'],
          exports: ['kappaRun'],
          functions: ['kappaRun'],
          classes: [],
          interfaces: [],
          reactComponents: [],
          symbolRanges: kappaRanges
        }
      }),
      readFile: async () => kappaLines.join('\n'),
      complete: kappaCompleter,
      modelId: 'fake-model',
      ledger: new WikiNoteLedger(),
      now: () => new Date('2026-11-03T00:00:00Z')
    }
  )
  assert.deepEqual(kappaResult.stats.checkFailedSections, [], '反引号粘连经修复后不应判节校验失败')
  assert.ok(
    kappaResult.markdown.includes('`src/kappa/kappa.ts`不仅导出核心函数'),
    '修复后路径应重新包上反引号,正文留在外面'
  )

  console.log('✅ Wiki 单页全链路原型自测全部通过')
}

export {}
