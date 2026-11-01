// 事实缓存:关系分析读过的源码哈希与结构清单留在主进程,供 Wiki 生成算缓存键、侧栏导出清单使用。
// 只保留最近一次分析的项目;渲染进程拿不到整份缓存,单文件结构仍走 atlas:analyze-file。
import { createHash } from 'node:crypto'
import type { FileStructure } from '../shared/types.ts'

export interface FileFact {
  sha256: string
  structure: FileStructure
}

interface CachedScan {
  rootPath: string
  generation: number
  files: Map<string, FileFact>
}

let cached: CachedScan | null = null
let generationSeq = 0

/** 开始新一次全项目分析;旧项目或旧代次的写入会被丢弃 */
export function beginFactScan(rootPath: string): number {
  generationSeq += 1
  cached = { rootPath, generation: generationSeq, files: new Map() }
  return generationSeq
}

/** 写入一个文件的哈希与结构;返回 false 表示这次分析已被顶掉 */
export function putFileFact(
  rootPath: string,
  generation: number,
  relPath: string,
  sha256: string,
  structure: FileStructure
): boolean {
  if (cached === null || cached.rootPath !== rootPath || cached.generation !== generation) {
    return false
  }
  cached.files.set(relPath, { sha256, structure })
  return true
}

export function getFileFact(rootPath: string, relPath: string): FileFact | null {
  if (cached === null || cached.rootPath !== rootPath) return null
  return cached.files.get(relPath) ?? null
}

export function getFactFileCount(rootPath: string): number {
  if (cached === null || cached.rootPath !== rootPath) return 0
  return cached.files.size
}

/** 项目切换、返回首页时作废 */
export function clearFactCache(): void {
  cached = null
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
