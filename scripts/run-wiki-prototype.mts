// Wiki 单页全链路原型真机实测脚本(实施顺序第 2 步,D4 实测用)。
// 跑法:node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/run-wiki-prototype.mts [选项]
// 选项:--project <项目根>(默认当前仓库) --page <页名或路径关键字>(默认 engine)
//       --user-data <应用数据目录>(默认按系统惯例定位 CodeAtlas 数据目录)
//       --out <产物目录>(默认系统临时目录 codeatlas-wiki-proto)
// 行为:用应用同一套配置与内置引擎接线解析模型目标,跑一页完整链路,
// 把成品 Markdown、账本与计时统计写进产物目录,结束时关停本次拉起的引擎。
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { buildDependencyGraph } from '../src/depgraph/index.ts'
import { getFileFact } from '../src/depgraph/factCache.ts'
import { buildWikiPlan } from '../src/wiki/wikiPlan.ts'
import type { WikiPlanFileInput, WikiPlanTopic } from '../src/wiki/wikiPlanTypes.ts'
import { WikiNoteLedger } from '../src/wiki/wikiNotes.ts'
import { runWikiPage } from '../src/wiki/wikiPageRun.ts'
import { loadAiConfig, resolveAiTarget } from '../src/ai/config.ts'
import { ensureBuiltinServer, stopBuiltinServer } from '../src/ai/builtin.ts'
import { explainWithMessages } from '../src/ai/explain.ts'
import { displayModelName } from '../src/ai/wikiOutput.ts'

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const projectRoot = argValue('--project') ?? process.cwd()
const pageKeyword = (argValue('--page') ?? 'engine').toLowerCase()
const outDir = argValue('--out') ?? join(tmpdir(), 'codeatlas-wiki-proto')
const defaultUserData =
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'CodeAtlas')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'CodeAtlas')
      : join(homedir(), '.config', 'CodeAtlas')
const userDataDir = argValue('--user-data') ?? defaultUserData

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.codeatlas', 'release'])
async function walk(dir: string, acc: string[]): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name), acc)
    } else if (entry.isFile()) {
      acc.push(relative(projectRoot, join(dir, entry.name)).split('\\').join('/'))
    }
  }
}

const graph = await buildDependencyGraph(projectRoot)
const nodeByPath = new Map(graph.nodes.map((n) => [n.relPath, n]))
const allPaths: string[] = []
await walk(projectRoot, allPaths)
const files: WikiPlanFileInput[] = []
for (const relPath of allPaths.sort()) {
  const stat = await fs.stat(join(projectRoot, relPath))
  const node = nodeByPath.get(relPath)
  const structure = getFileFact(projectRoot, relPath)?.structure
  files.push({
    relPath,
    languageId: node?.languageId ?? structure?.languageId ?? '',
    sizeBytes: stat.size,
    exports: structure?.exports ?? [],
    functions: structure?.functions ?? [],
    classes: structure?.classes ?? [],
    reactComponents: structure?.reactComponents ?? [],
    inCount: node?.inCount ?? 0,
    outCount: node?.outCount ?? 0
  })
}
let manifestScripts: string[] = []
try {
  const pkg = JSON.parse(await fs.readFile(join(projectRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  manifestScripts = Object.keys(pkg.scripts ?? {})
} catch {
  manifestScripts = []
}
const plan = buildWikiPlan({
  projectName: basename(projectRoot),
  files,
  edges: graph.edges,
  rootDocs: allPaths.filter((p) => !p.includes('/') && /\.md$/i.test(p)),
  manifestPath: existsSync(join(projectRoot, 'package.json')) ? 'package.json' : null,
  manifestScripts
})

const leaves = plan.pages.filter((p) => p.kind === 'leaf')
const page =
  leaves.find(
    (p) =>
      p.title.toLowerCase().includes(pageKeyword) ||
      p.members.some((m) => m.path.toLowerCase().includes(pageKeyword))
  ) ??
  leaves.find((p) => {
    const primaries = p.members.filter((m) => m.role === 'primary').length
    return primaries >= 3 && primaries <= 15
  }) ??
  leaves[0]
if (!page) throw new Error('规划没有叶子页可跑')
let topicTitle: string | null = null
const findTopic = (topics: WikiPlanTopic[]): void => {
  for (const topic of topics) {
    if (topic.pageIds.includes(page.id)) topicTitle = topic.title
    findTopic(topic.children)
  }
}
findTopic(plan.topics)
console.log(`待测页:${page.title}(${page.members.length} 个成员,主题 ${topicTitle ?? '无'})`)

const config = await loadAiConfig(userDataDir)
let contextSize = config.contextSize ?? 8192
let target: ReturnType<typeof resolveAiTarget> | null = null
if (config.provider === 'builtin') {
  const ready = await ensureBuiltinServer(
    config.builtin,
    config.contextSize,
    config.contextSize ?? null
  )
  contextSize = ready.contextSize
  target = resolveAiTarget(config, ready)
} else {
  target = resolveAiTarget(config)
}
if (!target || !target.ok) {
  stopBuiltinServer()
  throw new Error(
    `模型目标不可用:${target && 'message' in target ? target.message : '未知'}(数据目录 ${userDataDir})`
  )
}
const chatTarget = target.target
const modelId = displayModelName(chatTarget.model)
console.log(`模型:${modelId};实际上下文:${contextSize}`)

const ledger = await WikiNoteLedger.load(outDir)
const result = await runWikiPage(
  { page, topicTitle, plan, edges: graph.edges, contextSize },
  {
    factOf: (relPath) => getFileFact(projectRoot, relPath),
    readFile: async (relPath) => {
      try {
        const buffer = await fs.readFile(join(projectRoot, relPath))
        return buffer.includes(0) ? null : buffer.toString('utf8')
      } catch {
        return null
      }
    },
    complete: async (system, user, maxTokens) => {
      const reply = await explainWithMessages(
        chatTarget,
        [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        () => {},
        undefined,
        maxTokens
      )
      if (reply.status === 'supported' && reply.text.trim() !== '') return reply.text
      throw new Error(reply.text.trim() === '' ? '模型没返回内容' : reply.text)
    },
    modelId,
    ledger
  }
)
await ledger.save(outDir)
await fs.mkdir(outDir, { recursive: true })
await fs.writeFile(join(outDir, 'page.md'), result.markdown, 'utf8')
await fs.writeFile(
  join(outDir, 'result.json'),
  JSON.stringify(
    {
      page: page.title,
      pageId: page.id,
      model: modelId,
      contextSize,
      budget: result.evidence.budget,
      stats: result.stats
    },
    null,
    2
  ),
  'utf8'
)
stopBuiltinServer()
console.log('实测完成,统计:')
console.log(JSON.stringify(result.stats, null, 2))
console.log(`产物:${join(outDir, 'page.md')} 与 result.json`)
