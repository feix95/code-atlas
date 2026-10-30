// 模块切分用的路径与排序小工具。
// 排序一律按 UTF-16 码元比较,不用 localeCompare:后者随系统语言环境变化,会让不同机器切出不同结果。

export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** relPath 所在目录;项目根下的文件返回 '' */
export function dirOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash < 0 ? '' : relPath.slice(0, slash)
}

export function sortedUnique(items: Iterable<string>): string[] {
  return [...new Set(items)].sort(byCodeUnit)
}
