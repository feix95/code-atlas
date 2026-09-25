// 页签系统(小葵的页签模型):品类/跟随/钉住/分组/拖放分屏,全在这一个钩子里。
// 选中的文件、扫描结果、公用对话场(chat)这些外来户由调用方递进来。
import { useCallback, useRef, useState } from 'react'
import type { FreechatHost, ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import {
  FOLLOW_KINDS,
  isMenuKind,
  KIND_CAPS,
  KIND_ICONS,
  KIND_LABELS,
  loadEnabledKinds,
  saveEnabledKinds,
  type PaneKind
} from './paneKinds'
import { loadPaneSplit, savePaneSplit } from './layoutPrefs'
import { useFlashValue } from './useFlashFlag'
import { dirChainOf, findDir, findFile } from './scanTreeTools'
import { clampPaneSplit, nextTabId, type PaneGroup, type PaneTab } from './paneTabs'
import type { AiChatApi } from './useAiChat'
import type { AiTurn } from './useAiAsk'

const FLASH_TAB_MS = 1_200 // 系统自动勾回品类时页签闪一下指路

export function usePaneTabs(deps: {
  result: ScanResult | null
  selectedFile: ScanFileNode | null
  selectedFolder: ScanDirNode | null
  chat: AiChatApi
  freechatHost: FreechatHost
  setRevealPaths: React.Dispatch<React.SetStateAction<Set<string>>>
}) {
  const { result, selectedFile, selectedFolder, chat, freechatHost, setRevealPaths } = deps

  // 右栏页签(小葵的页签模型):页签分品类住进页签组,没钉的跟着树走,钉住的定在原地;
  // 品类显示开关记进本机,页签实例留着(取消勾选只是藏起来,再勾上连钉住状态都回来)
  const [groups, setGroups] = useState<PaneGroup[]>([])

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  // 左右两组的比例(左边占多少),分割条拖完记进本机
  const [paneSplit, setPaneSplit] = useState(loadPaneSplit)
  // 拖页签时的落点标记:正悬在哪个组的正文中心(中心松手=分屏/挪组,边缘松手=什么也不发生)
  const [dropMark, setDropMark] = useState<{ groupId: string; center: boolean } | null>(null)
  // 正被拖着的页签(dragOver 时浏览器不给读 dataTransfer,来源判断全靠它)
  const [draggingTab, setDraggingTab] = useState<string | null>(null)

  // 正文中心的分屏提示只在该有动作的时候亮:单组拆两栏,或拖的是别组页签;
  // 两组还拖自己组的页签在自己组中心晃,松手也没动作,就不许诺空头支票
  function showDropHint(groupId: string): boolean {
    if (!draggingTab) return false
    if (groups.length === 1) return true
    return groups.some((g) => g.id !== groupId && g.tabs.some((t) => t.id === draggingTab))
  }
  const [enabledKinds, setEnabledKinds] = useState<Set<PaneKind>>(loadEnabledKinds)
  // 系统自动勾回品类时刚点亮的那张页签:轻强调一下让用户察觉(小葵点的,别做得太静默)
  const [flashTabId, flashTab, dismissTabFlash] = useFlashValue<string | null>(null)

  // 自由对话的公用场(第一百二十四锤的老规矩原样保留):全 app 一份,挂在 App 顶层 ——
  // 换文件、换文件夹、切页签,聊天记录都活着;钉住对话页签时才把记录分家给新页签
  // 激活组 = 用户最后点的那组:树里点东西,跟随页签只在激活组里转向,另一组不被打扰
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0] ?? null
  const visibleOfGroup = useCallback(
    (g: PaneGroup | null) =>
      g
        ? g.tabs.filter(
            (t) =>
              // 菜单外品类(图谱等单例签)不归勾选管,永远可见
              (isMenuKind(t.kind) ? enabledKinds.has(t.kind) : true) &&
              !(freechatHost === 'pet' && t.kind === 'chat' && !t.pinned)
          )
        : [],
    [enabledKinds, freechatHost]
  )
  const activeTabObj = activeGroup?.tabs.find((t) => t.id === activeGroup.activeId) ?? null

  // 页签拖出主窗松手 = 放出小探针(只有没钉住的公用场页签能走;窗外判定在主进程)
  const onTabDragEnd = useCallback(
    (id: string) => {
      const t = groups.flatMap((g) => g.tabs).find((x) => x.id === id)
      if (t?.kind === 'chat' && !t.pinned) window.atlas.freechatDetach()
    },
    [groups]
  )
  // 页签右键「放到桌面」= 不拖也放(force:主进程跳过窗外判定,桌宠落记忆位;
  // 菜单项只对小探针页签露脸,不用再看是谁)
  const onDetachTab = useCallback((_id: string) => {
    window.atlas.freechatDetach(true)
  }, [])

  // 按品类造一张页签:跟随页签挂品类名牌(装着谁看正文头部,页签栏才分得清品类);
  // node 只提供 relPath(空 = 空槽,等双击文件/点树再装)
  function paneTabFor(kind: PaneKind, node: ScanFileNode | ScanDirNode | null): PaneTab {
    return {
      id: nextTabId(),
      kind,
      relPath: node?.relPath ?? '',
      name: KIND_LABELS[kind],
      icon: KIND_ICONS[kind],
      pinned: false
    }
  }

  // 开一张新图/回家时页签重置:单组,概览+探针两张跟随页签就位(勾着的品类才可见),
  // 激活可见的第一张;预览不预开 —— 双击文件才开
  function resetPaneTabs(): void {
    const overview = paneTabFor('overview', null)
    const probe = paneTabFor('chat', null)
    const group: PaneGroup = {
      id: `pane:${nextTabId()}`,
      tabs: [overview, probe],
      activeId: enabledKinds.has('overview')
        ? overview.id
        : enabledKinds.has('chat')
          ? probe.id
          : null
    }
    setGroups([group])
    setActiveGroupId(group.id)
  }

  // ── 页签层(小葵的页签模型:品类页签 + 双击钉住 + 空白右键品类菜单 + 左右分组) ──

  // 只改某一组的账,别的组一个手指都不碰
  function patchGroup(groupId: string, patch: (g: PaneGroup) => PaneGroup): void {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? patch(g) : g)))
  }

  // 系统自动勾回品类时给刚亮起的页签一点轻强调:让用户察觉「设置刚被自动改了」,
  // 过几天不会莫名其妙 —— 不弹窗、不出声,就是页签卡上闪一下(小葵点的细节)
  function markFlash(id: string): void {
    flashTab(id, FLASH_TAB_MS)
  }

  // 钉住瞬间页签该固化的门面:换成具体节点的名和图标,分得清钉的是谁;节点没了退回品类名牌
  function solidFace(kind: PaneKind, relPath: string): { name: string; icon: string } {
    const f = relPath === '' ? null : result ? findFile(result.tree, relPath) : null
    if (f) return { name: f.name, icon: f.summary?.icon ?? 'file' }
    const d =
      relPath === '' ? (result?.tree ?? null) : result ? findDir(result.tree, relPath) : null
    if (d) return { name: d.name || result?.rootName || KIND_LABELS[kind], icon: 'folder' }
    return { name: KIND_LABELS[kind], icon: KIND_ICONS[kind] }
  }

  // 让某品类的页签在激活组里亮起来装着 node:有跟随页签就确认内容到位,没有(被钉死/被关了/被藏了)
  // 就新开一张 —— 钉住的那张永远不碰,这正是「固定了,新内容额外新开一张」的来由。
  // auto = 入口撞上被关掉的品类,系统自动勾回来:顺带给页签一点轻强调
  function ensureKindTab(
    kind: PaneKind,
    node: ScanFileNode | ScanDirNode | null,
    auto = false
  ): void {
    // 只有菜单品类才有「入口撞上被关掉的品类就自动勾回」;菜单外的单例签不用过这道闸
    if (isMenuKind(kind) && !enabledKinds.has(kind)) {
      const next = new Set(enabledKinds)
      next.add(kind)
      setEnabledKinds(next)
      saveEnabledKinds(next)
    }
    // 公用品类全系统只此一张(小葵拍的):先满屋子找没钉的同类页签,在哪组就把哪组点亮领过去;
    // 哪组都没有才在激活组新开一张。钉住的不算数 —— 那是分家的独立对话
    const owner = groups.find((g) => g.tabs.some((t) => t.kind === kind && !t.pinned))
    if (owner) {
      const slot = owner.tabs.find((t) => t.kind === kind && !t.pinned)
      if (slot) {
        setActiveGroupId(owner.id)
        patchGroup(owner.id, (g) => ({
          ...g,
          tabs: g.tabs.map((t) => (t.id === slot.id ? { ...t, relPath: node?.relPath ?? '' } : t)),
          activeId: slot.id
        }))
        if (auto) markFlash(slot.id)
        return
      }
    }
    const group = activeGroup
    if (!group) return
    const tab = paneTabFor(kind, node)
    patchGroup(group.id, (g) => ({ ...g, tabs: [...g.tabs, tab], activeId: tab.id }))
    if (auto) markFlash(tab.id)
  }

  // 概览 AI 卡的「去追问」(小葵拍的):不是跳过去重问一遍,是把卡里解释好的一轮原样搬进
  // 公用对话当垫底,追问才接得上。同一轮只搬一次;解释还在写/探针正答话就先垫句灰字,
  // 等消停了再点一次;还没解释过就光跳页签 —— 那边带着文件资料,想问啥直接问
  const adoptedTurnsRef = useRef<Set<string>>(new Set())
  function goAskInChat(node: ScanFileNode | ScanDirNode | null, turn: AiTurn | null): void {
    ensureKindTab('chat', node)
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

  // 激活组里的跟随页签全员转向:没钉的页签都是「当前选中的镜子」,树里点谁它们的 relPath
  // 一起换过去(名字图标不动 —— 页签栏挂的是品类名牌);钉住的不碰,另一组也不被波及。
  // 节点类型用不上的品类(preview 撞上文件夹)不跟,安分守己
  function retargetFollowTabs(node: ScanFileNode | ScanDirNode): void {
    if (!activeGroup) return
    const caps = KIND_CAPS[node.type === 'file' ? 'file' : 'directory']
    patchGroup(activeGroup.id, (g) => ({
      ...g,
      tabs: g.tabs.map((t) =>
        !t.pinned && caps.includes(t.kind) ? { ...t, relPath: node.relPath } : t
      )
    }))
  }

  // 跟随型品类(概览/探针)的页签被 × 掉了:树里一动就自动补回来,装着当前的对象 ——
  // 勾着显示的品类,跟随页签就该在栏上(小葵拍板);预览是按需品类,不在此列。
  // 补齐和点亮要点亮目标必须一把成:分两次 setState 各读各的旧账本,同一张概览会生两张
  function ensureFollowTabs(node: ScanFileNode | ScanDirNode, activateKind?: PaneKind): void {
    if (!activeGroup) return
    const gid = activeGroup.id
    const caps = KIND_CAPS[node.type === 'file' ? 'file' : 'directory']
    // 「有没有」看全系统(小葵报的案):公用品类哪组有一张就不补第二张
    const exists = (k: PaneKind): boolean =>
      groups.some((gr) => gr.tabs.some((t) => t.kind === k && !t.pinned))
    const missing = FOLLOW_KINDS.filter(
      (k) => enabledKinds.has(k) && caps.includes(k) && !exists(k)
    )
    if (
      activateKind &&
      !exists(activateKind) &&
      !missing.includes(activateKind) &&
      caps.includes(activateKind)
    ) {
      missing.push(activateKind)
    }
    let focusId: string | null = null
    if (missing.length > 0) {
      const spawned = missing.map((k) => paneTabFor(k, node))
      focusId = (activateKind && spawned[missing.indexOf(activateKind)]?.id) || null
      patchGroup(gid, (g) => ({
        ...g,
        tabs: [...g.tabs, ...spawned],
        activeId: focusId ?? g.activeId
      }))
    }
    // 点亮目标不是这轮新生的:它已站在激活组里(kind 取自激活页签),点亮即可
    if (activateKind && !focusId) {
      const slot = activeGroup.tabs.find((t) => t.kind === activateKind && !t.pinned)
      if (slot && slot.id !== activeGroup.activeId) {
        patchGroup(gid, (g) => ({ ...g, activeId: slot.id }))
      }
    }
  }

  // 品类开关(页签栏空白右键的菜单):勾 = 显示这个品类,不勾 = 藏起来。
  // 藏只是藏,页签实例连着钉住状态一起留着,再勾上原样回来
  function toggleKind(kind: PaneKind, on: boolean): void {
    if (on) {
      if (!enabledKinds.has(kind)) {
        const next = new Set(enabledKinds)
        next.add(kind)
        setEnabledKinds(next)
        saveEnabledKinds(next)
      }
      ensureKindTab(kind, selectedFile ?? selectedFolder, true)
      return
    }
    const next = new Set(enabledKinds)
    next.delete(kind)
    setEnabledKinds(next)
    saveEnabledKinds(next)
    // 藏的正好是激活组正亮着的品类:就近挪到组里剩下的可见页签;
    // 这组的页签因此全被藏了就删组(至少留一组当底板)
    if (activeTabObj?.kind === kind && activeGroup) {
      const rest = visibleOfGroup(activeGroup).filter((t) => t.kind !== kind)
      if (rest.length > 0) {
        patchGroup(activeGroup.id, (g) => ({ ...g, activeId: rest[rest.length - 1].id }))
      } else if (groups.length > 1) {
        const survivors = groups.filter((g) => g.id !== activeGroup.id)
        setGroups(survivors)
        setActiveGroupId(survivors[0]?.id ?? null)
      } else {
        patchGroup(activeGroup.id, (g) => ({ ...g, activeId: null }))
      }
    }
  }

  // 挪页签(拖拽/页签右键「挪组」):toGroup='sibling' 去另一组(单组时=往右拆一组),
  // atIndex 空 = 落到那组末尾;搬空的组自己消亡,聚焦跟到目标组
  function moveTab(id: string, toGroup: 'sibling' | null, atIndex: number | null): void {
    const from = groups.find((g) => g.tabs.some((t) => t.id === id))
    if (!from) return
    let dstId = from.id
    if (toGroup === 'sibling') {
      const other = groups.find((g) => g.id !== from.id) ?? null
      if (other) {
        dstId = other.id
      } else if (groups.length === 1 && from.tabs.length > 1) {
        const spawned: PaneGroup = { id: `pane:${nextTabId()}`, tabs: [], activeId: null }
        setGroups((prev) => [...prev, spawned])
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
    if (moved?.relPath && result) setRevealPaths(new Set(dirChainOf(result.tree, moved.relPath)))
  }

  // 页签操作:激活(点亮所在组,树里顺势照过来)、双击钉住/拆钉(对话分家规矩在里面)、
  // 关闭(组内接力,组搬空自己消亡)
  function activateTab(id: string): void {
    const owner = groups.find((g) => g.tabs.some((t) => t.id === id))
    if (!owner) return
    const t = owner.tabs.find((x) => x.id === id)
    if (!t) return
    setActiveGroupId(owner.id)
    patchGroup(owner.id, (g) => ({ ...g, activeId: id }))
    // 点亮页签时树里顺势照过来:父目录链展开+滚到可见 —— 点钉住的旧文件也能在树里找到家
    if (t.relPath && result) setRevealPaths(new Set(dirChainOf(result.tree, t.relPath)))
  }

  function pinToggleTab(id: string): void {
    const owner = groups.find((g) => g.tabs.some((t) => t.id === id))
    const t = owner?.tabs.find((x) => x.id === id)
    if (!owner || !t) return
    const flip = (patch: (x: PaneTab) => PaneTab): void => {
      patchGroup(owner.id, (g) => ({ ...g, tabs: g.tabs.map((x) => (x.id === id ? patch(x) : x)) }))
    }
    if (!t.pinned) {
      // 钉住 = 固化门面:页签名换成具体节点,树里再怎么换它都是这张脸
      const face = solidFace(t.kind, t.relPath)
      if (t.kind === 'chat') {
        // 探针正说着话就先别钉:分家会把半截回答留在公用场,钉出去的页签缺尾巴
        if (chat.busy) {
          chat.note('探针正说着话,等这句答完再钉')
          return
        }
        if (chat.messages.length > 0) {
          // 钉住 = 这场对话分家单过:记录搬给这张页签,公用场清空从头聊 ——
          // 之后树里点新文件,新开的探针页签就是新对话(小葵拍的规定死)
          const seed = chat.messages.slice()
          flip((x) => ({ ...x, pinned: true, seed, ...face }))
          chat.newChat()
          return
        }
      }
      flip((x) => ({ ...x, pinned: true, ...face }))
      return
    }
    if (t.kind === 'chat') {
      // 对话页签不拆钉:拆了它的记录没地方挂,会害用户丢对话
      chat.note('钉住的对话不拆钉:想聊新的,点聊天面板里的「新对话」,或者关掉这张页签再开')
      return
    }
    // 拆钉 = 变回跟随页签:挂回品类名牌,立刻转向当前选中的对象(类型对得上才转),别端着旧内容
    const node = selectedFile ?? selectedFolder
    const caps = node ? KIND_CAPS[node.type === 'file' ? 'file' : 'directory'] : null
    const relPath = node && caps && caps.includes(t.kind) ? node.relPath : t.relPath
    flip((x) => ({
      ...x,
      pinned: false,
      relPath,
      name: KIND_LABELS[t.kind],
      icon: KIND_ICONS[t.kind]
    }))
  }

  function closeTab(id: string): void {
    const owner = groups.find((g) => g.tabs.some((t) => t.id === id))
    if (!owner) return
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
    // 关的是激活页签:右邻优先接力,左邻兜底,全空回底板(VS Code 同款)。
    // 钉住的对话页签关掉 = 那场对话跟着蒸发(纯内存,记录不落盘)
    const nextActiveId = wasActive
      ? (nextVis[idx]?.id ?? nextVis[idx - 1]?.id ?? null)
      : owner.activeId
    patchGroup(owner.id, (g) => ({
      ...g,
      tabs: g.tabs.filter((t) => t.id !== id),
      activeId: nextActiveId
    }))
    if (wasActive && nextActiveId && result)
      setRevealPaths(new Set(dirChainOf(result.tree, nextActiveId)))
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
    activeTabObj,
    visibleOfGroup,
    enabledKinds,
    flashTabId,
    dismissTabFlash,
    paneSplit,
    draggingTab,
    setDraggingTab,
    dropMark,
    setDropMark,
    paneTabFor,
    resetPaneTabs,
    ensureKindTab,
    goAskInChat,
    retargetFollowTabs,
    ensureFollowTabs,
    toggleKind,
    moveTab,
    activateTab,
    pinToggleTab,
    closeTab,
    markFlash,
    applyPaneSplit,
    onPaneSashDown,
    onTabDragEnd,
    onDetachTab,
    showDropHint
  }
}
