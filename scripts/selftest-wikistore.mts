// Wiki 记账第二版自测:npm run test:wikistore
// 钉死双版本读取、第一版升版转 legacy、规划文件读写、新路径安全校验与主题树路径分配。
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildWikiPlan } from '../src/wiki/wikiPlan.ts'
import type { WikiPlanFileInput, WikiPlanInput } from '../src/wiki/wikiPlanTypes.ts'
import {
  allocatePlanFiles,
  isSafePageFileV2,
  readWikiPlanFile,
  writeWikiPlanFile
} from '../src/wiki/wikiPlanStore.ts'
import {
  createWikiStateV2,
  readWikiStateAny,
  upgradeStateV1toV2,
  writeWikiStateV2
} from '../src/wiki/wikiStoreV2.ts'
import { createWikiState, writeWikiState, type WikiState } from '../src/wiki/wikiStore.ts'

const root = await fs.mkdtemp(join(tmpdir(), 'codeatlas-wikistore-'))
try {
  const projectDir = join(root, 'proj')
  await fs.mkdir(projectDir, { recursive: true })

  // 一、没有记账时报 missing
  assert.equal((await readWikiStateAny(projectDir)).status, 'missing')

  // 二、第一版记账经双版本读取仍认得,且能升版转 legacy
  const v1: WikiState = createWikiState('/repo/demo', projectDir)
  v1.languages['zh'] = {
    code: 'zh',
    label: '简体中文',
    pages: {
      'm:core': {
        pageId: 'm:core',
        kind: 'module',
        file: '模块/核心.md',
        inputHash: 'abc',
        promptVersion: 4,
        model: 'fake',
        generatedAt: '2026-11-03T00:00:00.000Z',
        status: 'done',
        name: '核心'
      }
    }
  }
  await writeWikiState(projectDir, v1)
  const readV1 = await readWikiStateAny(projectDir)
  assert.equal(readV1.status, 'ok')
  assert.equal(readV1.status === 'ok' && readV1.version, 1)
  const upgraded = upgradeStateV1toV2(v1)
  assert.equal(upgraded.schema, 2)
  assert.equal(upgraded.languages['zh']!.pages['m:core'], undefined, '升版后新页区应为空')
  assert.equal(
    upgraded.languages['zh']!.legacy['m:core']!.file,
    '模块/核心.md',
    '旧页应原样转入 legacy 区'
  )
  assert.equal(upgraded.languages['zh']!.origin, 'generated')
  assert.equal(upgraded.planRef, null)

  // 三、第二版记账写读往返,legacy 与新页并存不串
  const v2 = createWikiStateV2('/repo/demo', projectDir)
  v2.languages['zh'] = upgraded.languages['zh']!
  v2.planRef = { path: '.codeatlas/plan.json', version: 1 }
  v2.languages['zh']!.pages['p:leaf1'] = {
    pageId: 'p:leaf1',
    kind: 'leaf',
    file: '引擎/安装.md',
    name: '安装',
    nameSource: 'program',
    status: 'planned',
    model: '',
    generatedAt: '',
    members: [{ path: 'src/install.ts', role: 'primary', contentHash: null }],
    budgetNotes: []
  }
  await writeWikiStateV2(projectDir, v2)
  const readV2 = await readWikiStateAny(projectDir)
  assert.equal(readV2.status, 'ok')
  assert.equal(readV2.status === 'ok' && readV2.version, 2)
  if (readV2.status === 'ok' && readV2.version === 2) {
    assert.equal(readV2.state.languages['zh']!.legacy['m:core']!.name, '核心')
    assert.equal(readV2.state.languages['zh']!.pages['p:leaf1']!.status, 'planned')
    assert.equal(readV2.state.planRef?.version, 1)
  }

  // 四、新路径安全校验:嵌套可,越界与超长不可
  assert.ok(isSafePageFileV2('引擎/安装.md'))
  assert.ok(isSafePageFileV2('项目概述.md'))
  assert.ok(!isSafePageFileV2('../逃逸.md'))
  assert.ok(!isSafePageFileV2('主题/../逃逸.md'))
  assert.ok(!isSafePageFileV2('主题\\反斜杠.md'))
  assert.ok(!isSafePageFileV2('/绝对/路径.md'))
  assert.ok(!isSafePageFileV2('主题/不是md.txt'))
  assert.ok(!isSafePageFileV2(`${'长'.repeat(210)}.md`))

  // 五、规划文件写读往返与损坏判定
  const planFile = (relPath: string): WikiPlanFileInput => ({
    relPath,
    languageId: 'typescript',
    sizeBytes: 3000,
    exports: ['run'],
    functions: ['run'],
    classes: [],
    reactComponents: [],
    inCount: 0,
    outCount: 0
  })
  const mkInput = (files: WikiPlanFileInput[]): WikiPlanInput => ({
    projectName: 'demo',
    files,
    edges: [],
    rootDocs: [],
    manifestPath: null,
    manifestScripts: []
  })
  const plan = buildWikiPlan(
    mkInput([planFile('src/alpha/alpha.ts'), planFile('src/beta/beta.ts')])
  )
  assert.equal((await readWikiPlanFile(projectDir)).status, 'missing')
  await writeWikiPlanFile(projectDir, plan)
  const readPlan = await readWikiPlanFile(projectDir)
  assert.equal(readPlan.status, 'ok')
  if (readPlan.status === 'ok') assert.equal(readPlan.plan.pages.length, plan.pages.length)
  await fs.writeFile(join(projectDir, '.codeatlas', 'plan.json'), '{bad json', 'utf8')
  assert.equal((await readWikiPlanFile(projectDir)).status, 'damaged')

  // 六、路径分配:全部安全、互不撞名、根页在根下
  const files = allocatePlanFiles(plan)
  assert.equal(files.size, plan.pages.length)
  const seen = new Set<string>()
  for (const [pageId, file] of files) {
    assert.ok(isSafePageFileV2(file), `分配路径应安全:${file}`)
    assert.ok(!seen.has(file.toLowerCase()), `分配路径不应撞名:${file}`)
    seen.add(file.toLowerCase())
    void pageId
  }
  const rootPage = plan.pages.find((p) => p.kind === 'root')
  if (rootPage) {
    assert.ok(!files.get(rootPage.id)!.includes('/'), '根主题页应落在语种目录根')
  }

  // 七、超长路径:截短加哈希后仍安全且不撞名
  const longPlan = buildWikiPlan(mkInput([planFile(`src/${'a'.repeat(30)}/${'b'.repeat(30)}.ts`)]))
  const longFiles = allocatePlanFiles(longPlan)
  for (const file of longFiles.values()) {
    assert.ok(file.length <= 200, `超长分配仍应不超限:${file.length}`)
    assert.ok(isSafePageFileV2(file), `超长分配仍应安全:${file}`)
  }

  console.log('✅ Wiki 记账第二版自测全部通过')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
