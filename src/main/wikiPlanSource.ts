// 规划输入的主进程数据源:依赖图走产品分析管线(顺带刷新事实缓存),
// 文件清单按扫描器同一份忽略名单走盘,结构从事实缓存取,清单脚本读 package.json。
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { buildDependencyGraph } from '../depgraph/index.ts'
import { getFileFact } from '../depgraph/factCache.ts'
import { IGNORED_NAMES } from '../scanner/index.ts'
import type { WikiPlanInputDeps } from '../wiki/wikiPlanInput.ts'

async function walk(dir: string, root: string, acc: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(abs, root, acc)
    } else if (entry.isFile()) {
      acc.push(relative(root, abs).split('\\').join('/'))
    }
  }
}

export function wikiPlanSourceDeps(rootPath: string): WikiPlanInputDeps {
  return {
    buildGraph: async (root) => {
      const graph = await buildDependencyGraph(root)
      return { nodes: graph.nodes, edges: graph.edges }
    },
    listFiles: async (root) => {
      const acc: string[] = []
      await walk(root, root, acc)
      return acc
    },
    fileSize: async (root, relPath) => {
      const stat = await fs.stat(join(root, relPath)).catch(() => null)
      return stat?.size ?? 0
    },
    structureOf: (relPath) => {
      const structure = getFileFact(rootPath, relPath)?.structure
      if (!structure) return null
      return {
        languageId: structure.languageId,
        exports: structure.exports,
        functions: structure.functions,
        classes: structure.classes,
        reactComponents: structure.reactComponents
      }
    },
    readManifest: async (root) => {
      try {
        const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8')) as {
          scripts?: Record<string, string>
        }
        return { path: 'package.json', scripts: Object.keys(pkg.scripts ?? {}) }
      } catch {
        return null
      }
    }
  }
}
