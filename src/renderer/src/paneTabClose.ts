// 关页签:单关与批量关的接力规矩(右邻优先、左邻兜底、组搬空自己消亡)。
import type { ScanResult } from '@shared/types'
import type { PaneGroup, PaneTab } from './paneTabs'
import { cancelTranslationOf } from './paneTabTranslation'

export function createTabCloser(deps: {
  groups: PaneGroup[]
  result: ScanResult | null
  visibleOfGroup: (g: PaneGroup | null) => PaneTab[]
  setGroups: React.Dispatch<React.SetStateAction<PaneGroup[]>>
  setActiveGroupId: React.Dispatch<React.SetStateAction<string | null>>
  patchGroup: (groupId: string, patch: (g: PaneGroup) => PaneGroup) => void
  revealTab: (t: PaneTab) => void
}): {
  closeTab: (id: string) => void
  closeTabsInGroup: (groupId: string, ids: readonly string[]) => void
} {
  const { groups, result, visibleOfGroup, setGroups, setActiveGroupId, patchGroup, revealTab } =
    deps

  function closeTab(id: string): void {
    const owner = groups.find((g) => g.tabs.some((t) => t.id === id))
    if (!owner) return
    const closing = owner.tabs.find((t) => t.id === id)
    if (closing) cancelTranslationOf(closing, result)
    // 无工作区的孤组关空(首页上开的设置/图谱签):组一起清场,首页回前台 ——
    // 「页签都关掉了」的空底板是给工作区留的,家里没树可点,留它就是个死胡同
    if (owner.tabs.length === 1 && groups.length === 1 && !result) {
      setGroups([])
      setActiveGroupId(null)
      return
    }
    const vis = visibleOfGroup(owner)
    const idx = vis.findIndex((t) => t.id === id)
    const nextVis = vis.filter((t) => t.id !== id)
    const wasActive = owner.activeId === id
    // 关空了这组:组消亡,聚焦挪去剩下的组(至少留一组当底板)
    if (owner.tabs.length === 1 && groups.length > 1) {
      const survivors = groups.filter((g) => g.id !== owner.id)
      setGroups(survivors)
      setActiveGroupId(survivors[0]?.id ?? null)
      return
    }
    // 关的是激活页签:右邻优先接力,左邻兜底,全空回底板(VS Code 同款)
    const nextActiveId = wasActive
      ? (nextVis[idx]?.id ?? nextVis[idx - 1]?.id ?? null)
      : owner.activeId
    patchGroup(owner.id, (g) => ({
      ...g,
      tabs: g.tabs.filter((t) => t.id !== id),
      activeId: nextActiveId
    }))
    if (wasActive && nextActiveId) {
      const next = owner.tabs.find((t) => t.id === nextActiveId)
      if (next) revealTab(next)
    }
  }

  /**
   * 批量关签(右键菜单「关其他/关右侧/关全部」):一单算清再落账 ——
   * 不能循环调 closeTab:同一批里每个调用读的都是同一份渲染前快照,
   * 关到激活签时后到的调用会把 activeId 写回已被关掉的死签。
   */
  function closeTabsInGroup(groupId: string, ids: readonly string[]): void {
    const owner = groups.find((g) => g.id === groupId)
    if (!owner || ids.length === 0) return
    const kill = new Set(ids)
    owner.tabs.filter((t) => kill.has(t.id)).forEach((t) => cancelTranslationOf(t, result))
    const nextTabs = owner.tabs.filter((t) => !kill.has(t.id))
    // 整组关空:口径同 closeTab —— 独组且无工作区时清场回首页;
    // 多组时组消亡、焦点挪给头组;独组但有工作区留张空底板
    if (nextTabs.length === 0) {
      if (groups.length === 1 && !result) {
        setGroups([])
        setActiveGroupId(null)
        return
      }
      const survivors = groups.filter((g) => g.id !== owner.id)
      if (survivors.length > 0) {
        setGroups(survivors)
        setActiveGroupId(survivors[0].id)
        return
      }
      patchGroup(owner.id, (g) => ({ ...g, tabs: [], activeId: null }))
      return
    }
    // 激活签被杀:可见序右邻优先接力,右侧全灭收最末(与 closeTab 同款接力规矩)
    const actIdx = owner.tabs.findIndex((t) => t.id === owner.activeId)
    const killedActive = owner.activeId !== null && kill.has(owner.activeId)
    const rightNeighbor = owner.tabs.slice(actIdx + 1).find((t) => !kill.has(t.id))
    const nextActiveId = killedActive
      ? (rightNeighbor?.id ?? nextTabs[nextTabs.length - 1].id)
      : owner.activeId
    patchGroup(owner.id, (g) => ({ ...g, tabs: nextTabs, activeId: nextActiveId }))
    if (killedActive && nextActiveId) {
      const next = nextTabs.find((t) => t.id === nextActiveId)
      if (next) revealTab(next)
    }
  }

  return { closeTab, closeTabsInGroup }
}
