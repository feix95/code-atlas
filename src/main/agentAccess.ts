import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, win32 } from 'node:path'
import { GITHUB_ROOT_PREFIX } from '../ai/githubRepo.ts'
import { joinRoot } from '../shared/paths.ts'

export const PROJECT_AGENT_ROOT = 'project'
const EXTERNAL_ROOT_PREFIX = 'external_'
const MAX_EXTERNAL_PATH_CHARS = 1024

/** 授权根的品种:目录(申请制)、单个文件(拖入即授权)、公开 GitHub 仓库(远程只读) */
export type AgentRootKind = 'dir' | 'file' | 'github'

/** 一张发出去的授权令牌:编号 + 真实路径 + 品种 */
export interface AgentGrantedRoot {
  rootId: string
  path: string
  kind: AgentRootKind
}

/** 外部路径的路径规范化(目录申请和文件授权令牌共用):只收规范化绝对路径,其余一律 null */
export function sanitizeExternalAbsPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value === '' || value.length > MAX_EXTERNAL_PATH_CHARS || value.includes('\0')) return null
  if (!isAbsolute(value) && !win32.isAbsolute(value)) return null
  return win32.isAbsolute(value) ? win32.resolve(value) : resolve(value)
}

export function isPathInside(rootPath: string, targetPath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(targetPath))
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..\\`) && !rel.startsWith('../') && !isAbsolute(rel))
  )
}

export async function joinAuthorizedRoot(rootPath: string, relPath: string): Promise<string> {
  const lexical = joinRoot(rootPath, relPath)
  const [canonicalRoot, canonicalTarget] = await Promise.all([
    realpath(rootPath),
    realpath(lexical)
  ])
  if (!isPathInside(canonicalRoot, canonicalTarget)) throw new Error('路径越过了已授权目录')
  return canonicalTarget
}

export function sanitizeAgentRootId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return PROJECT_AGENT_ROOT
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value === PROJECT_AGENT_ROOT) return value
  if (/^external_[1-9]\d*$/.test(value)) return value
  return /^github_[1-9]\d*$/.test(value) ? value : null
}

/**
 * 本次运行的授权状态表:外部目录(模型申请、用户弹窗同意)与外部单个文件
 * (拖入即授权 —— 用户亲手拖进对话的文件)共用同一种令牌编号,只存内存,关应用即失效。
 * resolve 只管把编号解成真实路径;越界拦截仍由 joinAuthorizedRoot 二道把关。
 */
export class AgentDirectoryAccess {
  private readonly roots = new Map<string, { path: string; kind: AgentRootKind }>()
  private readonly ids = new Map<string, string>()
  private nextId = 1
  private githubNextId = 1

  find(rawPath: unknown): AgentGrantedRoot | null {
    const path = sanitizeExternalAbsPath(rawPath)
    if (path === null) return null
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    const rootId = this.ids.get(key)
    if (!rootId) return null
    const root = this.roots.get(rootId) as { path: string; kind: AgentRootKind }
    return { rootId, path: root.path, kind: root.kind }
  }

  /** 目录授权(弹窗那条路的入库口):调用方已经 realpath + 验过是文件夹 */
  grant(rawPath: unknown): AgentGrantedRoot | null {
    const path = sanitizeExternalAbsPath(rawPath)
    if (path === null) return null
    return this.upsert(path, 'dir')
  }

  /** 公开 GitHub 仓库(远程只读根):path 是展示名 github.com/owner/repo@ref,不是本地盘路径 */
  grantGithub(displayPath: string): AgentGrantedRoot | null {
    const path = displayPath.trim()
    if (path === '' || path.length > MAX_EXTERNAL_PATH_CHARS) return null
    return this.upsert(path, 'github')
  }

  /** 文件授权令牌(拖入即授权):只收真实存在的单个文件;目录、不存在、形状不对一律不发令牌 */
  async grantFile(rawPath: unknown): Promise<AgentGrantedRoot | null> {
    const requested = sanitizeExternalAbsPath(rawPath)
    if (requested === null) return null
    const canonical = await realpath(requested).catch(() => null)
    if (canonical === null) return null
    const info = await stat(canonical).catch(() => null)
    if (!info?.isFile()) return null
    return this.upsert(canonical, 'file')
  }

  resolve(
    projectRoot: string,
    rawRootId: unknown
  ): { rootId: string; path: string; external: boolean; kind: AgentRootKind } | null {
    const rootId = sanitizeAgentRootId(rawRootId)
    if (rootId === null) return null
    if (rootId === PROJECT_AGENT_ROOT)
      return { rootId, path: projectRoot, external: false, kind: 'dir' }
    const root = this.roots.get(rootId)
    return root ? { rootId, path: root.path, external: true, kind: root.kind } : null
  }

  /** 同一条真实路径重复授权复用原授权令牌(Windows 下不区分大小写;GitHub 展示名一律小写) */
  private upsert(path: string, kind: AgentRootKind): AgentGrantedRoot {
    const key = kind === 'github' || process.platform === 'win32' ? path.toLowerCase() : path
    const existingId = this.ids.get(key)
    if (existingId) {
      const root = this.roots.get(existingId) as { path: string; kind: AgentRootKind }
      return { rootId: existingId, path: root.path, kind: root.kind }
    }
    const rootId =
      kind === 'github'
        ? `${GITHUB_ROOT_PREFIX}${this.githubNextId}`
        : `${EXTERNAL_ROOT_PREFIX}${this.nextId}`
    if (kind === 'github') this.githubNextId += 1
    else this.nextId += 1
    this.ids.set(key, rootId)
    this.roots.set(rootId, { path, kind })
    return { rootId, path, kind }
  }
}
