// 语法引擎 wasm 的寻路员(主进程/纯 node,绝不 import electron —— 自测脚本是纯 node 直跑的)。
// 开发与自测从项目根运行,直接按 node_modules 拿;打包后 electron-builder 把字典作为
// extraResources 放进 <安装目录>/resources/wasm/,从那儿拿。
// 探测法:process.resourcesPath 在 Electron 主进程总有值(dev 态指向 electron 发行包的
// resources),但只有打包态那里才有咱放进去的 wasm/tree-sitter.wasm —— 所以不猜环境,
// 认文件:文件真实存在才算打包态,否则一律回退 node_modules。
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** electron 主进程才挂的 resourcesPath;纯 node 下 undefined(类型定义里没有,这里收窄) */
export function currentResourcesPath(): string | undefined {
  return (process as { resourcesPath?: string }).resourcesPath
}

export interface WasmPathOpts {
  /** Electron 主进程的 process.resourcesPath,纯 node/自测传 undefined */
  resourcesPath?: string
  /** 项目根(开发与自测的工作目录) */
  cwd: string
}

/** 打包态的 wasm 行李箱:resources/wasm/,里面平铺引擎与各语法字典 */
function packedWasmDir(resourcesPath: string | undefined): string | null {
  if (!resourcesPath) return null
  const dir = join(resourcesPath, 'wasm')
  return existsSync(join(dir, 'tree-sitter.wasm')) ? dir : null
}

/** 引擎本体 tree-sitter.wasm 的完整路径 */
export function engineWasmPath(opts: WasmPathOpts): string {
  const packed = packedWasmDir(opts.resourcesPath)
  if (packed) return join(packed, 'tree-sitter.wasm')
  return join(opts.cwd, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm')
}

/** 语法字典所在目录(tree-sitter-<语言>.wasm 一堆) */
export function grammarWasmDir(opts: WasmPathOpts): string {
  const packed = packedWasmDir(opts.resourcesPath)
  if (packed) return packed
  return join(opts.cwd, 'node_modules', 'tree-sitter-wasms', 'out')
}

/** 当前环境的寻路参数:analyzer/highlight 都用它,别各自再装一份 */
export function currentWasmOpts(): WasmPathOpts {
  return { resourcesPath: currentResourcesPath(), cwd: process.cwd() }
}
