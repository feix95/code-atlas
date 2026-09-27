// 实底窗的画布色户口(全窗实底化):所有窗子的 backgroundColor 跟渲染层 --canvas-tint
// 同源(appearancePrefs.canvasColorOf 一本账)。建窗时定一次底色,之后两条路追着换 ——
// 设置页「应用更改」走 appearanceSave 存档落盘后刷新;外观是 auto 档时,系统深浅色
// 一翻脸也刷新。账簿自动收口:窗关了从登记处除名,不留死窗引用。

import { BrowserWindow, nativeTheme } from 'electron'
import { canvasColorOf, defaultAppearance } from '../shared/appearancePrefs.ts'
import { loadAppearanceFileSync } from './appearanceStore.ts'
import { userDataDir } from './paths.ts'

/** 在册窗登记处:谁建的窗谁登记,closed 自动除名 */
const tracked = new Set<BrowserWindow>()
let watching = false

/** 此刻画布该是啥色:外观存档 + 系统深浅色合出来(同渲染层 isDarkNow + canvas-tint 染色) */
export function windowCanvasColor(): string {
  const a = loadAppearanceFileSync(userDataDir()) ?? defaultAppearance()
  const dark = a.mode === 'dark' || (a.mode === 'auto' && nativeTheme.shouldUseDarkColors)
  return canvasColorOf(a, dark)
}

/** 建窗处统一入口:登记进簿 + 立刻把底色钉上 */
export function trackWindowBackground(win: BrowserWindow): void {
  tracked.add(win)
  win.setBackgroundColor(windowCanvasColor())
  win.on('closed', () => {
    tracked.delete(win)
  })
  ensureWatcher()
}

/** 全部在册窗换底色(外观存档变了 / 系统深浅色翻了都走这) */
export function refreshWindowBackgrounds(): void {
  const color = windowCanvasColor()
  for (const win of tracked) win.setBackgroundColor(color)
}

function ensureWatcher(): void {
  if (watching) return
  watching = true
  nativeTheme.on('updated', () => {
    // 手动钉死的模式不随系统动;只有 auto 档(或从没配过档)才跟着系统刷
    const a = loadAppearanceFileSync(userDataDir())
    if (a && a.mode !== 'auto') return
    refreshWindowBackgrounds()
  })
}
