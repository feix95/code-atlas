// 工作区生命周期:开图、重扫、回家、图谱、备注与最近项目 —— 全是「当前打开了什么」这一件事。
// 扫描结果与当前路径由调用方持有(搜索、页签、正文都要吃),本钩子只管动作与周边账目。
import { useEffect, useRef, useState } from 'react'
import { refreshNotesForScan, saveNotes, upsertNote, type NoteMap } from '@shared/notes'
import type { ChatCodeRef, DepGraphResult, DriveInfo, ScanResult } from '@shared/types'
import { PATH_HINT_MS, PATH_HINT_TEXT } from './appFeedback'
import { describeDriveChange } from './driveRefresh'
import { cleanErrMsg } from './errText'
import type { NavLocation } from './navHistory'
import type { PaneGroup } from './paneTabs'
import {
  forgetRecentProject,
  readRecentProjects,
  rememberRecentProject,
  toggleRecentPin,
  type RecentProject
} from './recents'
import type { createRequestScope } from './requestScope'
import { useFlashValue } from './useFlashFlag'
import { useRefreshFeedback } from './useRefreshFeedback'

export function useWorkspaceScan(deps: {
  requests: React.RefObject<ReturnType<typeof createRequestScope>>
  folder: string | null
  setFolder: React.Dispatch<React.SetStateAction<string | null>>
  result: ScanResult | null
  setResult: React.Dispatch<React.SetStateAction<ScanResult | null>>
  clearSelection: () => void
  resetExpansion: () => void
  resetPaneTabs: () => void
  setPreviewRefs: React.Dispatch<React.SetStateAction<ChatCodeRef[]>>
  clearSearch: () => void
  pushNav: (loc: NavLocation) => void
  setGroups: React.Dispatch<React.SetStateAction<PaneGroup[]>>
  setActiveGroupId: React.Dispatch<React.SetStateAction<string | null>>
  dismissTabFlash: () => void
  setRevealPaths: React.Dispatch<React.SetStateAction<Set<string>>>
  showToast: (text: string, ms?: number) => void
}) {
  const {
    requests,
    folder,
    setFolder,
    result,
    setResult,
    clearSelection,
    resetExpansion,
    resetPaneTabs,
    setPreviewRefs,
    clearSearch,
    pushNav,
    setGroups,
    setActiveGroupId,
    dismissTabFlash,
    setRevealPaths,
    showToast
  } = deps

  // 首页盘符列表:一开就是「这台电脑」,只问有哪些盘,点哪个盘扫哪个
  const [drives, setDrives] = useState<DriveInfo[] | null>(null)
  const [drivesNote, setDrivesNote] = useState<string | null>(null)
  const [driveRefreshNonce, setDriveRefreshNonce] = useState(0)
  const { refreshing, runRefresh } = useRefreshFeedback(showToast)
  // 最近打开的项目:存 localStorage,开过谁就记谁,首页一排卡片点回去
  const [recents, setRecents] = useState<RecentProject[]>(() => readRecentProjects())
  // 地址栏草稿:跟着已打开的路径走,也能随手改成别的直接回车开图
  const [pathDraft, setPathDraft] = useState('')
  // 空路径点了「前往」:不禁用按钮,点了才提示缺什么(禁用灰在小白眼里像坏了)
  const [pathHint, flashPathHint, dismissPathHint] = useFlashValue<string | null>(null)
  const [pathShaking, setPathShaking] = useState(false)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 手动备注:本项目 relPath → 小葵的一句话;存本机,存上限有孤儿清收
  const [notes, setNotes] = useState<NoteMap>({})
  const [graph, setGraph] = useState<DepGraphResult | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphNote, setGraphNote] = useState<string | null>(null)

  // 开屏列盘符,之后每回退回首页(含 logo 回家)都重列一遍:
  // app 开着的时候插的 U 盘、拔的移动盘,回家永远见得到;重列期间老列表照常摆着,不闪空
  useEffect(() => {
    if (folder) return
    let alive = true
    window.atlas
      .listDrives()
      .then((list) => {
        if (alive) {
          setDrives(list)
          setDrivesNote(null)
        }
      })
      .catch(() => {
        if (alive) setDrivesNote('盘符列不出来,在上方输入文件夹路径一样能开')
      })
    return () => {
      alive = false
    }
  }, [folder])

  // 统一的开图入口:清掉上一张图的旧账,再扫新路径;对话框选的和手输的都走这条。
  // 扫成的图递还给调用方(后退/前进恢复选中要在新树上找人);扫砸了回 null
  async function scanPath(dir: string): Promise<ScanResult | null> {
    requests.current.reset()
    const isCurrent = requests.current.begin('scan')
    resetExpansion()
    clearSelection()
    setGraphLoading(false)
    setFolder(dir)
    setPathDraft(dir)
    dismissPathHint()
    setScanning(true)
    setResult(null)
    setError(null)
    resetPaneTabs()
    setRevealPaths(new Set())
    setPreviewRefs([])
    setGraph(null)
    setGraphNote(null)
    setNotes({})
    // 新工作区 = 新的浏览上下文:搜索词和清单一起清空
    clearSearch()
    try {
      const scanned = await window.atlas.scanFolder(dir)
      if (!isCurrent()) return null
      const root = scanned.rootPath
      setResult(scanned)
      setFolder(root)
      setPathDraft(root)
      // 备注跟上新树:顺带清孤儿(垃圾不越攒越多),再写回本机
      setNotes(refreshNotesForScan(root, scanned.tree))
      // 画成了一张图才算「打开过」:记进最近列表,下次首页一点就回
      setRecents(rememberRecentProject(root))
      // 换了地方就是新的一站;同路径的刷新不算迁移,不记
      if (root !== folder) pushNav({ folder: root, file: null, dir: null })
      setScanning(false)
      return scanned
    } catch (err) {
      if (isCurrent()) setError(cleanErrMsg(err))
      return null
    } finally {
      if (isCurrent()) setScanning(false)
    }
  }

  async function handlePick(): Promise<void> {
    const dir = await window.atlas.pickFolder().catch(() => null)
    if (dir) await scanPath(dir)
  }

  // 刷新 = 开着项目就重扫一遍,在「这台电脑」就重列盘符并重读已展开的目录;
  // 两种场景都经 runRefresh:刷新钮转圈 + Toast 说结果,不留「点了没反应」的沉默
  async function handleRefresh(): Promise<void> {
    if (scanning) return
    await runRefresh(async () => {
      if (folder) return (await scanPath(folder)) ? '已刷新,项目已重新读取' : null
      const list = await window.atlas.listDrives()
      setDrives(list)
      setDrivesNote(null)
      setDriveRefreshNonce((n) => n + 1)
      return describeDriveChange(drives, list)
    })
  }

  // 空路径点了「前往」/回车:聚焦 + 轻晃 + 气泡提示,几秒后自己消失
  function setShakeAndHint(): void {
    setPathShaking(true)
    flashPathHint(PATH_HINT_TEXT, PATH_HINT_MS)
    pathInputRef.current?.focus()
  }

  // 地址栏回车/点「前往」:直接开输进来的路径;粘来的路径常带首尾引号,顺手剥掉
  async function goPath(): Promise<void> {
    if (scanning) return
    const dir = pathDraft
      .trim()
      .replace(/^"+|"+$/g, '')
      .trim()
    if (dir === '') {
      setShakeAndHint()
      return
    }
    await scanPath(dir)
  }

  // logo = 回「这台电脑」:开到多深的项目,一点就退回选盘首页;
  // 上次开的路径留在输入框里,想回这个项目点「前往」就行。没开项目时按钮自己变灰
  function goHome(): void {
    if (!folder) return
    requests.current.reset()
    resetExpansion()
    clearSelection()
    setScanning(false)
    setGraphLoading(false)
    pushNav({ folder: null, file: null, dir: null })
    setGroups([])
    setActiveGroupId(null)
    dismissTabFlash()
    setRevealPaths(new Set())
    setPreviewRefs([])
    setFolder(null)
    setResult(null)
    setError(null)
    setGraph(null)
    setGraphNote(null)
    dismissPathHint()
    setNotes({})
    clearSearch()
  }

  // 存一条手动备注:空串 = 删除;上限和淘汰在 shared/notes 里管
  function saveNote(relPath: string, text: string): void {
    if (!folder) return
    setNotes((prev) => {
      const next = upsertNote(prev, relPath, text, Date.now())
      saveNotes(folder, next)
      return next
    })
  }

  async function loadGraph(): Promise<void> {
    if (!result) return
    const isCurrent = requests.current.begin('graph')
    const root = result.rootPath
    setGraphLoading(true)
    setGraphNote(null)
    try {
      // 路径契约:renderer 只递 rootPath,图里的节点全是主进程算好的 relPath
      const depGraph = await window.atlas.depGraph(root)
      if (!isCurrent()) return
      setGraph(depGraph)
    } catch (err) {
      if (isCurrent()) setGraphNote(cleanErrMsg(err))
    } finally {
      if (isCurrent()) setGraphLoading(false)
    }
  }

  // 最近列表 ✕ 即删(删了就是删了,旧撤销横幅链路退役),pin 钮同理即写账
  function removeRecent(path: string): void {
    setRecents(forgetRecentProject(path))
  }

  function togglePinRecent(path: string): void {
    setRecents(toggleRecentPin(path))
  }

  return {
    drives,
    drivesNote,
    driveRefreshNonce,
    refreshing,
    recents,
    pathDraft,
    setPathDraft,
    pathHint,
    pathShaking,
    setPathShaking,
    pathInputRef,
    dismissPathHint,
    scanning,
    error,
    notes,
    setNotes,
    graph,
    graphLoading,
    graphNote,
    loadGraph,
    scanPath,
    handlePick,
    handleRefresh,
    goPath,
    goHome,
    saveNote,
    removeRecent,
    togglePinRecent
  }
}
