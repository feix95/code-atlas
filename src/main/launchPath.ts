// ── 右键启动的路径转交(右键问一问,2026-09-18)──
// 资源管理器右键拉起新进程,命令行是 `"CodeAtlas.exe" "被右键的路径"`。
// 单实例锁让新进程把 argv 转交给已在跑的实例(second-instance),或冷启动时自己处理。
// 这里只干一件事:从 argv 里把「被右键的路径」认出来。纯逻辑,自测可跑。

import { existsSync, statSync } from 'node:fs'

/**
 * 从启动参数里认出第一个真实存在的文件/目录路径(纯函数,自测覆盖)。
 * 跳过程序自己的 exe 和 - 开头的开关;文件不存在的不认(右键菜单传的都是实路,
 * 但防一手文件被删后再点);认出来还顺手分辨文件还是文件夹。
 * 没有目标(正常双击启动)回 null。
 */
export function extractLaunchPath(argv: readonly string[]): { path: string; kind: 'file' | 'directory' } | null {
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue
    if (!existsSync(arg)) continue
    try {
      const stat = statSync(arg)
      return { path: arg, kind: stat.isDirectory() ? 'directory' : 'file' }
    } catch {
      // 存在但 stat 不动(竞态删了/权限):当没有,继续看下一个参数
    }
  }
  return null
}
