// Wiki 第二版生成任务自测:npm run test:wikijob2
// 用替身模型跑完整轮:记账升版、规划落盘、叶子页生成、未变跳过、legacy 全量后清退。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWikiJobV2 } from '../src/wiki/wikiJobV2.ts'
import { buildWikiPlan } from '../src/wiki/wikiPlan.ts'
import type { WikiPlanFileInput, WikiPlanInput } from '../src/wiki/wikiPlanTypes.ts'
import type { WikiCompleter } from '../src/wiki/wikiReadTypes.ts'
import {
  createWikiState,
  languageDir,
  writeWikiState,
  type WikiState
} from '../src/wiki/wikiStore.ts'

const LANG = 'zh-CN'
const root = await fs.mkdtemp(join(tmpdir(), 'codeatlas-wikijob2-'))
try {
  const projectDir = join(root, 'wiki-proj')
  await fs.mkdir(projectDir, { recursive: true })

  const contents = new Map<string, string>([
    [
      'src/alpha/alpha.ts',
      [
        "import { x } from './x.ts'",
        '',
        'export function alphaRun(): number {',
        '  return 1',
        '}'
      ].join('\n')
    ],
    [
      'src/beta/beta.ts',
      [
        "import { y } from './y.ts'",
        '',
        'export function betaRun(): number {',
        '  return 2',
        '}'
      ].join('\n')
    ]
  ])
  const rangesOf = (path: string) =>
    path.includes('alpha')
      ? [{ name: 'alphaRun', kind: 'function' as const, startLine: 3, endLine: 5 }]
      : [{ name: 'betaRun', kind: 'function' as const, startLine: 3, endLine: 5 }]
  const deps = {
    factOf: (path: string) => {
      const content = contents.get(path)
      if (content === undefined) return null
      const ranges = rangesOf(path)
      return {
        sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
        structure: {
          languageId: 'typescript',
          imports: [],
          exports: ranges.map((r) => r.name),
          functions: ranges.map((r) => r.name),
          classes: [],
          interfaces: [],
          reactComponents: [],
          symbolRanges: ranges
        }
      }
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    complete: (async (system: string, user: string) => {
      if (system.includes('代码阅读员')) {
        const targetLine = /本段要写记录的符号只有:(.+)。/.exec(user)
        const names = targetLine ? targetLine[1]!.split('、') : []
        return JSON.stringify({
          symbols: names.map((name) => ({
            name,
            role: `${name} 的作用`,
            deps: [],
            sideEffects: '无',
            crossRefs: []
          })),
          summary: `本段讲 ${names.join(' 与 ') || '文件头'}`
        })
      }
      if (system.includes('技术文档作者')) return '本页介绍这块功能的职责与协作关系。'
      if (system.includes('产品说明')) return '本页是项目的一部分。'
      return '完成。'
    }) as WikiCompleter,
    now: () => '2026-11-04T00:00:00.000Z'
  }
  const planFile = (relPath: string, fn: string): WikiPlanFileInput => ({
    relPath,
    languageId: 'typescript',
    sizeBytes: 300,
    exports: [fn],
    functions: [fn],
    classes: [],
    reactComponents: [],
    inCount: 0,
    outCount: 0
  })
  const planInput: WikiPlanInput = {
    projectName: 'demo',
    files: [planFile('src/alpha/alpha.ts', 'alphaRun'), planFile('src/beta/beta.ts', 'betaRun')],
    edges: [],
    rootDocs: [],
    manifestPath: null,
    manifestScripts: []
  }
  const options = {
    projectRoot: '/repo/demo',
    projectName: 'demo',
    projectDir,
    language: LANG,
    model: 'fake-model',
    modelId: 'fake-model',
    contextSize: 8192,
    planInput
  }

  // 先种一份第一版记账加一页旧页文件,验证升版与清退
  const v1: WikiState = createWikiState('/repo/demo', projectDir)
  v1.languages[LANG] = {
    code: LANG,
    label: '旧标签',
    pages: {
      'm:old': {
        pageId: 'm:old',
        kind: 'module',
        file: '模块/旧页.md',
        inputHash: 'x',
        promptVersion: 4,
        model: 'fake',
        generatedAt: '2026-11-03T00:00:00.000Z',
        status: 'done',
        name: '旧页'
      }
    }
  }
  await writeWikiState(projectDir, v1)
  const legacyFile = join(languageDir(projectDir, LANG), '模块', '旧页.md')
  await fs.mkdir(join(languageDir(projectDir, LANG), '模块'), { recursive: true })
  await fs.writeFile(legacyFile, '# 旧页')

  // 第一轮:叶子生成后接着汇总父页(本夹具为 src 主题总览一页)
  const plan1 = buildWikiPlan(planInput)
  const parentCount1 = plan1.pages.filter((p) => p.kind !== 'leaf').length
  const run1 = await runWikiJobV2(options, deps)
  assert.equal(run1.status, 'done')
  assert.equal(run1.done, 1 + parentCount1, '第一轮应生成一页叶子(两文件按规划同页)与全部父页')
  assert.equal(run1.failed, 0)

  const stateRaw = JSON.parse(
    await fs.readFile(join(projectDir, '.codeatlas', 'state.json'), 'utf8')
  ) as {
    schema: number
    planRef: { version: number } | null
    languages: Record<
      string,
      { pages: Record<string, { status: string; file: string }>; legacy: Record<string, unknown> }
    >
  }
  assert.equal(stateRaw.schema, 2, '记账应已升为第二版')
  assert.ok(stateRaw.planRef !== null, '规划应已登记')
  const lang = stateRaw.languages[LANG]!
  const leafRecords = Object.values(lang.pages).filter((p) => p.status === 'done')
  assert.equal(leafRecords.length, 1 + parentCount1, '叶子与父页记账应为 done')
  assert.equal(Object.keys(lang.legacy).length, 0, '全量完成后 legacy 应清退')
  assert.equal(
    await fs.access(legacyFile).then(
      () => true,
      () => false
    ),
    false,
    'legacy 旧页文件应随清退删除'
  )
  await fs.access(join(projectDir, '.codeatlas', 'plan.json'))
  await fs.access(join(projectDir, '.codeatlas', 'ledger', 'wiki-note-ledger.json'))
  for (const record of leafRecords) {
    const pagePath = join(languageDir(projectDir, LANG), record.file)
    const markdown = await fs.readFile(pagePath, 'utf8')
    assert.ok(markdown.includes('#'), '生成页应有标题')
  }
  const index = await fs.readFile(join(languageDir(projectDir, LANG), 'README.md'), 'utf8')
  assert.ok(!index.includes('待生成'), '全量生成后目录页不应再有待生成页')

  // 第二轮:成员未变,两页都应跳过
  const run2 = await runWikiJobV2(options, deps)
  assert.equal(run2.skipped, 1 + parentCount1, '第二轮成员未变应全部跳过')
  assert.equal(run2.done, 0)

  // 单页生成:only 名单外的页一律不碰,名单内的页强制重写
  const leafId = buildWikiPlan(options.planInput).pages.find((p) => p.kind === 'leaf')!.id
  const runOnlyMiss = await runWikiJobV2(
    { ...options, force: true, onlyPageIds: new Set(['w:missing']) },
    deps
  )
  assert.equal(runOnlyMiss.processed, 0, 'only 名单为空时不应处理任何页')
  assert.equal(runOnlyMiss.done, 0)
  const runOnlyHit = await runWikiJobV2(
    { ...options, force: true, onlyPageIds: new Set([leafId]) },
    deps
  )
  assert.equal(runOnlyHit.done, 1, 'only 命中时应只生成选中的那一页')

  // 场景二:父页汇总。两块顶层目录各成一叶,根主题带一张总览页
  const projectDir2 = join(root, 'wiki-proj2')
  await fs.mkdir(projectDir2, { recursive: true })
  const contents2 = new Map<string, string>([
    ['alpha/alpha.ts', contents.get('src/alpha/alpha.ts')!],
    ['beta/beta.ts', contents.get('src/beta/beta.ts')!]
  ])
  const deps2 = {
    ...deps,
    factOf: (path: string) => {
      const content = contents2.get(path)
      if (content === undefined) return null
      const ranges = rangesOf(path)
      return {
        sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
        structure: {
          languageId: 'typescript',
          imports: [],
          exports: ranges.map((r) => r.name),
          functions: ranges.map((r) => r.name),
          classes: [],
          interfaces: [],
          reactComponents: [],
          symbolRanges: ranges
        }
      }
    },
    readFile: async (path: string) => contents2.get(path) ?? null,
    complete: (async (system: string, user: string, maxTokens: number) => {
      if (system.includes('总览作者')) {
        return '这一页汇总下属页面的职责与分工,方便读者先看整体再看细节。'
      }
      return deps.complete(system, user, maxTokens)
    }) as WikiCompleter
  }
  const planInput2: WikiPlanInput = {
    projectName: 'demo',
    files: [planFile('alpha/alpha.ts', 'alphaRun'), planFile('beta/beta.ts', 'betaRun')],
    edges: [],
    rootDocs: [],
    manifestPath: null,
    manifestScripts: []
  }
  const options2 = { ...options, projectDir: projectDir2, planInput: planInput2 }
  const plan2 = buildWikiPlan(planInput2)
  const leafCount2 = plan2.pages.filter((p) => p.kind === 'leaf').length
  const overview2 = plan2.pages.find((p) => p.kind === 'overview')
  assert.ok(overview2, '两块顶层主题应规划出总览页')
  const parentCount2 = plan2.pages.filter((p) => p.kind !== 'leaf').length

  const runB1 = await runWikiJobV2(options2, deps2)
  assert.equal(runB1.failed, 0)
  assert.equal(runB1.done, leafCount2 + parentCount2, '叶子与父页应一轮全生成')
  const state2 = JSON.parse(
    await fs.readFile(join(projectDir2, '.codeatlas', 'state.json'), 'utf8')
  ) as {
    languages: Record<
      string,
      { pages: Record<string, { status: string; file: string; inputHash?: string }> }
    >
  }
  const overviewRecord = state2.languages[LANG]!.pages[overview2.id]!
  assert.equal(overviewRecord.status, 'done', '总览页记账应为 done')
  assert.ok(overviewRecord.inputHash, '总览页应留下内容指纹')
  const overviewMarkdown = await fs.readFile(
    join(languageDir(projectDir2, LANG), overviewRecord.file),
    'utf8'
  )
  assert.ok(overviewMarkdown.includes('## 下属页面'), '总览页应有下属页面表')
  assert.ok(overviewMarkdown.includes('汇总下属页面'), '总览页应有模型写的总览段')

  const runB2 = await runWikiJobV2(options2, deps2)
  assert.equal(runB2.skipped, leafCount2 + parentCount2, '第二轮叶子与父页都应跳过')
  assert.equal(runB2.done, 0)

  // 指纹对不上时只有父页重写,叶子仍跳过
  const tampered = JSON.parse(
    await fs.readFile(join(projectDir2, '.codeatlas', 'state.json'), 'utf8')
  ) as typeof state2
  tampered.languages[LANG]!.pages[overview2.id]!.inputHash = 'tampered'
  await fs.writeFile(
    join(projectDir2, '.codeatlas', 'state.json'),
    JSON.stringify(tampered, null, 2)
  )
  const runB3 = await runWikiJobV2(options2, deps2)
  assert.equal(runB3.done, 1, '指纹变化时应只重写父页')
  assert.equal(runB3.skipped, leafCount2 + parentCount2 - 1, '指纹变化时其余叶子与父页应继续跳过')

  console.log('✅ Wiki 第二版生成任务自测全部通过')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
