// 公开 GitHub 仓库当远程只读根:URL 解析、文件树过滤、路径搜索。纯函数,不碰网络。

export const GITHUB_ROOT_PREFIX = 'github_'

export interface GitHubRepoRef {
  owner: string
  repo: string
  /** 分支/标签;打开时还不知道默认分支则为 null */
  ref: string | null
  /** blob 页上的文件路径,打开仓库后提示用 read_file 读 */
  blobPath: string | null
}

export interface GithubTreeEntry {
  path: string
  type: 'blob' | 'tree'
}

const OWNER_REPO = /^[A-Za-z0-9_.-]+$/

/** 公开 github.com 仓库地址 → owner/repo/ref;gist、站点页、非 github 一律 null */
export function parseGitHubRepoUrl(raw: unknown): GitHubRepoRef | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'github.com') return null
  const parts = parsed.pathname.split('/').filter((p) => p !== '')
  if (parts.length < 2) return null
  const owner = parts[0] ?? ''
  const repoRaw = parts[1] ?? ''
  const repo = repoRaw.replace(/\.git$/i, '')
  if (!OWNER_REPO.test(owner) || !OWNER_REPO.test(repo)) return null
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null
  const kind = parts[2]
  if (kind === 'tree' || kind === 'blob') {
    const ref = parts[3] ?? ''
    if (ref === '') return { owner, repo, ref: null, blobPath: null }
    const rest = parts.slice(4).join('/')
    return {
      owner,
      repo,
      ref,
      blobPath: kind === 'blob' && rest !== '' ? rest : null
    }
  }
  return { owner, repo, ref: null, blobPath: null }
}

export function githubDisplayPath(owner: string, repo: string, ref: string): string {
  return `github.com/${owner}/${repo}@${ref}`
}

function encodePathSegments(value: string): string {
  return value
    .split('/')
    .filter((p) => p !== '')
    .map((p) => encodeURIComponent(p))
    .join('/')
}

export function githubRawFileUrl(
  owner: string,
  repo: string,
  ref: string,
  relPath: string
): string {
  return `https://raw.githubusercontent.com/${encodePathSegments(owner)}/${encodePathSegments(repo)}/${encodePathSegments(ref)}/${encodePathSegments(relPath)}`
}

/** 防打转键:同一仓库同一 ref 算一次;还没解析到分支时只记 owner/repo */
export function githubRepoKey(ref: GitHubRepoRef): string {
  const base = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`
  return ref.ref ? `${base}@${ref.ref}` : base
}

export interface GithubRepoMeta {
  owner: string
  repo: string
  defaultBranch: string
  private: boolean
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  return null
}

/** GitHub 仓库元信息:只要公开仓库的 owner/repo/默认分支;私有标出来让执行手拒 */
export function parseGithubRepoMeta(raw: unknown): GithubRepoMeta | null {
  const obj = asRecord(raw)
  if (!obj) return null
  const fullName = typeof obj.full_name === 'string' ? obj.full_name.trim() : ''
  const parts = fullName.split('/').filter((p) => p !== '')
  const owner = parts[0] ?? ''
  const repo = parts[1] ?? ''
  const defaultBranch = typeof obj.default_branch === 'string' ? obj.default_branch.trim() : ''
  if (!OWNER_REPO.test(owner) || !OWNER_REPO.test(repo) || defaultBranch === '') return null
  return { owner, repo, defaultBranch, private: obj.private === true }
}

/** GitHub Trees API 的 recursive 回包:只收 blob/tree,子模块(commit)丢掉 */
export function parseGithubTreePayload(
  raw: unknown
): { entries: GithubTreeEntry[]; truncated: boolean } | null {
  const obj = asRecord(raw)
  if (!obj || !Array.isArray(obj.tree)) return null
  const entries: GithubTreeEntry[] = []
  for (const item of obj.tree) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const path = typeof rec.path === 'string' ? rec.path : ''
    if (path === '' || (rec.type !== 'blob' && rec.type !== 'tree')) continue
    entries.push({ path, type: rec.type })
  }
  return { entries, truncated: obj.truncated === true }
}

function ignoredPath(relPath: string, ignored: ReadonlySet<string>): boolean {
  return relPath.split('/').some((part) => ignored.has(part))
}

function underPrefix(path: string, relPath: string): boolean {
  if (relPath === '') return true
  return path === relPath || path.startsWith(`${relPath}/`)
}

function depthFrom(path: string, relPath: string): number {
  const rest = relPath === '' ? path : path.slice(relPath.length).replace(/^\//, '')
  if (rest === '') return 0
  return rest.split('/').length
}

/** 把 GitHub recursive tree 收成 list_files 那种名单(目录带尾斜杠) */
export function listGithubTree(
  entries: readonly GithubTreeEntry[],
  opts: { relPath: string; ignored: ReadonlySet<string>; maxEntries: number; maxDepth: number }
): { lines: string[]; truncated: boolean } {
  const prefix = opts.relPath
  const lines: string[] = []
  let truncated = false
  for (const entry of entries) {
    if (!underPrefix(entry.path, prefix) || entry.path === prefix) continue
    if (ignoredPath(entry.path, opts.ignored)) continue
    if (depthFrom(entry.path, prefix) > opts.maxDepth) continue
    if (lines.length >= opts.maxEntries) {
      truncated = true
      break
    }
    lines.push(entry.type === 'tree' ? `${entry.path}/` : entry.path)
  }
  return { lines, truncated }
}

/** 远程仓库 search_content 的路径半边:只认文件路径里的关键词 */
export function searchGithubTreePaths(
  entries: readonly GithubTreeEntry[],
  opts: {
    keyword: string
    relPath: string
    ignored: ReadonlySet<string>
    maxHits: number
  }
): { paths: string[]; truncated: boolean } {
  const needle = opts.keyword.trim().toLowerCase()
  if (needle === '') return { paths: [], truncated: false }
  const paths: string[] = []
  let truncated = false
  for (const entry of entries) {
    if (entry.type !== 'blob') continue
    if (!underPrefix(entry.path, opts.relPath)) continue
    if (ignoredPath(entry.path, opts.ignored)) continue
    if (!entry.path.toLowerCase().includes(needle)) continue
    if (paths.length >= opts.maxHits) {
      truncated = true
      break
    }
    paths.push(entry.path)
  }
  return { paths, truncated }
}
