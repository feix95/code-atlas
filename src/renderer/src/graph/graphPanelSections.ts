// 节点详情显示哪些区块:全局一档(localStorage,不按项目分),新区块默认显示。
// 只记「隐藏了哪些」,以后加区块不用迁旧数据;隐藏项写成一个 id 数组。
// 区块种类按内容形态各一张表:文件看引用与所属模块,文件夹看模块构成。
import { useSyncExternalStore } from 'react'
import type { LevelNode } from '../../../shared/graphView.ts'
import { readPref, writePref } from '../../../shared/localPrefs.ts'

export const GRAPH_PANEL_SECTIONS_KEY = 'atlas.graphPanelSections'

export type GraphPanelSectionId =
  'refs' | 'module' | 'files' | 'tests' | 'styles' | 'dependsOn' | 'usedBy' | 'composition'

export interface GraphPanelSectionDef {
  id: GraphPanelSectionId
  label: string
  /** 菜单里的分区小标题:同一组画在一条小灰字下面 */
  group: string
}

const FILE_SECTIONS: readonly GraphPanelSectionDef[] = [
  { id: 'refs', label: '引用关系', group: '关系' },
  { id: 'dependsOn', label: '依赖的模块', group: '关系' },
  { id: 'usedBy', label: '被这些模块使用', group: '关系' },
  { id: 'module', label: '所属模块', group: '模块' },
  { id: 'files', label: '模块文件', group: '模块' },
  { id: 'tests', label: '相关自测', group: '模块' },
  { id: 'styles', label: '附挂样式', group: '模块' }
]

const FOLDER_SECTIONS: readonly GraphPanelSectionDef[] = [
  { id: 'composition', label: '模块构成', group: '模块' }
]

/** 这类节点在「显示项」里有哪些区块 */
export function graphPanelSections(kind: 'file' | 'folder'): readonly GraphPanelSectionDef[] {
  return kind === 'file' ? FILE_SECTIONS : FOLDER_SECTIONS
}

/** 节点按哪种内容列区块;「收起的项」没有正文,返回 null */
export function graphPanelKindOf(node: LevelNode): 'file' | 'folder' | null {
  if (node.kind === 'file' || (node.kind === 'external' && node.target === 'file')) return 'file'
  if (node.kind === 'overflow') return null
  return 'folder'
}

const EMPTY_HIDDEN: ReadonlySet<GraphPanelSectionId> = new Set()
const ALL_IDS: ReadonlySet<string> = new Set(
  [...FILE_SECTIONS, ...FOLDER_SECTIONS].map((s) => s.id)
)

function isSectionId(v: unknown): v is GraphPanelSectionId {
  return typeof v === 'string' && ALL_IDS.has(v)
}

/** 本地账验身:非数组、未知 id 一律丢掉(旧版本留下的废 id 不会把新区块锁死) */
export function parseHiddenSections(raw: unknown): ReadonlySet<GraphPanelSectionId> {
  if (!Array.isArray(raw)) return EMPTY_HIDDEN
  const ids = raw.filter(isSectionId)
  return ids.length === 0 ? EMPTY_HIDDEN : new Set(ids)
}

let hidden = parseHiddenSections(readPref<unknown>(GRAPH_PANEL_SECTIONS_KEY, null))
const listeners = new Set<() => void>()

function apply(next: ReadonlySet<GraphPanelSectionId>): void {
  hidden = next
  listeners.forEach((fn) => fn())
}

if (typeof window !== 'undefined') {
  // 子窗是同一份 localStorage 的另一个 realm:删键/改账靠 storage 事件回流对齐
  window.addEventListener('storage', (e) => {
    if (e.key === GRAPH_PANEL_SECTIONS_KEY) {
      apply(parseHiddenSections(readPref<unknown>(GRAPH_PANEL_SECTIONS_KEY, null)))
    }
  })
}

export function getHiddenGraphPanelSections(): ReadonlySet<GraphPanelSectionId> {
  return hidden
}

export function subscribeGraphPanelSections(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 唯一写口:翻账 → 落盘 → 喊醒浮窗与停靠两副界面 */
export function setGraphPanelSectionVisible(id: GraphPanelSectionId, visible: boolean): void {
  if (visible === !hidden.has(id)) return
  const next = new Set(hidden)
  if (visible) next.delete(id)
  else next.add(id)
  apply(next)
  writePref(GRAPH_PANEL_SECTIONS_KEY, [...next])
}

/** 一键恢复全部区块(菜单里的「全部显示」) */
export function showAllGraphPanelSections(): void {
  if (hidden.size === 0) return
  apply(EMPTY_HIDDEN)
  writePref(GRAPH_PANEL_SECTIONS_KEY, [])
}

export function useHiddenGraphPanelSections(): ReadonlySet<GraphPanelSectionId> {
  return useSyncExternalStore(subscribeGraphPanelSections, getHiddenGraphPanelSections)
}
