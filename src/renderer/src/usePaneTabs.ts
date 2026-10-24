// 页签系统(小葵的页签模型·文件签版):文件签绑死文件、单例签绑死品类,
// 分组/拖放分屏/关闭接力照旧。选中的文件、扫描结果、公用对话场这些外来户由调用方递进来。
import { useCallback, useState } from 'react'
import type { ScanFileNode, ScanResult } from '@shared/types'
import { isFileKind, isSingletonKind, KIND_ICONS, KIND_LABELS, type PaneKind } from './paneKinds'
import { cancelAllTranslations } from './translateStore'
import { loadPaneSplit, savePaneSplit } from './layoutPrefs'
import { useFlashValue } from './useFlashFlag'
import { createTabCloser } from './paneTabClose'
import { createTranslationActions } from './paneTabTranslation'
import { dirChainOf } from './scanTreeTools'
import {
  clampPaneSplit,
  dropHostGroups,
  groupHost,
  MAIN_HOST,
  moveTabToGroupAt,
  moveTabToHost,
  nextTabId,
  resetWorkspaceGroups,
  type PaneDropMark,
  type PaneGroup,
  type PaneTab
} from './paneTabs'

const FLASH_TAB_MS = 1_200 // 需要指路时页签闪一下(比如挂引用时提示探针签在哪)

export function usePaneTabs(deps: {
  result: ScanResult | null
  /** 开一扇独立子窗(页签独立窗口):返回 frameName 登记;null = 窗口开不出,签别挪 */
  openAuxWindow: () => string | null
  setRevealPaths: React.Dispatch<React.SetStateAction<Set<string>>>
}) {
  const { result, openAuxWindow, setRevealPaths } = deps

  // 右栏页签(小葵的页签模型·文件签版):文件签 = 绑死某个文件的预览,同一文件只此一张;
  // 单例签 = 概览/小探针/图谱/设置,每品类全应用只此一张。树里点文件只开签不换签
  const [groups, setGroups] = useState<PaneGroup[]>([])

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  // 左右两组的比例(左边占多少),分割条拖完记进本机
  const [paneSplit, setPaneSplit] = useState(loadPaneSplit)
  // 拖页签时的落点标记:正悬在哪个组正文的左右缘 —— 只用于定向拆半屏。
  // 指针拖拽引擎(TopBarTabs)只在松手有动作时才设它,PaneGroups 见标记就亮提示,不用二次判
  const [dropMark, setDropMark] = useState<PaneDropMark | null>(null)
  // 刚被点名的页签(比如挂了引用要指给用户看探针签在哪):轻强调一下,不弹窗不出声
  const [flashTabId, flashTab, dismissTabFlash] = useFlashValue<string | null>(null)

  // 自由对话的公用场(的老规矩原样保留):全 app 一份,挂在 App 顶层 ——
  // 换文件、换文件夹、切页签,聊天记录都活着
  // 激活组 = 用户最后点的那组:新签开在这组,另一组不被打扰
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0] ?? null
  // 可见清单:页签栏照全量画(桌宠藏签那套已随形态机一起拆)
  const visibleOfGroup = useCallback((g: PaneGroup | null) => g?.tabs ?? [], [])

  // 拆出独立窗口(Obsidian 式):页签挪进新开的同进程子窗 —— 组挂 host 登记,
  // 签的页签活 DOM由 Portal 渲染进子窗 document,流式回答/滚动位/草稿状态保持迁移
  const detachTabToWindow = useCallback(
    (id: string): void => {
      const hostId = openAuxWindow()
      if (!hostId) return // 窗开不出,签原地不动
      const moved = moveTabToHost(groups, id, hostId)
      if (!moved) return
      setGroups(moved.groups)
      setActiveGroupId(moved.activeGroupId)
    },
    [openAuxWindow, groups]
  )
  // 页签拖出窗外松手 = 拆去新窗;子窗里的签拖出子窗同样再开一扇(Chrome 语义)
  const onTabDragEnd = useCallback((id: string) => detachTabToWindow(id), [detachTabToWindow])
  // 页签右键「移到新窗口」= 不拖也可拆出,所有签一视同仁
  const onDetachTab = useCallback((id: string) => detachTabToWindow(id), [detachTabToWindow])

  /**
   * 跨窗拖拽落账(页签跨窗口):落到目标窗指定组的指定位置。
   * groupId 为空 = 目标窗没有可落组,由纯函数现立;atIndex 为空 = 追加到末尾。
   */
  function moveTabToHostAt(
    id: string,
    host: string,
    groupId: string | null,
    atIndex: number | null
  ): void {
    const moved = moveTabToGroupAt(groups, id, groupId, host, atIndex)
    if (!moved) return
    setGroups(moved.groups)
    setActiveGroupId(moved.activeGroupId)
    const tab = groups.flatMap((g) => g.tabs).find((t) => t.id === id)
    if (tab) revealTab(tab)
  }

  // 子窗死了(pagehide 上报):它名下的签连组一起关闭并清理 —— Chrome 语义,关窗即关签
  const closeHostGroups = useCallback((hostId: string): void => {
    setGroups((prev) => dropHostGroups(prev, hostId))
  }, [])

  // 单例签造牌:名和图标从品类登记领
  function singletonTab(kind: PaneKind): PaneTab {
    return { id: nextTabId(), kind, relPath: '', name: KIND_LABELS[kind], icon: KIND_ICONS[kind] }
  }

  // 文件签造牌:签脸 = 文件名 + 文件图标;scopeRoot 只在盘符下钻时填(读根不是工作区)
  function fileTab(file: ScanFileNode, scopeRoot?: string): PaneTab {
    return {
      id: nextTabId(),
      kind: scopeRoot ? 'peek' : 'preview',
      relPath: file.relPath,
      name: file.name,
      icon: file.summary?.icon ?? 'file',
      scopeRoot
    }
  }

  // 开一张新图/回家时页签重置:换一个空组,等文件签上岗。
  // 工作区外的账不带走 —— 单例签与盘符下钻的瞄签挪进新组继续开着;
  // 拆去子窗的签按登记分窝还原,别把子窗的签卷回主窗
  function resetPaneTabs(): void {
    // 译文签绑的是旧工作区的文件与译文:换区一起关闭,在跑的任务掐断
    cancelAllTranslations()
    setGroups((prev) => {
      const reset = resetWorkspaceGroups(prev)
      setActiveGroupId(reset.activeGroupId)
      return reset.groups
    })
  }

  // 页签层(小葵的页签模型·文件签版:文件签 + 单例签 + 左右分组)

  // 只改某一组的账,别的组一个手指都不碰
  function patchGroup(groupId: string, patch: (g: PaneGroup) => PaneGroup): void {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? patch(g) : g)))
  }

  // 一张组都没有时立个空组:首页点开设置、盘符下钻瞄文件,孤零零一张签也立得起来。
  // 新组立主窗:子窗的组只由拆出独立窗口一条道出生(moveTabToHost 现立)
  function ensureGroup(): PaneGroup {
    if (activeGroup) return activeGroup
    const fresh: PaneGroup = { id: `pane:${nextTabId()}`, tabs: [], activeId: null }
    setGroups((prev) => [...prev, fresh])
    setActiveGroupId(fresh.id)
    return fresh
  }

  // 需要指路时给页签一点轻强调(产品指定的,别做得太静默):不弹窗、不出声,签卡上闪一下
  function markFlash(id: string): void {
    flashTab(id, FLASH_TAB_MS)
  }

  // 页签指向工作区文件时,树里顺势照过来:父目录链展开+滚到可见
  function revealTab(t: PaneTab): void {
    if (t.kind === 'preview' && t.relPath !== '' && result) {
      setRevealPaths(new Set(dirChainOf(result.tree, t.relPath)))
    }
  }

  // 文件签(产品裁定):树里点文件就开它。同一文件全应用只此一张 ——
  // 已开就领过去点亮(在哪组点亮哪组),没开就在激活组末尾新开;已有页签一概不动。
  // scopeRoot 只给盘符下钻(读根不是工作区,品类记 peek)
  function openFileTab(file: ScanFileNode, scopeRoot?: string): void {
    const mine = (t: PaneTab): boolean =>
      isFileKind(t.kind) && t.relPath === file.relPath && (t.scopeRoot ?? '') === (scopeRoot ?? '')
    const owner = groups.find((g) => g.tabs.some(mine))
    const slot = owner?.tabs.find(mine)
    if (owner && slot) {
      setActiveGroupId(owner.id)
      patchGroup(owner.id, (g) => ({ ...g, activeId: slot.id }))
      return
    }
    const tab = fileTab(file, scopeRoot)
    const group = ensureGroup()
    patchGroup(group.id, (g) => ({ ...g, tabs: [...g.tabs, tab], activeId: tab.id }))
  }

  // 单例签(rail/菜单入口):全应用每品类只此一张 —— 已开就领过去点亮,没开在激活组新开
  function openSingletonTab(kind: PaneKind): void {
    if (!isSingletonKind(kind)) return
    const owner = groups.find((g) => g.tabs.some((t) => t.kind === kind))
    const slot = owner?.tabs.find((t) => t.kind === kind)
    if (owner && slot) {
      setActiveGroupId(owner.id)
      patchGroup(owner.id, (g) => ({ ...g, activeId: slot.id }))
      return
    }
    const tab = singletonTab(kind)
    const group = ensureGroup()
    patchGroup(group.id, (g) => ({ ...g, tabs: [...g.tabs, tab], activeId: tab.id }))
  }

  // 挪页签(拖拽/页签右键「挪组」):toGroup='sibling' 去另一组(单组时=拆一组,默认落右,
  // splitSide='left' 时新组立左 —— 页签拖到左缘就是奔那边去的),atIndex 空 = 落到那组末尾;
  // 搬空的组自己消亡,聚焦跟到目标组
  function moveTab(
    id: string,
    toGroup: 'sibling' | null,
    atIndex: number | null,
    splitSide: 'left' | 'right' = 'right'
  ): void {
    const from = groups.find((g) => g.tabs.some((t) => t.id === id))
    if (!from) return
    const fromHost = groupHost(from)
    const sameHost = groups.filter((g) => groupHost(g) === fromHost)
    let dstId = from.id
    if (toGroup === 'sibling') {
      // 「另一组」只认同一扇窗名下的:跨窗换登记是拆出独立窗口的事(moveTabToHost)
      const other = sameHost.find((g) => g.id !== from.id) ?? null
      if (other) {
        dstId = other.id
      } else if (sameHost.length === 1 && from.tabs.length > 1) {
        const spawned: PaneGroup = {
          id: `pane:${nextTabId()}`,
          tabs: [],
          activeId: null,
          host: fromHost === MAIN_HOST ? undefined : fromHost
        }
        setGroups((prev) => {
          const idx = prev.findIndex((g) => g.id === from.id)
          const at = splitSide === 'left' ? idx : idx + 1
          return [...prev.slice(0, at), spawned, ...prev.slice(at)]
        })
        dstId = spawned.id
      } else {
        return // 就这一张页签,拆不出第二组
      }
    }
    setGroups((prev) => {
      const next = prev.map((g) => ({ ...g, tabs: [...g.tabs] }))
      const src = next.find((g) => g.tabs.some((t) => t.id === id))
      const dst = next.find((g) => g.id === dstId)
      if (!src || !dst) return prev
      const idx = src.tabs.findIndex((t) => t.id === id)
      const moved = src.tabs.splice(idx, 1)[0]
      // 抽走的正好是源组正亮着的那张:激活指针当场落回剩下的页签(末张露出当新顶牌,
      // 产品裁定的激活签回退规则) —— 不落的话指针成死引用,组里明明还有签,正文却亮空底板
      if (src.activeId === id) {
        src.activeId = src.tabs.length > 0 ? src.tabs[src.tabs.length - 1].id : null
      }
      const at =
        atIndex === null || atIndex > dst.tabs.length ? dst.tabs.length : Math.max(0, atIndex)
      dst.tabs.splice(at, 0, moved)
      dst.activeId = moved.id
      // 搬空的组消亡(至少留一组当底板)
      const kept = next.filter((g) => g.tabs.length > 0)
      return kept.length > 0 ? kept : next
    })
    setActiveGroupId(dstId)
    const moved = from.tabs.find((t) => t.id === id)
    if (moved) revealTab(moved)
  }

  // 页签操作:激活(点亮所在组,树里顺势照过来)、关闭(组内接力,组搬空自己消亡)
  function activateTab(id: string): void {
    const owner = groups.find((g) => g.tabs.some((t) => t.id === id))
    if (!owner) return
    const t = owner.tabs.find((x) => x.id === id)
    if (!t) return
    setActiveGroupId(owner.id)
    patchGroup(owner.id, (g) => ({ ...g, activeId: id }))
    // 点亮文件签时树里顺势照过来:父目录链展开+滚到可见
    revealTab(t)
  }

  // 文件改名:开着的文件签就地换登记 —— relPath/名牌换新的,
  // 档位/组位一概不动;登记认 (relPath, scopeRoot) 两件,与开签对账同口径
  function renameFileTab(
    scopeRoot: string | undefined,
    oldRelPath: string,
    newRelPath: string,
    newName: string
  ): void {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) =>
          isFileKind(t.kind) &&
          t.relPath === oldRelPath &&
          (t.scopeRoot ?? '') === (scopeRoot ?? '')
            ? { ...t, relPath: newRelPath, name: newName }
            : t
        )
      }))
    )
  }

  // 两组分割条:拖动调左右比例(左边占比记进本机),双击回对半
  function applyPaneSplit(v: number): void {
    const next = clampPaneSplit(v)
    setPaneSplit(next)
    savePaneSplit(next)
  }

  function onPaneSashDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    const bar = e.currentTarget
    const body = bar.ownerDocument.body // 渲染域隔离:子窗里的分割条挂子窗 body
    bar.setPointerCapture(e.pointerId)
    body.classList.add('is-sash-dragging')
    const move = (ev: PointerEvent): void => {
      const host = bar.parentElement
      if (!host) return
      const rect = host.getBoundingClientRect()
      applyPaneSplit((ev.clientX - rect.left) / rect.width)
    }
    const up = (): void => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
      body.classList.remove('is-sash-dragging')
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
  }

  // 关签与翻译的编排各在自家模块:这里把状态表与本钩子的动作递过去,返回值照旧点名
  const { closeTab, closeTabsInGroup } = createTabCloser({
    groups,
    result,
    visibleOfGroup,
    setGroups,
    setActiveGroupId,
    patchGroup,
    revealTab
  })
  const { translateTab } = createTranslationActions({
    groups,
    activeGroup,
    result,
    setGroups,
    setActiveGroupId,
    patchGroup,
    closeTab,
    activateTab
  })

  return {
    groups,
    setGroups,
    activeGroupId,
    setActiveGroupId,
    activeGroup,
    visibleOfGroup,
    flashTabId,
    dismissTabFlash,
    paneSplit,
    dropMark,
    setDropMark,
    resetPaneTabs,
    openFileTab,
    translateTab,
    openSingletonTab,
    moveTab,
    moveTabToHostAt,
    activateTab,
    closeTab,
    closeTabsInGroup,
    renameFileTab,
    markFlash,
    applyPaneSplit,
    onPaneSashDown,
    onTabDragEnd,
    onDetachTab,
    detachTabToWindow,
    closeHostGroups
  }
}
