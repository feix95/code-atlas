// 骨架章提名:每个信号都要覆盖「有」和「没有」,没有信号就不提名。
import assert from 'node:assert/strict'
import { buildWikiPlan } from '../src/wiki/wikiPlan.ts'
import type { WikiPlan, WikiPlanFileInput, WikiPlanInput } from '../src/wiki/wikiPlanTypes.ts'
import { COMPONENT_CHAPTER_MIN } from '../src/wiki/wikiSkeleton.ts'

function file(relPath: string, opts: Partial<WikiPlanFileInput> = {}): WikiPlanFileInput {
  return {
    relPath,
    languageId:
      relPath.endsWith('.json') || relPath.endsWith('.yml') || relPath.endsWith('.md')
        ? ''
        : 'typescript',
    sizeBytes: 2000,
    exports: [],
    functions: [],
    classes: [],
    reactComponents: [],
    inCount: 0,
    outCount: 0,
    ...opts
  }
}

function plan(files: WikiPlanFileInput[], extra: Partial<WikiPlanInput> = {}): WikiPlan {
  return buildWikiPlan({
    projectName: 'demo',
    files,
    edges: [],
    rootDocs: extra.rootDocs ?? [],
    manifestPath: extra.manifestPath ?? null,
    manifestScripts: extra.manifestScripts ?? [],
    ...extra
  })
}

function titles(result: WikiPlan): string[] {
  const out: string[] = []
  const walk = (topics: WikiPlan['topics']): void => {
    for (const topic of topics) {
      out.push(topic.title)
      walk(topic.children)
    }
  }
  walk(result.topics)
  for (const page of result.pages) if (page.kind === 'root') out.push(page.title)
  return out
}

function has(result: WikiPlan, title: string): boolean {
  return titles(result).includes(title)
}

const bare = plan([file('src/a.ts')])
assert.ok(has(bare, '项目概述'), '项目概述常设')
assert.ok(!has(bare, '快速开始'), '没有启动脚本不提名快速开始')
assert.ok(!has(bare, '开发指南'), '没有工程配置不提名开发指南')
assert.ok(!has(bare, '构建与部署'), '没有构建信号不提名构建与部署')
assert.ok(!has(bare, '数据流设计'), '没有通道不提名数据流')
assert.ok(!has(bare, '故障排除'), '没有错误文件不提名故障排除')
assert.ok(!has(bare, '架构设计'), '子系统不足不提名架构设计')
assert.ok(!has(bare, 'API 参考文档'), '没有通道、路由或公共类型不提名 API')
assert.ok(!has(bare, '组件架构'), '组件不够不提名组件架构')
assert.ok(!has(bare, '测试策略'), '没有自测不提名测试策略')

const started = plan([file('src/a.ts')], { manifestPath: 'package.json', manifestScripts: ['dev'] })
assert.ok(has(started, '快速开始'), '有启动脚本就提名快速开始')

const guide = plan([file('src/a.ts'), file('tsconfig.json')])
assert.ok(has(guide, '开发指南'), '有 tsconfig 就提名开发指南')
assert.ok(
  guide.pages.some(
    (page) =>
      page.title === '开发指南' && page.members.some((member) => member.path === 'tsconfig.json')
  ),
  '开发指南收下配置文件'
)

const build = plan([file('src/a.ts'), file('.github/workflows/ci.yml')], {
  manifestScripts: ['build'],
  manifestPath: 'package.json'
})
assert.ok(has(build, '构建与部署'), '有 CI 就提名构建与部署')

const flow = plan([
  file('src/a.ts'),
  file('src/shared/ipcChannels.ts', { exports: ['CH'], inCount: 1 })
])
assert.ok(has(flow, '数据流设计'), '有通道定义就提名数据流')
assert.ok(has(flow, 'API 参考文档'), '通道定义同时打开 API 章')

const rescue = plan([file('src/app/error.ts'), file('src/app/ok.ts')])
assert.ok(has(rescue, '故障排除'), '错误文件提名故障排除')
assert.ok(!has(plan([file('src/app/ok.ts')]), '故障排除'))

const arch = plan([
  file('src/main/index.ts'),
  file('src/preload/index.ts'),
  file('src/renderer/index.ts')
])
assert.ok(has(arch, '架构设计'), '三个子系统提名架构设计')
assert.ok(
  !has(plan([file('src/only/index.ts'), file('src/only/view.ts')]), '架构设计'),
  '一个子系统不提名'
)

const reactFiles = Array.from({ length: COMPONENT_CHAPTER_MIN }, (_, i) =>
  file(`src/ui/c${i}.tsx`, { reactComponents: [`C${i}`] })
)
assert.ok(has(plan(reactFiles), '组件架构'), '组件达到门槛就提名')
assert.ok(has(plan([file('src/ui/only.tsx', { reactComponents: ['Only'] })]), '核心功能'))
assert.ok(
  !has(plan([file('src/ui/only.tsx', { reactComponents: ['Only'] })]), '组件架构'),
  '零星组件不单开章'
)

const tests = plan([file('src/a.ts'), file('scripts/selftest-a.mts')])
assert.ok(has(tests, '测试策略'), '有自测就提名测试策略')
const testPage = tests.pages.find((page) => page.title === '自测脚本')
assert.ok(
  testPage?.members.some((member) => member.role === 'reference'),
  '自测在测试章里只是引用'
)
const host = tests.pages.find(
  (page) =>
    page.kind === 'leaf' &&
    page.members.some((member) => member.path === 'src/a.ts' && member.role === 'primary')
)
assert.ok(
  host?.members.some(
    (member) => member.path === 'scripts/selftest-a.mts' && member.role === 'attached'
  ),
  '自测仍挂在被测页'
)

console.log('selftest-wikiskeleton ok')
