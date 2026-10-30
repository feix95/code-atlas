// 左栏坞位的公共账(大纲与图谱节点详情共用):aside 元素、停靠槽位、能不能收留、落位高亮、停靠比例。
// 两个停靠面板按激活签互斥,同一时刻只有一个在场,所以坞位、槽位、高亮、比例都只有一份;
// 各自「停靠了吗」的开关留在自己的模块(outlineDock、graphPanelDock)。
import { readNumPref, writeNumPref } from '../../shared/localPrefs.ts'

/** 左栏此刻能收留停靠面板:没收起、脸是文件树 */
export interface SidebarDockState {
  hostUsable: boolean
  /** 有浮窗正拖在左栏上方(左栏亮落位框) */
  hot: boolean
}

let state: SidebarDockState = { hostUsable: false, hot: false }
const listeners = new Set<() => void>()

function apply(patch: Partial<SidebarDockState>): void {
  const next = { ...state, ...patch }
  if (next.hostUsable === state.hostUsable && next.hot === state.hot) return
  state = next
  listeners.forEach((fn) => fn())
}

export function getSidebarDockState(): SidebarDockState {
  return state
}

export function subscribeSidebarDock(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 左栏坞位:aside 元素本身,落点判定按它的框算 */
let host: HTMLElement | null = null

export function setSidebarDockHost(el: HTMLElement | null): void {
  host = el
}

export function getSidebarDockHost(): HTMLElement | null {
  return host
}

/** 指针落点(视口坐标)在不在这扇左栏上 */
export function hitSidebarDock(x: number, y: number): boolean {
  const el = host
  if (!el || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

export function setSidebarDockHostUsable(on: boolean): void {
  apply({ hostUsable: on })
}

export function setSidebarDockHot(on: boolean): void {
  apply({ hot: on })
}

/** 左栏里的停靠槽位:停靠后的面板用 portal 画进这块(display: contents,不占版面) */
let slot: HTMLElement | null = null
const slotListeners = new Set<() => void>()

export function setSidebarDockSlot(el: HTMLElement | null): void {
  if (slot === el) return
  slot = el
  slotListeners.forEach((fn) => fn())
}

export function getSidebarDockSlot(): HTMLElement | null {
  return slot
}

export function subscribeSidebarDockSlot(fn: () => void): () => void {
  slotListeners.add(fn)
  return () => slotListeners.delete(fn)
}

/** 停靠块占左栏可分配高度的比例(0 = 没记过,按内容自适应);键值沿用大纲先立的偏好,不重置 */
export const SIDEBAR_DOCK_RATIO_KEY = 'atlas.docOutlineDockRatio'

/** 停靠块最少这么高(px):够画标题行与两三条 */
export const DOCK_MIN_HEIGHT = 96

/** 文件树最少留这么高(px):拖分割线也不许把树挤没 */
export const DOCK_MIN_TREE = 96

export function getSidebarDockRatio(): number {
  try {
    return readNumPref(SIDEBAR_DOCK_RATIO_KEY, 0)
  } catch {
    return 0
  }
}

/** 0 = 回到内容自适应(没记过) */
export function saveSidebarDockRatio(ratio: number): void {
  writeNumPref(SIDEBAR_DOCK_RATIO_KEY, Math.max(0, ratio))
}

/**
 * 拖分割线时把「停靠块占多少比例」夹进上下限(纯函数,自测直接喂):
 * 停靠块至少 DOCK_MIN_HEIGHT 高、文件树至少 DOCK_MIN_TREE 高;左栏矮到给不出两边时,
 * 以停靠块的最小高为界(宁可挤树也不让停靠块只剩一条缝)。
 */
export function clampDockRatio(next: number, room: number): number {
  if (!Number.isFinite(room) || room <= 0) return 0.5
  const min = Math.min(DOCK_MIN_HEIGHT / room, 0.9)
  const max = Math.max(min, Math.min(1 - DOCK_MIN_TREE / room, 0.9))
  const wanted = Number.isFinite(next) ? next : min
  return Math.min(Math.max(wanted, min), max)
}

/** 拖动时浮窗要问的落点:命中就亮左栏,松手交账;大纲与图谱详情共用这块坞 */
export interface SidebarDropTarget {
  hit: (x: number, y: number) => boolean
  onDrop: () => void
  onHot?: (over: boolean) => void
}

/**
 * 浮窗该藏着吗(纯函数):停靠开着、左栏这张脸能用、浮窗和左栏在同一份文档里(子窗没左栏)、
 * 停靠位正是这张签 —— 四条都占才藏,一条不占浮窗照常站岗。
 */
export function hidesFloatingDock(args: {
  docked: boolean
  hostUsable: boolean
  sameDoc: boolean
  isOwner: boolean
}): boolean {
  return args.docked && args.hostUsable && args.sameDoc && args.isOwner
}
