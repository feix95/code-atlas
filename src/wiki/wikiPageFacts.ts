// Wiki 单页事实装配:挑摘录、补文件结构、按输入预算裁剪,并算缓存键。
// 只做纯数据拼装;读文件与取事实从 deps 注入,自测可直接喂替身。
import { agentPromptBudget } from '../ai/agentBudget.ts'
import { estimateTokens } from '../shared/aiText.ts'
import { buildWikiMessages, fitWikiFactsToBudget, isSensitiveWikiPath } from '../ai/wikiPrompt.ts'
import { translateLang } from '../shared/translateLangs.ts'
import { wikiInputHash } from './wikiHash.ts'
import type { FileFact } from '../depgraph/factCache.ts'
import type {
  WikiDependencyFact,
  WikiExcerpt,
  WikiFileFact,
  WikiPageFacts,
  WikiPageSource,
  WikiTruncated
} from '../shared/wikiTypes.ts'

/** 摘录最多带几个文件,每个文件只取开头若干行;超出由输入预算继续裁 */
export const WIKI_EXCERPT_MAX_FILES = 5
export const WIKI_EXCERPT_MAX_LINES = 60
export const WIKI_EXCERPT_MAX_CHARS = 2400

/** 每个文件最多带几条导入;内部路径在前,外部包只补位 */
export const WIKI_IMPORTS_PER_FILE = 12

/** 输出上限随上下文档位抬升:8k 起给 2048,长文档位继续加,配合流式不会被正文看门狗截断 */
export function wikiOutputTokens(contextSize: number): number {
  if (contextSize >= 32768) return 6144
  if (contextSize >= 16384) return 4096
  if (contextSize >= 12288) return 3072
  if (contextSize >= 8192) return 2048
  return 1024
}

export interface WikiFactDeps {
  /** 成员的内容哈希与结构;非可分析文件返回 null */
  factOf: (relPath: string) => FileFact | null
  /** 读文件开头做摘录;读不了返回 null。敏感文件由这里先挡 */
  readHead: (relPath: string) => Promise<string | null>
}

export interface WikiFactsInput {
  language: string
  projectName: string
  moduleCount: number
  groupCount: number
  knownTags: string[]
  contextSize: number
  replyCap: number
}

function emptyTruncated(): WikiTruncated {
  return { files: 0, symbols: 0, excerpts: 0 }
}

function excerptHead(raw: string): string {
  const lines = raw.split('\n').slice(0, WIKI_EXCERPT_MAX_LINES).join('\n')
  return lines.length > WIKI_EXCERPT_MAX_CHARS ? lines.slice(0, WIKI_EXCERPT_MAX_CHARS) : lines
}

async function collectExcerpts(source: WikiPageSource, deps: WikiFactDeps): Promise<WikiExcerpt[]> {
  const ranked = [...source.files].sort(
    (a, b) => (b.inCount ?? 0) - (a.inCount ?? 0) || (a.path < b.path ? -1 : 1)
  )
  const candidates = [...ranked.map((file) => file.path), ...source.attachedFiles]
  const seen = new Set<string>()
  const excerpts: WikiExcerpt[] = []
  for (const path of candidates) {
    if (excerpts.length >= WIKI_EXCERPT_MAX_FILES) break
    if (seen.has(path) || isSensitiveWikiPath(path)) continue
    seen.add(path)
    const raw = await deps.readHead(path).catch(() => null)
    if (raw === null) continue
    const head = excerptHead(raw)
    if (head.trim() !== '') excerpts.push({ path, head })
  }
  return excerpts
}

function fileLanguage(file: WikiPageSource['files'][number], fact: FileFact | null): string {
  return fact?.structure.languageId ?? file.language ?? 'unknown'
}

function isInternalImport(target: string): boolean {
  return target.startsWith('.') || target.startsWith('@') || target.startsWith('/')
}

/** 内部导入最能让模型讲清文件间协作,排前面;外部包补位,总量封顶 */
function pickImports(imports: readonly string[]): string[] {
  const unique = [...new Set(imports)]
  const internal = unique.filter(isInternalImport)
  const external = unique.filter((target) => !isInternalImport(target))
  return [...internal, ...external].slice(0, WIKI_IMPORTS_PER_FILE)
}

function buildWikiFileFact(
  file: WikiPageSource['files'][number],
  fact: FileFact | null
): WikiFileFact {
  const out: WikiFileFact = { path: file.path, language: fileLanguage(file, fact) }
  if (file.inCount !== undefined) out.inCount = file.inCount
  if (file.outCount !== undefined) out.outCount = file.outCount
  if (fact) {
    const imports = pickImports(fact.structure.imports)
    if (imports.length > 0) out.imports = imports
    out.exports = [...fact.structure.exports]
    out.functions = [...fact.structure.functions]
    out.classes = [...fact.structure.classes]
    out.interfaces = [...fact.structure.interfaces]
    out.reactComponents = [...fact.structure.reactComponents]
  }
  return out
}

/** 图上展示名带「·」不是路径;有真路径时不给模型看,免得它照抄进文档 */
function modelDependency(dependency: WikiDependencyFact): WikiDependencyFact {
  return dependency.path === undefined ? dependency : { ...dependency, name: null }
}

function buildPageFacts(
  source: WikiPageSource,
  input: WikiFactsInput,
  excerpts: WikiExcerpt[],
  factOf: WikiFactDeps['factOf']
): WikiPageFacts {
  const base = {
    language: {
      code: input.language,
      name: translateLang(input.language)?.enName ?? input.language
    },
    project: {
      name: input.projectName,
      moduleCount: input.moduleCount,
      groupCount: input.groupCount,
      knownTags: input.knownTags
    },
    excerpts,
    truncated: emptyTruncated()
  }
  if (source.kind === 'module') {
    return {
      ...base,
      kind: 'module',
      module: {
        id: source.pageId,
        folders: source.folders,
        files: source.files.map((file) => buildWikiFileFact(file, factOf(file.path))),
        attachedFiles: source.attachedFiles,
        dependsOn: source.dependsOn.map(modelDependency),
        usedBy: source.usedBy.map(modelDependency)
      }
    }
  }
  return {
    ...base,
    kind: 'group',
    group: {
      id: source.pageId,
      name: source.name,
      files: source.files.map((file) => buildWikiFileFact(file, factOf(file.path)))
    }
  }
}

export function wikiPageInputHash(
  source: WikiPageSource,
  language: string,
  factOf: WikiFactDeps['factOf']
): string {
  const contentHashes = new Map<string, string | null>()
  for (const file of source.files) contentHashes.set(file.path, factOf(file.path)?.sha256 ?? null)
  return wikiInputHash({
    language,
    members: source.files.map((file) => file.path),
    contentHashes,
    attached: source.attachedFiles,
    ...(source.kind === 'group' ? { groupMembers: source.files.map((file) => file.path) } : {})
  })
}

function fitToPromptBudget(facts: WikiPageFacts, input: WikiFactsInput): WikiPageFacts {
  const fixed = estimateTokens(buildWikiMessages(facts).system) + 64
  const budget = Math.max(512, agentPromptBudget(input.contextSize, input.replyCap) - fixed)
  return fitWikiFactsToBudget(facts, budget)
}

/** 一页要发给模型的完整事实:只含当前页成员,按预算裁过 */
export async function prepareWikiPageFacts(
  source: WikiPageSource,
  input: WikiFactsInput,
  deps: WikiFactDeps
): Promise<WikiPageFacts> {
  const excerpts = await collectExcerpts(source, deps)
  return fitToPromptBudget(buildPageFacts(source, input, excerpts, deps.factOf), input)
}
