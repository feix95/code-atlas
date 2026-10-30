// 公开 GitHub 仓库当远程只读根:Trees API 拉文件树,raw.githubusercontent.com 读正文。
// 不占网页搜索预算;树缓存在内存,关应用即失效。
import { net } from 'electron'
import { IGNORED_NAMES } from '../scanner/index.ts'
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_LIST_MAX_ENTRIES,
  AGENT_MAX_DEPTH,
  AGENT_SEARCH_MAX_PATH_HITS,
  sliceAgentRead
} from '../ai/agent.ts'
import {
  githubDisplayPath,
  githubRawFileUrl,
  listGithubTree,
  parseGithubRepoMeta,
  parseGithubTreePayload,
  parseGitHubRepoUrl,
  searchGithubTreePaths,
  type GithubTreeEntry
} from '../ai/githubRepo.ts'
import { isBinaryFile } from '../shared/fileKinds.ts'
import { TOOL_NAMES } from '../shared/agentTools.ts'
import { electronFetchText } from './aiEvidence.ts'
import { agentDirectoryAccess } from './agentTools.ts'

const GITHUB_API_TIMEOUT_MS = 15_000
const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1',
  'X-GitHub-Api-Version': '2022-11-28'
}

interface GithubCachedRoot {
  owner: string
  repo: string
  ref: string
  entries: GithubTreeEntry[]
  truncated: boolean
}

const githubRoots = new Map<string, GithubCachedRoot>()

type ToolReply = { ok: boolean; text: string; hint?: string; rootId?: string }

function missingGithub(rootId: string): ToolReply {
  return {
    ok: false,
    text: `这个 GitHub 根 ${rootId} 还没打开或已经失效:先用 ${TOOL_NAMES.openGithubRepo} 打开仓库`
  }
}

function lookupGithub(rootId: string): GithubCachedRoot | null {
  return githubRoots.get(rootId) ?? null
}

function githubStatusText(status: number): string {
  if (status === 404) return '仓库不存在或不是公开仓库(私有仓库看不了)'
  if (status === 403) return 'GitHub 接口被限流或拒绝访问,稍后再试'
  if (status === 409) return '这个仓库是空的,没有可列的文件'
  return `GitHub 接口返回 ${status},这次打不开`
}

async function githubGet(url: string): Promise<{ status: number; body: string }> {
  const res = await net.fetch(url, {
    headers: GITHUB_API_HEADERS,
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS)
  })
  return { status: res.status, body: await res.text() }
}

function formatOpenText(input: {
  display: string
  rootId: string
  blobPath: string | null
  truncated: boolean
}): string {
  const lines = [
    `已打开公开仓库 ${input.display}`,
    `rootId=${input.rootId};后续 list_files/read_file/search_content 带这个 rootId,路径只写仓库内相对路径。`,
    `远程仓库的 search_content 只搜文件路径,看正文用 read_file。`
  ]
  if (input.blobPath) lines.push(`链接指向文件 ${input.blobPath},用 read_file 读它。`)
  if (input.truncated) lines.push('文件树太大,GitHub 只给了前面一部分,名单可能不全。')
  return lines.join('\n')
}

async function ensureGithubCached(
  rootId: string,
  owner: string,
  repo: string,
  ref: string
): Promise<GithubCachedRoot | { error: string }> {
  const cached = lookupGithub(rootId)
  if (cached) return cached
  const tree = await loadGithubTree(owner, repo, ref)
  if ('error' in tree) return tree
  const next: GithubCachedRoot = {
    owner,
    repo,
    ref,
    entries: tree.entries,
    truncated: tree.truncated
  }
  githubRoots.set(rootId, next)
  return next
}

async function loadGithubTree(
  owner: string,
  repo: string,
  ref: string
): Promise<{ entries: GithubTreeEntry[]; truncated: boolean } | { error: string }> {
  const treeUrl =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/git/trees/${encodeURIComponent(ref)}?recursive=1`
  let treeRes: { status: number; body: string }
  try {
    treeRes = await githubGet(treeUrl)
  } catch {
    return { error: '无法连接 GitHub，本次未打开仓库' }
  }
  if (treeRes.status !== 200) return { error: githubStatusText(treeRes.status) }
  const tree = parseGithubTreePayload(treeRes.body)
  if (!tree) return { error: 'GitHub 文件树读不懂,这次打不开' }
  return tree
}

/** open_github_repo 的执行手:拉公开仓库元信息+文件树,发本次运行的远程只读根 */
export async function agentOpenGithubRepo(url: string): Promise<ToolReply> {
  const parsed = parseGitHubRepoUrl(url)
  if (!parsed)
    return { ok: false, text: '要给公开 github.com 仓库地址,不收 gist、站点页或其它网站' }
  let metaRes: { status: number; body: string }
  try {
    const repoApi = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`
    metaRes = await githubGet(repoApi)
  } catch {
    return { ok: false, text: '无法连接 GitHub，本次未打开仓库' }
  }
  if (metaRes.status !== 200) return { ok: false, text: githubStatusText(metaRes.status) }
  const meta = parseGithubRepoMeta(metaRes.body)
  if (!meta) return { ok: false, text: 'GitHub 仓库信息读不懂,这次打不开' }
  if (meta.private) return { ok: false, text: '这是私有仓库,看不了' }
  const ref = parsed.ref ?? meta.defaultBranch
  const display = githubDisplayPath(meta.owner, meta.repo, ref)
  const granted = agentDirectoryAccess.grantGithub(display)
  if (!granted) return { ok: false, text: '仓库授权失败,没有读取任何远程文件' }
  const root = await ensureGithubCached(granted.rootId, meta.owner, meta.repo, ref)
  if ('error' in root) return { ok: false, text: root.error }
  return {
    ok: true,
    text: formatOpenText({
      display,
      rootId: granted.rootId,
      blobPath: parsed.blobPath,
      truncated: root.truncated
    }),
    hint: display,
    rootId: granted.rootId
  }
}

export async function agentGithubListFiles(rootId: string, relPath: string): Promise<ToolReply> {
  const root = lookupGithub(rootId)
  if (!root) return missingGithub(rootId)
  const listed = listGithubTree(root.entries, {
    relPath,
    ignored: IGNORED_NAMES,
    maxEntries: AGENT_LIST_MAX_ENTRIES,
    maxDepth: AGENT_MAX_DEPTH
  })
  if (listed.lines.length === 0) {
    const empty = relPath === '' ? '这个仓库根目录是空的' : `这个路径下没有列出文件:${relPath}`
    return { ok: true, text: empty }
  }
  let text = listed.lines.join('\n')
  const tails: string[] = []
  if (listed.truncated) tails.push(`名单太长,只列了前 ${AGENT_LIST_MAX_ENTRIES} 个`)
  if (root.truncated) tails.push('GitHub 文件树本身被截断,名单可能不全')
  if (tails.length > 0) text += `\n(${tails.join(';')})`
  return { ok: true, text, hint: `共 ${listed.lines.length} 个` }
}

export async function agentGithubSearchContent(
  rootId: string,
  relPath: string,
  keyword: string
): Promise<ToolReply> {
  const root = lookupGithub(rootId)
  if (!root) return missingGithub(rootId)
  const found = searchGithubTreePaths(root.entries, {
    keyword,
    relPath,
    ignored: IGNORED_NAMES,
    maxHits: AGENT_SEARCH_MAX_PATH_HITS
  })
  const scope = relPath === '' ? '整个仓库' : relPath
  if (found.paths.length === 0) {
    return {
      ok: true,
      text: `在 ${scope} 里没搜到路径含「${keyword}」的文件。远程仓库的 search_content 只搜文件路径,看正文用 read_file。`
    }
  }
  const head = found.truncated
    ? `路径对上的文件(只收前 ${AGENT_SEARCH_MAX_PATH_HITS} 个;远程仓库不搜正文):`
    : '路径对上的文件(远程仓库不搜正文):'
  return {
    ok: true,
    text: [head, ...found.paths].join('\n'),
    hint: `${scope}命中 ${found.paths.length} 处`
  }
}

export async function agentGithubReadFile(
  rootId: string,
  relPath: string,
  read: { offset: number; limit: number; maxChars: number }
): Promise<ToolReply> {
  const root = lookupGithub(rootId)
  if (!root) return missingGithub(rootId)
  if (relPath === '') return { ok: false, text: '远程仓库要给文件相对路径,不能传空字符串' }
  if (isBinaryFile(relPath)) {
    return { ok: false, text: `${relPath} 是二进制文件,读不了文本内容;这类文件只能看名字猜用途` }
  }
  const blob = root.entries.find((e) => e.type === 'blob' && e.path === relPath)
  if (!blob) {
    const asDir = root.entries.some((e) => e.type === 'tree' && e.path === relPath)
    if (asDir)
      return {
        ok: false,
        text: `${relPath} 是个文件夹不是文件;要看里面有什么,用 list_files 列名单`
      }
    return { ok: false, text: `打不开或不存在:${relPath}` }
  }
  const rawUrl = githubRawFileUrl(root.owner, root.repo, root.ref, relPath)
  let raw: string
  try {
    raw = await electronFetchText(rawUrl)
  } catch (err) {
    const detail = err instanceof Error ? err.message : ''
    if (detail.includes('太大')) {
      return { ok: false, text: `${relPath} 太大了(超过 5MB),不适合整个读` }
    }
    return { ok: false, text: `读 ${relPath} 时出了岔子(断网、被拦或编码),读不了` }
  }
  if (raw.includes('\u0000')) {
    return { ok: false, text: `${relPath} 是二进制文件,读不了文本内容;这类文件只能看名字猜用途` }
  }
  if (raw.length === 0) return { ok: true, text: `${relPath} 是个空文件` }
  if (raw.length > AGENT_FILE_MAX_BYTES) {
    return { ok: false, text: `${relPath} 太大了(超过 5MB),不适合整个读` }
  }
  return sliceAgentRead(raw, read)
}
