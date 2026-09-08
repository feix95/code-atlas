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
  'Thumbs.db',
  // Windows 的系统保险柜(还原点/索引账本),普通用户永远打不开,也绝不是代码:
  // 放进来只会收获一个吓人的"不完整"徽标和一嘴谎话,直接绕开
  'System Volume Information'
])

/** 目录深度上限:防止超深目录把机器拖死 */
const MAX_DEPTH = 20

/**
 * 单次扫描的节点预算:小项目一次画完整张图(和从前一个体验);
 * 遇到整个 C 盘这种巨无霸,到量就收 —— 没探到的目录挂 lazy 占位,
 * 界面上点哪个再探哪一层,扫描耗时从此与盘的大小无关
 */
const MAX_NODES = 4000

/** 全项目同时嗅探文件的并发上限:大目录不再所有文件同时开抢,内存/磁盘句柄都有界 */
const MAX_CONCURRENT_SNIFFS = 32

/** 极简信号量:最多 max 个任务同时在跑,余下的排队等叫号 */
class SniffGate {
  private active = 0
  private readonly waiters: Array<() => void> = []
  private readonly max: number

  constructor(max: number) {
    this.max = max
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.waiters.shift()?.()
    }
  }
}

interface ScanContext {
  stats: ScanStats
  gate: SniffGate
}

async function scanDir(
  absPath: string,
  name: string,
  relPath: string,
  depth: number,
  ctx: ScanContext
): Promise<ScanDirNode> {
  // 预算见底:这层不打开了,挂"还没探"占位,等用户点开再单独探
  if (ctx.stats.fileCount + ctx.stats.dirCount >= MAX_NODES) {
    ctx.stats.lazyCount++
    return { type: 'directory', name, relPath, children: [], lazy: true }
  }

  let entries: Dirent[]
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true })
  } catch {
    // 读不了(常见是无权限):不炸,标记截断继续走
    ctx.stats.skippedCount++
    return { type: 'directory', name, relPath, children: [], truncated: true }
  }

  const children: ScanTreeNode[] = []
  // 预算在本目录中途用尽:剩下的大目录挂占位、小文件不硬列,本目录标记截断
  let cut = false

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
      if (ctx.stats.fileCount + ctx.stats.dirCount >= MAX_NODES) {
        cut = true
        // 目录照旧点名挂占位(顶层永远看得见,点开再探);文件不再硬列
        if (entry.isDirectory()) {
          ctx.stats.lazyCount++
          children.push({ type: 'directory', name: entry.name, relPath: childRelPath, children: [], lazy: true })
        }
        return
      }
      if (entry.isDirectory()) {
        ctx.stats.dirCount++
        let child: ScanDirNode
        if (depth >= MAX_DEPTH) {
          child = { type: 'directory', name: entry.name, relPath: childRelPath, children: [], truncated: true, lazy: true }
        } else {
          child = await scanDir(fullPath, entry.name, childRelPath, depth + 1, ctx)
        }
        children.push(child)
      } else if (entry.isFile()) {
        ctx.stats.fileCount++
        const ext = extname(entry.name).toLowerCase()
        ctx.stats.byExt[ext] = (ctx.stats.byExt[ext] ?? 0) + 1
        // 后缀认得出的不读文件;认不出的现场嗅探内容(全局限流,不一窝蜂)
        const language = await ctx.gate.run(() => identifyFileLanguage(fullPath, entry.name))
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

  // 根节点不挂 lazy(它就是当前这张图),只标记截断
  if (cut && relPath !== '') {
    ctx.stats.lazyCount++ // 被截断的自己也算"没探全",要记账
    return { type: 'directory', name, relPath, children, lazy: true, truncated: true }
  }
  if (cut) {
    return { type: 'directory', name, relPath, children, truncated: true }
  }
  return { type: 'directory', name, relPath, children }
}

/**
 * 扫描一个目录,返回完整目录树 + 统计。
 * 只做结构化,不做任何"解释"——解释是后面 AI 模块的事。
 *
 * baseRelPath:分级扫描探子目录时必须传入它在全项目里的前缀(如 'src/lib'),
 * 子树节点的 relPath 才是全局坐标,拼回大树不断链;整项目扫描不传,从 '' 起算
 */
export async function scanDirectory(rootPath: string, baseRelPath = ''): Promise<ScanResult> {
  const stat = await fs.stat(rootPath).catch(() => null)
  if (!stat) {
    throw new Error(`路径不存在或无法访问:${rootPath}`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`这不是一个文件夹:${rootPath}`)
  }

  const ctx: ScanContext = {
    gate: new SniffGate(MAX_CONCURRENT_SNIFFS),
    stats: {
      fileCount: 0,
      dirCount: 0,
      byExt: {},
      byLanguage: {},
      ignoredCount: 0,
      skippedCount: 0,
      lazyCount: 0
    }
  }
  const start = performance.now()
  const rootName = basename(rootPath)
  // 根节点 relPath = baseRelPath:整项目扫描为空串,探子目录时带全项目前缀
  const tree = await scanDir(rootPath, rootName, baseRelPath, 0, ctx)

  return {
    rootPath,
    rootName,
    tree,
    stats: ctx.stats,
    durationMs: Math.round(performance.now() - start)
  }
}
