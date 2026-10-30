// 文档大纲的停靠开关,以及「当前停靠页签」的大纲快照。
// 左栏坞位、槽位、落位高亮、比例都在 sidebarDock 里与图谱详情共用;浮窗让位判定也是那边的纯函数。
import { readFlagPref, writeFlagPref } from '../../shared/localPrefs.ts'
import type { OutlineItem } from './docOutline.ts'
import { setSidebarDockHot } from './sidebarDock.ts'

/** 大纲停靠在左栏(默认关):关着 = 老样子浮在阅读栏右上角 */
export const OUTLINE_DOCKED_KEY = 'atlas.docOutlineDocked'

/** node 侧(纯函数自测)没有 localStorage:读不动就当没记过 */
function loadDocked(): boolean {
  try {
    return readFlagPref(OUTLINE_DOCKED_KEY, false)
  } catch {
    return false
  }
}

let docked = loadDocked()
const listeners = new Set<() => void>()

function apply(next: boolean): void {
  if (next === docked) return
  docked = next
  listeners.forEach((fn) => fn())
}

if (typeof window !== 'undefined') {
  // 子窗是同一份 localStorage 的另一个 realm:那边拨了开关,这边跟着对齐
  window.addEventListener('storage', (e) => {
    if (e.key !== OUTLINE_DOCKED_KEY) return
    apply(e.newValue === 'on')
  })
}

export function getOutlineDocked(): boolean {
  return docked
}

export function subscribeOutlineDocked(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 唯一写口:翻账 → 落盘 → 喊醒订阅者;停靠落定同时把落位框收掉,不留残影 */
export function setOutlineDocked(on: boolean): void {
  if (on === docked) return
  setSidebarDockHot(false)
  apply(on)
  writeFlagPref(OUTLINE_DOCKED_KEY, on)
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
