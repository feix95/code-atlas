// 图谱节点详情的停靠开关:停靠后详情挪进左栏坞位(sidebarDock),浮窗退场。
// 左栏能不能收留、落位高亮、停靠比例都在 sidebarDock;不传当前激活签时由 useGraphPanelDock 决定在场与否。
import { readFlagPref, writeFlagPref } from '../../shared/localPrefs.ts'
import { setSidebarDockHot } from './sidebarDock'

/** 节点详情停靠在左栏(默认关):关着 = 浮在画布右上角 */
export const GRAPH_PANEL_DOCKED_KEY = 'atlas.graphPanelDocked'

/** node 侧(纯函数自测)没有 localStorage:读不动就当没记过 */
function loadDocked(): boolean {
  try {
    return readFlagPref(GRAPH_PANEL_DOCKED_KEY, false)
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
    if (e.key !== GRAPH_PANEL_DOCKED_KEY) return
    apply(e.newValue === 'on')
  })
}

export function getGraphPanelDocked(): boolean {
  return docked
}

export function subscribeGraphPanelDock(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 唯一写口:翻账 → 落盘 → 喊醒订阅者;停靠落定同时把落位框收掉,不留残影 */
export function setGraphPanelDocked(on: boolean): void {
  if (on === docked) return
  setSidebarDockHot(false)
  apply(on)
  writeFlagPref(GRAPH_PANEL_DOCKED_KEY, on)
}
