import { promises as fs, type Dirent } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ScanDirNode, ScanResult, ScanStats, ScanTreeNode } from '../shared/types.ts'
import { identifyFileLanguage } from '../parser/index.ts'

/** 扫描时直接绕开的目录/文件:依赖包、版本库、构建产物等"仓库杂物" */
const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  '.gradle',
  'Pods',
  '.DS_Store',
  'Thumbs.db'
])

/** 目录深度上限:防止超深目录把机器拖死 */
const MAX_DEPTH = 20

interface ScanContext {
  stats: ScanStats
}

async function scanDir(
  absPath: string,
  name: string,
  relPath: string,
  depth: number,
  ctx: ScanContext
): Promise<ScanDirNode> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true })
  } catch {
    // 读不了(常见是无权限):不炸,标记截断继续走
    ctx.stats.skippedCount++
    return { type: 'directory', name, relPath, children: [], truncated: true }
  }

  const children: ScanTreeNode[] = []

  await Promise.all(
    entries.map(async (entry) => {
      if (IGNORED_NAMES.has(entry.name)) {
        ctx.stats.ignoredCount++
        return
      }
      // 符号链接一律跳过:既防循环,也避免扫到项目外去
      if (entry.isSymbolicLink()) {
        ctx.stats.skippedCount++
        return
      }

      // relPath 是全项目的文件标识契约:分隔符统一 '/',根名不进路径
      const childRelPath = relPath ? `${relPath}/${entry.name}` : entry.name
      const fullPath = join(absPath, entry.name)
      if (entry.isDirectory()) {
        ctx.stats.dirCount++
        let child: ScanDirNode
        if (depth >= MAX_DEPTH) {
          child = { type: 'directory', name: entry.name, relPath: childRelPath, children: [], truncated: true }
        } else {
          child = await scanDir(fullPath, entry.name, childRelPath, depth + 1, ctx)
        }
        children.push(child)
      } else if (entry.isFile()) {
        ctx.stats.fileCount++
        const ext = extname(entry.name).toLowerCase()
        ctx.stats.byExt[ext] = (ctx.stats.byExt[ext] ?? 0) + 1
        // 后缀认得出的不读文件;认不出的现场嗅探内容
        const language = await identifyFileLanguage(fullPath, entry.name)
        if (language) {
          const agg = ctx.stats.byLanguage[language.id] ?? { name: language.name, count: 0 }
          agg.count++
          ctx.stats.byLanguage[language.id] = agg
          children.push({ type: 'file', name: entry.name, relPath: childRelPath, ext, language })
        } else {
          children.push({ type: 'file', name: entry.name, relPath: childRelPath, ext })
        }
      }
      // 其他类型(管道、socket 等)不进树
    })
  )

  // 文件夹在前、文件在后,各自按名称排序(中文按拼音)
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })

  return { type: 'directory', name, relPath, children }
}

/**
 * 扫描一个目录,返回完整目录树 + 统计。
 * 只做结构化,不做任何"解释"——解释是后面 AI 模块的事。
 */
export async function scanDirectory(rootPath: string): Promise<ScanResult> {
  const stat = await fs.stat(rootPath).catch(() => null)
  if (!stat) {
    throw new Error(`路径不存在或无法访问:${rootPath}`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`这不是一个文件夹:${rootPath}`)
  }

  const ctx: ScanContext = {
    stats: {
      fileCount: 0,
      dirCount: 0,
      byExt: {},
      byLanguage: {},
      ignoredCount: 0,
      skippedCount: 0
    }
  }
  const start = performance.now()
  const rootName = basename(rootPath)
  // 根节点 relPath 为空:根名只活在 rootName/rootPath 里,绝不进相对路径
  const tree = await scanDir(rootPath, rootName, '', 0, ctx)

  return {
    rootPath,
    rootName,
    tree,
    stats: ctx.stats,
    durationMs: Math.round(performance.now() - start)
  }
}
