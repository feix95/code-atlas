/**
 * 工作区文件名深搜(UI v3 §7.2):workspace 根向下真扫磁盘,
 * 文件名/文件夹名含关键字即命中(不分大小写),从没点开过的目录也算数。
 * 遍历契约与目录扫描同一份:IGNORED_NAMES 绕开杂物堆、符号链接不进、
 * MAX_DEPTH/MAX_NODES 两道保护闸;逐目录串行读(深搜量产的 IO 只有 readdir,
 * 串行既能早退收工也不一窝蜂抢句柄)。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { IGNORED_NAMES, MAX_DEPTH, MAX_NODES } from './index.ts'
import type { SearchNameHit, SearchNamesResult } from '../shared/searchNames.ts'
import { SEARCH_NAMES_MAX } from '../shared/searchNames.ts'

export async function searchNames(
  rootPath: string,
  query: string,
  /** 最新有效制:新一轮搜索起身后,旧一轮跑到一半就地收工回 cancelled */
  isStale: () => boolean
): Promise<SearchNamesResult> {
  const q = query.toLowerCase()
  const hits: SearchNameHit[] = []
  let visited = 0
  let truncated = false
  let stoppedEarly = false

  async function walk(abs: string, dirRel: string, depth: number): Promise<void> {
    if (truncated || isStale()) return
    let entries
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return // 读不了的目录(权限/锁)跳过:深搜只报找到的,不替打不开的地方喊疼
    }
    for (const entry of entries) {
      if (truncated || isStale()) return
      // 节点预算见底整体收工(与扫描器 MAX_NODES 同口径):不再点名也不再下钻
      if (visited >= MAX_NODES) {
        stoppedEarly = true
        return
      }
      if (IGNORED_NAMES.has(entry.name)) continue
      // 符号链接一律跳过:既防循环,也避免搜到工作区外去(与目录扫描同一道闸)
      if (entry.isSymbolicLink()) continue
      visited++
      const relPath = dirRel ? `${dirRel}/${entry.name}` : entry.name
      if (entry.name.toLowerCase().includes(q)) {
        hits.push({
          kind: entry.isDirectory() ? 'directory' : 'file',
          name: entry.name,
          relPath,
          dirRel,
          absPath: join(abs, entry.name)
        })
        if (hits.length >= SEARCH_NAMES_MAX) {
          truncated = true
          return
        }
      }
      if (!entry.isDirectory()) continue
      // 深度闸撞墙:这层目录不再下钻(与扫描器 MAX_DEPTH 同口径)——
      // 清单只剩前半程的账,照实记账
      if (depth + 1 >= MAX_DEPTH) {
        stoppedEarly = true
        continue
      }
      await walk(join(abs, entry.name), relPath, depth + 1)
    }
  }

  await walk(rootPath, '', 0)

  // 目录在前、文件在后,各自按名称排序(中文按拼音)—— 与目录树同一副排法
  hits.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
  return { hits, truncated, stoppedEarly, cancelled: isStale() }
}
