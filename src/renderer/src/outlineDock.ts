// 文档大纲的停靠账:停靠开关、左栏坞位、落位高亮,以及「当前停靠页签」的大纲快照。
// 浮窗在左栏能收留它时退场、左栏收起/换脸/子窗里没有左栏时自动回来 —— 判定是纯函数,自测直接喂。
import { readFlagPref, readNumPref, writeFlagPref, writeNumPref } from '../../shared/localPrefs.ts'
import type { OutlineItem } from './docOutline.ts'

/** 大纲停靠在左栏(默认关):关着 = 老样子浮在阅读栏右上角 */
export const OUTLINE_DOCKED_KEY = 'atlas.docOutlineDocked'

export interface OutlineDockState {
  /** 用户把大纲停在左栏了 */
  docked: boolean
  /** 左栏此刻能收留它:没收起、脸是文件树 */
  hostUsable: boolean
  /** 浮窗正拖在左栏上方(左栏亮落位框) */
  hot: boolean
}

/** node 侧(纯函数自测)没有 localStorage:读不动就当没记过 */
function loadDocked(): boolean {
  try {
    return readFlagPref(OUTLINE_DOCKED_KEY, false)
  } catch {
    return false
  }
}

let state: OutlineDockState = { docked: loadDocked(), hostUsable: false, hot: false }
const listeners = new Set<() => void>()

function apply(patch: Partial<OutlineDockState>): void {
  const next = { ...state, ...patch }
  if (
    next.docked === state.docked &&
    next.hostUsable === state.hostUsable &&
    next.hot === state.hot
  )
    return
  state = next
  listeners.forEach((fn) => fn())
}

if (typeof window !== 'undefined') {
  // 子窗是同一份 localStorage 的另一个 realm:那边拨了开关,这边跟着对齐
  window.addEventListener('storage', (e) => {
    if (e.key !== OUTLINE_DOCKED_KEY) return
    apply({ docked: e.newValue === null ? false : e.newValue === 'on' })
  })
}

export function getOutlineDockState(): OutlineDockState {
  return state
}

export function subscribeOutlineDock(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 唯一写口:翻账 → 落盘 → 喊醒订阅者;停靠落定同时把落位框收掉,不留残影 */
export function setOutlineDocked(on: boolean): void {
  if (on === state.docked) return
  apply({ docked: on, hot: false })
  writeFlagPref(OUTLINE_DOCKED_KEY, on)
}

/** 左栏坞位:aside 元素本身,停靠和落点判定都按它的框算 */
let host: HTMLElement | null = null

export function setOutlineDockHost(el: HTMLElement | null): void {
  host = el
}

export function getOutlineDockHost(): HTMLElement | null {
  return host
}

/** 指针落点(视口坐标)在不在这扇左栏上 */
export function hitOutlineDock(x: number, y: number): boolean {
  const el = host
  if (!el || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

export function setOutlineDockHostUsable(on: boolean): void {
  apply({ hostUsable: on })
}

export function setOutlineDockHot(on: boolean): void {
  apply({ hot: on })
}

/** 左栏里大纲占可分配高度的比例(0 = 没记过,按内容自适应) */
export const OUTLINE_DOCK_RATIO_KEY = 'atlas.docOutlineDockRatio'

/** 大纲块最少这么高(px):够画标题行与两三条 */
export const DOCK_MIN_HEIGHT = 96

/** 文件树最少留这么高(px):拖分割线也不许把树挤没 */
export const DOCK_MIN_TREE = 96

export function getOutlineDockRatio(): number {
  try {
    return readNumPref(OUTLINE_DOCK_RATIO_KEY, 0)
  } catch {
    return 0
  }
}

/** 0 = 回到内容自适应(没记过) */
export function saveOutlineDockRatio(ratio: number): void {
  writeNumPref(OUTLINE_DOCK_RATIO_KEY, Math.max(0, ratio))
}

/**
 * 拖分割线时把「大纲占多少比例」夹进上下限(纯函数,自测直接喂):
 * 大纲至少 DOCK_MIN_HEIGHT 高、文件树至少 DOCK_MIN_TREE 高;左栏矮到给不出两边时,
 * 以大纲的最小高为界(宁可挤树也不让大纲只剩一条缝)。
 */
export function clampDockRatio(next: number, room: number): number {
  if (!Number.isFinite(room) || room <= 0) return 0.5
  const min = Math.min(DOCK_MIN_HEIGHT / room, 0.9)
  const max = Math.max(min, Math.min(1 - DOCK_MIN_TREE / room, 0.9))
  const wanted = Number.isFinite(next) ? next : min
  return Math.min(Math.max(wanted, min), max)
}

/** 拖动时浮窗要问的落点:命中就亮左栏,松手交账 */
export interface OutlineDropTarget {
  hit: (x: number, y: number) => boolean
  onDrop: () => void
  onHot?: (over: boolean) => void
}

/**
 * 浮窗该藏着吗(纯函数):停靠开着、左栏这张脸能用、浮窗和左栏在同一份文档里(子窗没左栏)、
 * 停靠位正是这张签 —— 四条都占才藏,一条不占浮窗照常站岗。
 */
export function hidesFloatingOutline(args: {
  docked: boolean
  hostUsable: boolean
  sameDoc: boolean
  isOwner: boolean
}): boolean {
  return args.docked && args.hostUsable && args.sameDoc && args.isOwner
}

/** 左栏要画的那份大纲:停靠位那张签在阅读档里收出来的标题与跳转口 */
export interface OutlineSnapshot {
  items: OutlineItem[]
  activeId: string | null
  jumpTo: (id: string) => void
}

const snapshots = new Map<string, OutlineSnapshot>()
const snapListeners = new Set<() => void>()

export function publishOutline(id: string, snap: OutlineSnapshot): void {
  const prev = snapshots.get(id)
  if (
    prev &&
    prev.items === snap.items &&
    prev.activeId === snap.activeId &&
    prev.jumpTo === snap.jumpTo
  )
    return
  snapshots.set(id, snap)
  snapListeners.forEach((fn) => fn())
}

export function unpublishOutline(id: string): void {
  if (!snapshots.delete(id)) return
  snapListeners.forEach((fn) => fn())
}

/** useSyncExternalStore 的读数口:同一 id 的条目没换就一直是同一个对象 */
export function getOutlineSnapshot(id: string | null): OutlineSnapshot | null {
  return id === null ? null : (snapshots.get(id) ?? null)
}

export function subscribeOutlineSnapshot(fn: () => void): () => void {
  snapListeners.add(fn)
  return () => snapListeners.delete(fn)
}
