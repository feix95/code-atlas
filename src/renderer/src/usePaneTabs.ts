// 页签系统(小葵的页签模型·文件签版):文件签绑死文件、单例签绑死品类,
// 分组/拖放分屏/关闭接力照旧。选中的文件、扫描结果、公用对话场这些外来户由调用方递进来。
import { useCallback, useRef, useState } from 'react'
import type { FreechatHost, ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import { isFileKind, isSingletonKind, KIND_ICONS, KIND_LABELS, type PaneKind } from './paneKinds'
import { loadPaneSplit, savePaneSplit } from './layoutPrefs'
import { useFlashValue } from './useFlashFlag'
import { dirChainOf } from './scanTreeTools'
import { clampPaneSplit, nextTabId, type PaneGroup, type PaneTab } from './paneTabs'
import type { AiChatApi } from './useAiChat'
import type { AiTurn } from './useAiAsk'

const FLASH_TAB_MS = 1_200 // 需要指路时页签闪一下(比如挂引用时提示探针签在哪)

export function usePaneTabs(deps: {
  result: ScanResult | null
  chat: AiChatApi
  freechatHost: FreechatHost
  setRevealPaths: React.Dispatch<React.SetStateAction<Set<string>>>
}) {
  const { result, chat, freechatHost, setRevealPaths } = deps

  // 右栏页签(小葵的页签模型·文件签版):文件签 = 绑死某个文件的预览,同一文件只此一张;
  // 单例签 = 概览/小探针/图谱/设置,每品类全应用只此一张。树里点文件只开签不换签
  const [groups, setGroups] = useState<PaneGroup[]>([])

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  // 左右两组的比例(左边占多少),分割条拖完记进本机
  const [paneSplit, setPaneSplit] = useState(loadPaneSplit)
  // 拖页签时的落点标记:正悬在哪个组正文的哪个区 —— 中心(拆两栏/挪组)或左右缘(定向拆半屏)。
  // 指针拖拽引擎(TopBarTabs)只在松手有动作时才设它,PaneGroups 见标记就亮提示,不用二次判
  const [dropMark, setDropMark] = useState<{
    groupId: string
    zone: 'center' | 'left' | 'right'
  } | null>(null)
  // 刚被点名的页签(比如挂了引用要指给用户看探针签在哪):轻强调一下,不弹窗不出声
  const [flashTabId, flashTab, dismissTabFlash] = useFlashValue<string | null>(null)

  // 自由对话的公用场(第一百二十四锤的老规矩原样保留):全 app 一份,挂在 App 顶层 ——
  // 换文件、换文件夹、切页签,聊天记录都活着
  // 激活组 = 用户最后点的那组:新签开在这组,另一组不被打扰
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0] ?? null
  // 可见清单:小探针飞出去当桌宠时,面板里这张签连签带正房一起隐去(互斥铁律两边都不留分身)
  const visibleOfGroup = useCallback(
    (g: PaneGroup | null) =>
      g ? g.tabs.filter((t) => !(freechatHost === 'pet' && t.kind === 'chat')) : [],
    [freechatHost]
  )
  // 页签拖出主窗松手 = 放出小探针(只有探针签能走;窗外判定在主进程)
  const onTabDragEnd = useCallback(
    (id: string) => {
      const t = groups.flatMap((g) => g.tabs).find((x) => x.id === id)
      if (t?.kind === 'chat') window.atlas.freechatDetach()
    },
    [groups]
  )
  // 页签右键「放到桌面」= 不拖也放(force:主进程跳过窗外判定,桌宠落记忆位;
  // 菜单项只对小探针页签露脸,不用再看是谁)
  const onDetachTab = useCallback((_id: string) => {
    window.atlas.freechatDetach(true)
  }, [])

  // 单例签造牌:名和图标从品类户口领
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
  // 工作区外的账不带走 —— 单例签与盘符下钻的瞄签挪进新组继续开着
  function resetPaneTabs(): void {
    const gid = `pane:${nextTabId()}`
    setGroups((prev) => {
      const keep = prev.flatMap((g) => g.tabs).filter((t) => t.kind !== 'preview')
      return [{ id: gid, tabs: keep, activeId: keep.length > 0 ? keep[keep.length - 1].id : null }]
    })
    setActiveGroupId(gid)
  }

  // ── 页签层(小葵的页签模型·文件签版:文件签 + 单例签 + 左右分组) ──

  // 只改某一组的账,别的组一个手指都不碰
  function patchGroup(groupId: string, patch: (g: PaneGroup) => PaneGroup): void {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? patch(g) : g)))
  }

  // 一张组都没有时立个空组:首页点开设置、盘符下钻瞄文件,孤零零一张签也立得起来
  function ensureGroup(): PaneGroup {
    if (activeGroup) return activeGroup
    const fresh: PaneGroup = { id: `pane:${nextTabId()}`, tabs: [], activeId: null }
    setGroups((prev) => [...prev, fresh])
    setActiveGroupId(fresh.id)
    return fresh
  }

  // 需要指路时给页签一点轻强调(小葵点的,别做得太静默):不弹窗、不出声,签卡上闪一下
  function markFlash(id: string): void {
    flashTab(id, FLASH_TAB_MS)
  }

  // 页签指向工作区文件时,树里顺势照过来:父目录链展开+滚到可见
  function revealTab(t: PaneTab): void {
    if (t.kind === 'preview' && t.relPath !== '' && result) {
      setRevealPaths(new Set(dirChainOf(result.tree, t.relPath)))
    }
  }

  // 文件签(小葵拍板):树里点文件就开它。同一文件全应用只此一张 ——
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

  // 概览 AI 卡的「去追问」(小葵拍的):不是跳过去重问一遍,是把卡里解释好的一轮原样搬进
  // 公用对话当垫底,追问才接得上。同一轮只搬一次;解释还在写/探针正答话就先垫句灰字,
  // 等消停了再点一次;还没解释过就光跳页签 —— 那边带着文件资料,想问啥直接问
  const adoptedTurnsRef = useRef<Set<string>>(new Set())
  function goAskInChat(node: ScanFileNode | ScanDirNode | null, turn: AiTurn | null): void {
    openSingletonTab('chat')
    if (!turn) return
    if (turn.state === 'busy') {
      chat.note('概览的解释还在写,等它写完再点一次「去追问」,整段搬过来')
      return
    }
    if (chat.busy) {
      chat.note('探针正答着话,这句答完再点一次「去追问」,解释就搬得过来')
      return
    }
    if (turn.state !== 'done' || turn.text.trim() === '' || adoptedTurnsRef.current.has(turn.key))
      return
    adoptedTurnsRef.current.add(turn.key)
    // 问句没点名(通用解释)就替它把对象写上:对话里翻账本不用猜讲的是谁
    const fallback =
      node === null
        ? '解释一下当前选中的对象'
        : node.type === 'file'
          ? `解释一下 ${node.name}`
          : `用大白话讲讲 ${node.name || '项目根目录'} 这个文件夹`
    chat.adopt(turn.question ?? fallback, turn.text)
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
    let dstId = from.id
    if (toGroup === 'sibling') {
      const other = groups.find((g) => g.id !== from.id) ?? null
      if (other) {
        dstId = other.id
      } else if (groups.length === 1 && from.tabs.length > 1) {
        const spawned: PaneGroup = { id: `pane:${nextTabId()}`, tabs: [], activeId: null }
        setGroups((prev) => (splitSide === 'left' ? [spawned, ...prev] : [...prev, spawned]))
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
      // 小葵拍的扑克牌逻辑) —— 不落的话指针成死引用,组里明明还有牌,正文却亮空底板
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

  function closeTab(id: string): void {
    const owner = groups.find((g) => g.tabs.some((t) => t.id === id))
    if (!owner) return
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
    bar.setPointerCapture(e.pointerId)
    document.body.classList.add('is-sash-dragging')
    const move = (ev: PointerEvent): void => {
      const host = bar.parentElement
      if (!host) return
      const rect = host.getBoundingClientRect()
      applyPaneSplit((ev.clientX - rect.left) / rect.width)
    }
    const up = (): void => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
      document.body.classList.remove('is-sash-dragging')
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
  }

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
    openSingletonTab,
    goAskInChat,
    moveTab,
    activateTab,
    closeTab,
    markFlash,
    applyPaneSplit,
    onPaneSashDown,
    onTabDragEnd,
    onDetachTab
  }
}
