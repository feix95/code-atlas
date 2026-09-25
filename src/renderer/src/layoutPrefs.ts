/**
 * 布局两格的存档户口(P2-4):左栏宽 + 左右分栏比。
 * 从 App.tsx 体内搬出来,和 shelfPrefs/paneKinds/recents/chatPrefs 做邻居;
 * 存的值跟着功能走,读写骨架走 shared/localPrefs。
 */
import { readFlagPref, readNumPref, writeFlagPref, writeNumPref } from '../../shared/localPrefs.ts'

const SIDEBAR_WIDTH_KEY = 'atlas.sidebar-width'
const SIDEBAR_COLLAPSED_KEY = 'atlas.sidebar-collapsed'
const PANE_SPLIT_KEY = 'atlas.pane-split'

/** 左栏默认宽(px,100% 缩放基准):UI v3 规格 6u = 24rem = 384px */
export const DEFAULT_SIDEBAR_WIDTH = 384

/** 侧栏收起旗:记进本机,下回打开还是自己收好的样子 */
export function loadSidebarCollapsed(): boolean {
  return readFlagPref(SIDEBAR_COLLAPSED_KEY, false)
}

export function saveSidebarCollapsed(on: boolean): void {
  writeFlagPref(SIDEBAR_COLLAPSED_KEY, on)
}

/** 两组的比例(左边占多少):记进本机,拖完下次还是自己调好的样子 */
export function loadPaneSplit(): number {
  return readNumPref(PANE_SPLIT_KEY, 0.5)
}

export function savePaneSplit(ratio: number): void {
  writeNumPref(PANE_SPLIT_KEY, ratio)
}

/** 左栏宽存的也是 100% 缩放下的基准值(显示缩放乘回去的活在调用方) */
export function loadSidebarWidth(): number {
  return readNumPref(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH)
}

export function saveSidebarWidth(px: number): void {
  writeNumPref(SIDEBAR_WIDTH_KEY, px)
}
