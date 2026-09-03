import { resolve, sep } from 'node:path'

/**
 * 全项目唯一的「root + 相对路径 → 绝对路径」解析点。
 *
 * 路径契约(所有模块必须遵守,不许各拼各的):
 * - 树节点(ScanFileNode / ScanDirNode)只存 relPath:相对扫描根的路径,
 *   分隔符统一为 '/',不含根目录自己的名字(根节点 relPath 为 '')
 * - renderer 永远只回传 (rootPath, relPath) 原样数据,绝不自己拼绝对路径
 * - 任何模块要真正读写文件,必须经过 joinRoot —— 不许手写 `root + '/' + rel`
 *
 * resolve 会归一化 Windows 的 \ 和 /、盘符、中文与空格路径;
 * relPath 想越界(.. 上跳、绝对路径/盘符注入)会在这里被拦下抛错。
 */
export function joinRoot(rootPath: string, relPath: string): string {
  const root = resolve(rootPath)
  const abs = resolve(root, relPath)
  const bounded = root.endsWith(sep) ? root : root + sep
  if (abs !== root && !abs.startsWith(bounded)) {
    throw new Error(`路径越界,不在项目内:${relPath}`)
  }
  return abs
}
