// Git 改动收集器:跑真实的 git 命令,把「谁动了、动了多少」整理成改动清单。
// 安全规矩:只用 execFile + 参数数组,绝不经过 shell;git 输出的仓库内路径
// 一律剥成 relPath(路径契约),渲染进程只认 relPath,读文件经 joinRoot。
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { relative, resolve } from 'node:path'
import { joinRoot } from '../shared/paths.ts'
import type { GitChange, GitChangesResult } from '../shared/types.ts'

/** 单文件 diff 喂给模型的上限(字符数),超出截断并注明 */
export const DIFF_CHAR_LIMIT = 30_000
/** 未跟踪的全新文件当作「全部新增」读给模型的上限(字节数),超过就算太大 */
const NEW_FILE_BYTE_LIMIT = 200_000

/** porcelain 状态码 → 人话种类 */
export function pickKind(x: string, y: string): { kind: GitChange['kind']; staged: boolean } {
  if (x === '?' && y === '?') return { kind: 'untracked', staged: false }
  // 暂存区(X)有说法就听暂存区的;否则看工作区(Y)
  const effective = x !== ' ' ? x : y
  const staged = x !== ' '
  const kind: GitChange['kind'] =
    effective === 'A' || effective === 'C' ? 'added' : effective === 'D' ? 'deleted' : effective === 'R' ? 'renamed' : 'modified'
  return { kind, staged }
}

/**
 * 解析 `git status --porcelain=v1 -z` 的输出。
 * 每条目是 `XY 路径` 以 NUL 结尾;重命名/复制条目后面还跟一段 NUL 分隔的旧路径。
 */
export function parsePorcelainZ(out: string): Array<{ x: string; y: string; path: string; oldPath?: string }> {
  const parts = out.split('\0')
  const entries: Array<{ x: string; y: string; path: string; oldPath?: string }> = []
  let i = 0
  while (i < parts.length) {
    const entry = parts[i]
    i += 1
    if (!entry || entry.length < 4) continue // 结尾空段或残段,跳过
    const x = entry[0]
    const y = entry[1]
    const path = entry.slice(3)
    let oldPath: string | undefined
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      oldPath = i < parts.length ? parts[i] : undefined
      i += 1
    }
    entries.push({ x, y, path, oldPath })
  }
  return entries
}

/** numstat 对重命名的路径写成 `old => new` 或 `前/{old => new}/后`,统一取新路径 */
export function normalizeNumstatPath(p: string): string {
  if (!p.includes('=>')) return p
  const brace = p.match(/^(.*)\{(.+?) => (.+?)\}(.*)$/)
  if (brace) return brace[1] + brace[3] + brace[4]
  const arrow = p.split(' => ')
  return (arrow[arrow.length - 1] ?? p).trim()
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    // -c core.quotepath=false:中文文件名按原样输出,别转义成 \346\226\207
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolvePromise(stdout)
    })
  })
}

/** numstat 输出 → relPath → 行数账本(统一剥掉仓库前缀、转 relPath) */
function parseNumstat(out: string, prefix: string): Map<string, { add: number; del: number; binary: boolean }> {
  const ledger = new Map<string, { add: number; del: number; binary: boolean }>()
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const tab = line.split('\t')
    if (tab.length < 3) continue
    const addRaw = tab[0]
    const delRaw = tab[1]
    const repoPath = normalizeNumstatPath(tab.slice(2).join('\t'))
    const relPath = stripPrefix(repoPath, prefix)
    const binary = addRaw === '-' || delRaw === '-'
    const prev = ledger.get(relPath) ?? { add: 0, del: 0, binary: false }
    if (binary) {
      prev.binary = true
    } else {
      prev.add += Number(addRaw) || 0
      prev.del += Number(delRaw) || 0
    }
    ledger.set(relPath, prev)
  }
  return ledger
}

/** git 输出的仓库根相对路径 → 用户所选文件夹下的 relPath(路径契约) */
function stripPrefix(repoPath: string, prefix: string): string {
  const unified = repoPath.replace(/\\/g, '/')
  return unified.startsWith(prefix) ? unified.slice(prefix.length) : unified
}

/**
 * 收集项目当前的 git 改动总览。
 * 不是 git 仓库时不抛错,老老实实返回 isGitRepo=false,让界面说话。
 */
export async function collectGitChanges(rootPath: string): Promise<GitChangesResult> {
  const startedAt = Date.now()
  const empty: GitChangesResult['stats'] = { changed: 0, additions: 0, deletions: 0 }
  let repoRoot: string
  try {
    repoRoot = (await runGit(rootPath, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return { rootPath, isGitRepo: false, branch: '', changes: [], stats: empty, durationMs: Date.now() - startedAt }
  }

  // 仓库还没有任何提交时 HEAD 不存在,分支名给个人话兜底
  const branch = await runGit(rootPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    .then((s) => s.trim())
    .catch(() => '(还没有提交)')

  // 用户所选文件夹可能只是仓库的一个子目录:算出它相对仓库根的前缀,输出路径统一剥掉
  const relFromRoot = relative(resolve(repoRoot), resolve(rootPath)).replace(/\\/g, '/')
  const prefix = relFromRoot === '' ? '' : `${relFromRoot}/`

  const statusOut = await runGit(rootPath, ['status', '--porcelain=v1', '-z', '--', '.'])
  const [unstagedNumstat, stagedNumstat] = await Promise.all([
    runGit(rootPath, ['diff', '--no-color', '--numstat']),
    runGit(rootPath, ['diff', '--no-color', '--cached', '--numstat'])
  ])
  const ledger = parseNumstat(unstagedNumstat, prefix)
  for (const [relPath, counts] of parseNumstat(stagedNumstat, prefix)) {
    const prev = ledger.get(relPath) ?? { add: 0, del: 0, binary: false }
    if (counts.binary) {
      prev.binary = true
    } else {
      prev.add += counts.add
      prev.del += counts.del
    }
    ledger.set(relPath, prev)
  }

  const changes: GitChange[] = []
  for (const entry of parsePorcelainZ(statusOut)) {
    const relPath = stripPrefix(entry.path, prefix)
    if (!relPath) continue
    const { kind, staged } = pickKind(entry.x, entry.y)
    const counts = ledger.get(relPath)
    changes.push({
      relPath,
      oldPath: entry.oldPath ? stripPrefix(entry.oldPath, prefix) : undefined,
      kind,
      staged,
      additions: counts?.binary ? -1 : (counts?.add ?? 0),
      deletions: counts?.binary ? -1 : (counts?.del ?? 0),
      binary: counts?.binary ?? false
    })
  }

  // 最热闹的排前面,同量级按路径排,保证顺序稳定
  changes.sort((a, b) => Math.abs(b.additions) + Math.abs(b.deletions) - Math.abs(a.additions) - Math.abs(a.deletions) || a.relPath.localeCompare(b.relPath))

  const additions = changes.reduce((sum, c) => sum + Math.max(0, c.additions), 0)
  const deletions = changes.reduce((sum, c) => sum + Math.max(0, c.deletions), 0)
  return {
    rootPath,
    isGitRepo: true,
    branch,
    changes,
    stats: { changed: changes.length, additions, deletions },
    durationMs: Date.now() - startedAt
  }
}

/** 单文件改动的 diff 正文 + 人话备注(截断/二进制说明) */
export interface ChangeDiff {
  diff: string
  note: string
}

/**
 * 拿一个改动文件的 diff,喂给模型当证据。
 * 暂存区与工作区的改动都算数,分节标清;untracked 的新文件直接读全部内容当「全新增」。
 * 返回 null = 没法给模型喂(二进制、文件过大),由调用层给用户人话解释。
 */
export async function getChangeDiff(rootPath: string, change: GitChange): Promise<ChangeDiff | null> {
  if (change.binary) return null

  if (change.kind === 'untracked') {
    const absPath = joinRoot(rootPath, change.relPath) // relPath 想越界(.. 上跳)会在这里被拦
    const stat = await fs.stat(absPath).catch(() => null)
    if (!stat || !stat.isFile()) return null
    if (stat.size > NEW_FILE_BYTE_LIMIT) return null
    const content = await fs.readFile(absPath, 'utf8')
    return clip({ diff: `【新文件,全部内容都是新增】\n${content}`, note: '' })
  }

  const sections: string[] = []
  if (change.staged) {
    const staged = await runGit(rootPath, ['diff', '--no-color', '--cached', '--', change.relPath]).catch(() => '')
    if (staged.trim()) sections.push(`【暂存区里的改动(已 git add)】\n${staged}`)
  }
  const unstaged = await runGit(rootPath, ['diff', '--no-color', '--', change.relPath]).catch(() => '')
  if (unstaged.trim()) sections.push(`【工作区里的改动(还没 git add)】\n${unstaged}`)

  return clip({ diff: sections.join('\n\n'), note: '' })
}

function clip(result: ChangeDiff): ChangeDiff | null {
  if (result.diff.length <= DIFF_CHAR_LIMIT) return result
  return { diff: `${result.diff.slice(0, DIFF_CHAR_LIMIT)}\n……(改动太大,只取了前面一部分)`, note: '改动太大,已截断' }
}
