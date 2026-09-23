import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, win32 } from 'node:path'
import { joinRoot } from '../shared/paths.ts'

export const PROJECT_AGENT_ROOT = 'project'
const EXTERNAL_ROOT_PREFIX = 'external_'
const MAX_DIRECTORY_PATH_CHARS = 1024

export function sanitizeExternalDirectoryPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value === '' || value.length > MAX_DIRECTORY_PATH_CHARS || value.includes('\0')) return null
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
  return /^external_[1-9]\d*$/.test(value) ? value : null
}

export class AgentDirectoryAccess {
  private readonly roots = new Map<string, string>()
  private readonly ids = new Map<string, string>()
  private nextId = 1

  find(rawPath: unknown): { rootId: string; path: string } | null {
    const path = sanitizeExternalDirectoryPath(rawPath)
    if (path === null) return null
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    const rootId = this.ids.get(key)
    return rootId ? { rootId, path: this.roots.get(rootId) as string } : null
  }

  grant(rawPath: unknown): { rootId: string; path: string } | null {
    const path = sanitizeExternalDirectoryPath(rawPath)
    if (path === null) return null
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    const existing = this.find(path)
    if (existing) return existing
    const rootId = `${EXTERNAL_ROOT_PREFIX}${this.nextId}`
    this.nextId += 1
    this.ids.set(key, rootId)
    this.roots.set(rootId, path)
    return { rootId, path }
  }

  resolve(
    projectRoot: string,
    rawRootId: unknown
  ): { rootId: string; path: string; external: boolean } | null {
    const rootId = sanitizeAgentRootId(rawRootId)
    if (rootId === null) return null
    if (rootId === PROJECT_AGENT_ROOT) return { rootId, path: projectRoot, external: false }
    const path = this.roots.get(rootId)
    return path ? { rootId, path, external: true } : null
  }
}
