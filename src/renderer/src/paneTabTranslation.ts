// 译文页签的动作:开镜像签、就地换语种、关签时掐断在跑的翻译。
import { cancelTranslate, translateKey } from './translateStore'
import type { ScanResult } from '@shared/types'
import { translateLang } from '@shared/translateLangs'
import { KIND_ICONS } from './paneKinds'
import {
  groupHost,
  MAIN_HOST,
  nextTabId,
  translationTabName,
  type PaneGroup,
  type PaneTab
} from './paneTabs'

/** 关掉译文镜像签 = 掐断这次翻译,别让主进程对着没人看的页签空转 */
export function cancelTranslationOf(tab: PaneTab, result: ScanResult | null): void {
  if (tab.kind !== 'translate' || tab.lang === undefined || !result) return
  cancelTranslate(translateKey(result.rootPath, tab.relPath, tab.lang))
}

export function createTranslationActions(deps: {
  groups: PaneGroup[]
  activeGroup: PaneGroup | null
  result: ScanResult | null
  setGroups: React.Dispatch<React.SetStateAction<PaneGroup[]>>
  setActiveGroupId: React.Dispatch<React.SetStateAction<string | null>>
  patchGroup: (groupId: string, patch: (g: PaneGroup) => PaneGroup) => void
  closeTab: (id: string) => void
  activateTab: (id: string) => void
}): {
  /** 页签右键「翻译成…」的唯一入口:预览签开/聚焦译文镜像签,译文签就地换语种 */
  translateTab: (source: PaneTab, lang: string) => void
} {
  const { groups, activeGroup, result, setGroups, setActiveGroupId, patchGroup } = deps
  const { closeTab, activateTab } = deps

  // 翻译镜像签(与原文并排):同一(文件+语种)全应用只一张;
  // 原文留在原组,镜像优先落到另一组;只有一组就当场向右拆一组。
  function openTranslationTab(source: PaneTab, lang: string): void {
    if (source.relPath === '') return
    const mine = (t: PaneTab): boolean =>
      t.kind === 'translate' && t.relPath === source.relPath && t.lang === lang
    const owner = groups.find((g) => g.tabs.some(mine))
    if (owner) {
      const slot = owner.tabs.find(mine)
      if (!slot) return
      setActiveGroupId(owner.id)
      patchGroup(owner.id, (g) => ({ ...g, activeId: slot.id }))
      return
    }
    const mirror: PaneTab = {
      id: nextTabId(),
      kind: 'translate',
      relPath: source.relPath,
      name: translationTabName(source.relPath, lang),
      icon: KIND_ICONS.translate,
      lang
    }
    const from = groups.find((g) => g.tabs.some((t) => t.id === source.id)) ?? activeGroup
    const host = from ? groupHost(from) : MAIN_HOST
    const other = groups.find((g) => groupHost(g) === host && g.id !== from?.id) ?? null
    if (other) {
      patchGroup(other.id, (g) => ({ ...g, tabs: [...g.tabs, mirror], activeId: mirror.id }))
      setActiveGroupId(other.id)
      return
    }
    const spawned: PaneGroup = {
      id: `pane:${nextTabId()}`,
      tabs: [],
      activeId: null,
      host: host === MAIN_HOST ? undefined : host
    }
    setGroups((prev) => {
      const idx = from ? prev.findIndex((g) => g.id === from.id) : prev.length - 1
      const at = Math.max(0, idx + 1)
      const next = [...prev.slice(0, at), spawned, ...prev.slice(at)]
      return next.map((g) =>
        g.id === spawned.id ? { ...g, tabs: [mirror], activeId: mirror.id } : g
      )
    })
    setActiveGroupId(spawned.id)
  }

  // 译文签就地换语种:同一张签换 lang 与名牌,组位/分屏一概不动。
  // 目标语种已经有同源译文签 = 同一份内容不摆两张,领过去并关掉当前这张;
  // 旧语种还在跑的任务掐断(关签同款),已译完的留在账上当缓存,切回来直接看。
  function changeTranslationLang(tabId: string, lang: string): void {
    const owner = groups.find((g) => g.tabs.some((t) => t.id === tabId))
    const tab = owner?.tabs.find((t) => t.id === tabId)
    if (!owner || !tab || tab.kind !== 'translate' || tab.lang === lang) return
    if (translateLang(lang) === null) return
    const duplicate = groups
      .flatMap((g) => g.tabs)
      .find(
        (t) =>
          t.kind === 'translate' && t.id !== tabId && t.relPath === tab.relPath && t.lang === lang
      )
    if (duplicate) {
      closeTab(tabId)
      activateTab(duplicate.id)
      return
    }
    if (result && tab.lang !== undefined) {
      cancelTranslate(translateKey(result.rootPath, tab.relPath, tab.lang))
    }
    patchGroup(owner.id, (g) => ({
      ...g,
      tabs: g.tabs.map((t) =>
        t.id === tabId ? { ...t, lang, name: translationTabName(t.relPath, lang) } : t
      )
    }))
  }

  function translateTab(source: PaneTab, lang: string): void {
    if (source.kind === 'translate') changeTranslationLang(source.id, lang)
    else openTranslationTab(source, lang)
  }

  return { translateTab }
}
