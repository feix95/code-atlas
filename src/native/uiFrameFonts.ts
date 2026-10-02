// UI 框架规格包的字体寻路(主进程/纯 node,绝不 import electron —— 自测脚本是纯 node 直跑的)。
// 与 wasmPaths 同一套探测法:打包态 electron-builder 把字体放进 resources/uiframe-fonts/<dir>/,
// 文件真实存在才算打包态,否则回退 node_modules 里的 fontsource 包。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WasmPathOpts } from './wasmPaths.ts'

export type UiFrameFontDir = 'inter' | 'noto-sans-sc'

export const UI_FRAME_FONT_DIRS: readonly UiFrameFontDir[] = ['inter', 'noto-sans-sc']

/** 字体文件名白名单:只认 fontsource 的 woff2 命名,挡住路径穿越 */
export const FONT_FILE_RE = /^[a-z0-9-]+\.woff2$/

export function uiFrameFontDir(dir: UiFrameFontDir, opts: WasmPathOpts): string {
  if (opts.resourcesPath) {
    const packed = join(opts.resourcesPath, 'uiframe-fonts', dir)
    if (existsSync(packed)) return packed
  }
  return join(opts.cwd, 'node_modules', '@fontsource-variable', dir, 'files')
}
