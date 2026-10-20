import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DepGraphResult,
  DriveInfo,
  FileStructure,
  ScanDirNode,
  ScanFileNode,
  ScanResult
} from '@shared/types'
import { refreshNotesForScan, saveNotes, upsertNote, type NoteMap } from '@shared/notes'
import type { SearchNameHit } from '@shared/searchNames'
import { isAiConfigured } from '@shared/aiSetup'
import { AiSetupContext } from './aiSetupContext'
import { buildFileAttachment, buildFolderAttachment } from './chatContext'
import { ROOT_FONT_BASE_PX } from '@shared/uiScale'
import { FilePathMenu } from './components/FilePathMenu'
import { ContextMenu } from './components/ContextMenu'
import { ScanOrError } from './components/ScanOrError'
import { AppTopBar } from './components/AppTopBar'
import { Rail } from './components/Rail'
import { TopBarTabs } from './components/TopBarTabs'
import { AuxWindows } from './components/AuxWindows'
import type { TabAreaProps } from './components/AuxWindowShell'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { TooltipHost } from './components/Tooltip'
import { Toast } from './components/Toast'
import { describeDriveChange } from './driveRefresh'
import { useRefreshFeedback } from './useRefreshFeedback'
import { useToast } from './useToast'
import { PaneGroups } from './components/PaneGroups'
import { TabBody } from './components/TabBody'
import { cleanErrMsg } from './errText'
import { createRequestScope } from './requestScope'
import {
  forgetRecentProject,
  readRecentProjects,
  rememberRecentProject,
  toggleRecentPin,
  type RecentProject
} from './recents'
import { useAiChat } from './useAiChat'
import { useSidebarSash } from './useSidebarSash'
import { useZoomKeys } from './useZoomKeys'
import { useWorkspaceSearch } from './useWorkspaceSearch'
import { usePaneTabs } from './usePaneTabs'
import { useSettingsNav } from './useSettingsNav'
import { useAuxWindows } from './useAuxWindows'
import { useFileRename } from './useFileRename'
import { groupsForHost, MAIN_HOST } from './paneTabs'
import { useSessionRestore } from './useSessionRestore'
import { useNavStack } from './useNavStack'
import { usePreviewRefs } from './usePreviewRefs'
import { useFlashFlag, useFlashValue } from './useFlashFlag'
import { useWindowMaximized } from './useWindowMaximized'
import { canPreviewFile } from '@shared/fileKinds'
import { findDir, findFile, mergeStats, spliceSubtree, dirChainOf } from './scanTreeTools'

/** 轻提示各养各的体感时长(P2-6 具名):不共用一张表,但每个数都得有名有姓 */
const REVIVED_MS = 15_000 // 复活横幅:画面断了被主进程重接回来,弹十几秒人话再自己退场
const PATH_HINT_MS = 5_000 // 空路径点了「前往」的气泡提示
const PREVIEW_BLOCKED_MS = 1_000 // 不能预览的类型点开:底部 Toast 停留约一秒
const PREVIEW_BLOCKED_TEXT = '此文件类型不支持预览'

function App(): React.JSX.Element {
  // 画面心跳(救生圈2.0,白屏案后迁移):从 main.tsx(React 树外)挪进树内 ——
  // 树活着心跳才跳;哪天渲染期异常把整棵树卸了(2026-09-13 的 MiniMD 隐身案就是),
  // 本 effect 的清账函数停掉 rAF,主进程看门狗 10 秒内发现心跳停摆,自动整页重挂救回。
  // StrictMode 下挂两遍也安全:每个实例只取消自己的那一跳。
  useEffect(() => {
    let lastBeat = 0
    let handle = 0
    const beat = (t: number): void => {
      if (t - lastBeat >= 1000) {
        lastBeat = t
        window.atlas?.frameHeartbeat()
      }
      handle = requestAnimationFrame(beat)
    }
    handle = requestAnimationFrame(beat)
    return () => cancelAnimationFrame(handle)
  }, [])
  // 首页盘符列表(第六十批):一开就是「这台电脑」,只问有哪些盘,点哪个盘扫哪个
  const [drives, setDrives] = useState<DriveInfo[] | null>(null)
  const [drivesNote, setDrivesNote] = useState<string | null>(null)
  const [driveRefreshNonce, setDriveRefreshNonce] = useState(0)
  const { toast, showToast } = useToast()
  const { refreshing, runRefresh } = useRefreshFeedback(showToast)
  // 最近打开的项目(第八十一批):存 localStorage,开过谁就记谁,首页一排卡片点回去
  const [recents, setRecents] = useState<RecentProject[]>(() => readRecentProjects())
  const [folder, setFolder] = useState<string | null>(null)
  // 地址栏草稿:跟着已打开的路径走,也能随手改成别的直接回车开图
  const [pathDraft, setPathDraft] = useState('')
  // 空路径点了「前往」:不禁用按钮,点了才提示缺什么(禁用灰在小白眼里像坏了)
  const [pathHint, flashPathHint, dismissPathHint] = useFlashValue<string | null>(null)
  const [pathShaking, setPathShaking] = useState(false)
  const pathInputRef = useRef<HTMLInputElement>(null)
  // 救生圈的复活横幅(2026-09-13):画面断了被主进程重接回来时弹一句人话,十几秒后自己退场
  const [revived, flashRevived] = useFlashFlag(REVIVED_MS)
  useEffect(() => {
    const off = window.atlas.onRendererRevived(() => flashRevived())
    return off
  }, [flashRevived])
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 手动备注(第九十八批):本项目 relPath → 小葵的一句话;存本机,存上限有孤儿清收
  const [notes, setNotes] = useState<NoteMap>({})

  // reveal 联动:激活页签/跳转目标在树里的父目录链,这些目录强制展开 + 滚到可见
  const [revealPaths, setRevealPaths] = useState<Set<string>>(new Set())

  // 选中就只选中 —— AI 永远等用户自己点;本地结构分析(不耗模型)仍随选中自动跑
  const [selectedFile, setSelectedFile] = useState<ScanFileNode | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<ScanDirNode | null>(null)
  const [structure, setStructure] = useState<FileStructure | null>(null)
  // 结构分析的票号:连点两个文件时,慢的旧响应回来不许盖新的账
  const analyzeSeq = useRef(0)
  const requests = useRef(createRequestScope())
  const [graph, setGraph] = useState<DepGraphResult | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphNote, setGraphNote] = useState<string | null>(null)
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  // 分级扫描:正被点开探测的目录 relPath + 探测失败的人话提示
  const [expanding, setExpanding] = useState<string | null>(null)
  const expandingRef = useRef(false)
  const [treeNote, setTreeNote] = useState<string | null>(null)
  // 顶栏搜索词 ↔ 深搜账(UI v3 §7.2):防抖/seq/按词对齐全在钩子里,App 只拿词和清单面板
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    panel: searchPanel,
    clear: clearSearch
  } = useWorkspaceSearch(result?.rootPath ?? null)

  // 激活页签指向的文件节点(页签只存 relPath,树是登记表;重扫后节点没了就渲染兜底)
  // —— 预览页签改版后不再自带聊天,聊天上下文只认树里选中的对象,这个派生退役了
  // 公用场的聊天上下文:跟着选中的文件/文件夹走;什么都没选就聊项目根 —— 探针随时都在,不挑时候
  const chatContext = useMemo(() => {
    if (!result) return null
    if (selectedFile) return buildFileAttachment(selectedFile, structure)
    if (selectedFolder)
      return buildFolderAttachment(selectedFolder, selectedFolder.name || result.rootName)
    return buildFolderAttachment(result.tree, result.rootName)
  }, [result, selectedFile, selectedFolder, structure])
  // 翻文件模式(agent)的项目根从这儿递进去:沙盒只认这个目录,越界的活儿一律不接
  const chat = useAiChat(chatContext, result?.rootPath ?? null)
  // chatRef 两处用:气泡代发输入的订阅回调(永远调最新场次)、openFileLink 的稳定身份(MiniMD memo)
  const chatRef = useRef(chat)
  useEffect(() => {
    chatRef.current = chat
  })

  const folderRef = useRef(folder)
  useEffect(() => {
    folderRef.current = folder
  }, [folder])

  // 窗口壳:最大化时圆角描边要收掉;状态挂 body 上,抽屉(传送门挂在 body)跟着一起换装
  const maximized = useWindowMaximized()
  useEffect(() => {
    document.body.classList.toggle('is-maximized', maximized)
    return () => document.body.classList.remove('is-maximized')
  }, [maximized])

  // 开屏列盘符,之后每回退回首页(含 logo 回家)都重列一遍(第八十一批):
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
    expandingRef.current = false
    analyzeSeq.current += 1
    setGraphLoading(false)
    setFolder(dir)
    setPathDraft(dir)
    dismissPathHint()
    setScanning(true)
    setResult(null)
    setError(null)
    setSelectedFile(null)
    setSelectedFolder(null)
    resetPaneTabs()
    setRevealPaths(new Set())
    setPreviewRefs([])
    setStructure(null)
    setGraph(null)
    setGraphNote(null)
    setExpanding(null)
    setTreeNote(null)
    setNotes({})
    // 新工作区 = 新的浏览上下文:搜索词和清单一起清空(§7.2:词一清树就回来)
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
      // 画成了一张图才算「打开过」:记进最近列表,下次首页一点就回(第八十一批)
      setRecents(rememberRecentProject(root))
      // 换了地方就是新的一站(第八十三批);同路径的刷新不算迁移,不记
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

  useEffect(() => {
    let alive = true
    void window.atlas
      .aiConfigGet()
      .then((c) => {
        if (!alive) return
        setAiConfigured(isAiConfigured(c))
      })
      .catch(() => {
        if (alive) setAiConfigured(false)
      })
    return () => {
      alive = false
    }
  }, [])

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
    flashPathHint('先填个路径,或点右边 ⇅ 挑最近打开过的', PATH_HINT_MS)
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

  /**
   * 树里点文件(产品页签规则·页签改版):选中它 + 开一张绑死它的文件预览签
   * (同一文件只此一张,已开就点亮领过去);已有页签一概不动。
   * 不能预览的类型(psd/pdf 这类)只选中、不开签,底部 Toast 说一声。
   * 本地结构分析照旧自动跑(不耗模型)。
   */
  function openFileTabIfPreviewable(file: ScanFileNode, scopeRoot?: string): void {
    if (!canPreviewFile(file.name)) {
      showToast(PREVIEW_BLOCKED_TEXT, PREVIEW_BLOCKED_MS)
      return
    }
    openFileTab(file, scopeRoot)
  }

  async function openFile(file: ScanFileNode): Promise<void> {
    const seq = ++analyzeSeq.current
    pushNav({ folder, file: file.relPath, dir: null })
    setSelectedFile(file)
    setSelectedFolder(null)
    setStructure(null)
    openFileTabIfPreviewable(file)
    if (result) setRevealPaths(new Set(dirChainOf(result.tree, file.relPath)))

    // 本地结构分析照旧自动跑(不耗模型):结果给自由对话附件当证据;失败静静放过
    if (!file.language) return
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),拼绝对路径是主进程的事
      if (!result) return
      const fs = await window.atlas.analyzeFile(result.rootPath, file.relPath, file.language.id)
      if (seq !== analyzeSeq.current) return // 用户已经点了别的文件,这份旧账作废
      if (fs) setStructure(fs)
    } catch {
      // 结构分析是锦上添花,失败不惊动界面
    }
  }

  // 树里点文件夹(产品裁定·页签改版):只选中,不开页签 —— 箭头管展开,点名字不触发扫描;
  // 聊天中点文件夹照旧只换资料不抢台(公用场垫句灰字)
  function selectDir(node: ScanDirNode): void {
    analyzeSeq.current += 1
    if (node.relPath === '') {
      clearSelection()
      return
    }
    pushNav({ folder, file: null, dir: node.relPath })
    setSelectedFolder(node)
    setSelectedFile(null)
    setStructure(null)
    if (result) setRevealPaths(new Set(dirChainOf(result.tree, node.relPath)))
  }

  async function handleLoadGraph(): Promise<void> {
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

  // 点文件夹名称:只选中;展开/收起是箭头的活,扫描只由展开触发。
  // (selectDir 在上面)

  // 后退/前进回到「没选中」的一站:选中清空
  function clearSelection(): void {
    analyzeSeq.current += 1
    setSelectedFolder(null)
    setSelectedFile(null)
    setStructure(null)
  }

  // logo = 回「这台电脑」(第八十批,产品裁定):开到多深的项目,一点就退回选盘首页;
  // 上次开的路径留在输入框里,想回这个项目点「前往」就行。没开项目时按钮自己变灰
  function goHome(): void {
    if (!folder) return
    requests.current.reset()
    analyzeSeq.current += 1
    expandingRef.current = false
    setScanning(false)
    setGraphLoading(false)
    pushNav({ folder: null, file: null, dir: null })
    clearSelection()
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
    setExpanding(null)
    setTreeNote(null)
    dismissPathHint()
    setNotes({})
    clearSearch()
  }

  // 存一条手动备注(第九十八批):空串 = 删除;上限和淘汰在 shared/notes 里管
  function saveNote(relPath: string, text: string): void {
    if (!folder) return
    setNotes((prev) => {
      const next = upsertNote(prev, relPath, text, Date.now())
      saveNotes(folder, next)
      return next
    })
  }

  // 「预览文件」入口(文件行右键/概览「查看文件内容」/图谱打开):选中 + 开文件签。
  // 文件已选中就只点亮签 —— 双击总伴着单击,别把导航账记重了
  function openPreview(relPath: string): void {
    if (!result) return
    const f = findFile(result.tree, relPath)
    if (!f) return
    if (selectedFile?.relPath !== relPath) void openFile(f)
    else openFileTabIfPreviewable(f)
  }

  // 页签右键「在文件列表中显示当前文件」(阅读模式本批):回侧栏树里选中它 +
  // 展开父链滚过去;侧栏收着就先掀开 —— 定位的反馈只有看得见才算数。
  // 子窗里的签点这项,动的是主窗侧栏(树只有那儿有)
  function revealTabInTree(id: string): void {
    if (!result) return
    const t = groups.flatMap((g) => g.tabs).find((x) => x.id === id)
    if (!t || t.kind !== 'preview' || t.relPath === '') return
    const f = findFile(result.tree, t.relPath)
    if (!f) return
    if (sidebarCollapsed) toggleSidebarCollapsed()
    setSelectedFile(f)
    setSelectedFolder(null)
    setRevealPaths(new Set(dirChainOf(result.tree, t.relPath)))
  }

  // 记一站(第八十三批)的定义挪去了 scanPath 之前(声明顺序给 lint 让路)

  // 最近列表 ✕ 即删(UI v3 §7.1:删了就是删了,旧撤销横幅链路退役),pin 钮同理即写账
  function removeRecent(path: string): void {
    setRecents(forgetRecentProject(path))
  }

  function togglePinRecent(path: string): void {
    setRecents(toggleRecentPin(path))
  }

  // ── 深搜结果的打开动作(UI v3 §7.2,本次重构唯一功能变更)──
  // 文件夹命中 = 打开为工作区(§7.2 给定):走地址栏同一条扫描路
  function openSearchDir(hit: SearchNameHit): void {
    void scanPath(hit.absPath)
  }

  // 文件命中 = 开预览页签(走现有逻辑)。深搜到的可能住在「还没探」的目录里:
  // 沿父链逐层探开(handleExpandLazy 返回新子树,本地状态手动接,不等 React 回合),
  // 链探完节点就进树了;链上有探不开的也只是预览兜底说句实话,不装死
  async function openSearchFile(hit: SearchNameHit): Promise<void> {
    if (!result) return
    let tree = result.tree
    const parts = hit.relPath.split('/')
    for (let i = 0; i < parts.length - 1; i++) {
      const dirRel = parts.slice(0, i + 1).join('/')
      const node = findDir(tree, dirRel)
      if (!node) break // 父链在状态表上断了:探不动了,剩下的交给预览兜底说实话
      if (!node.lazy) continue
      const sub = await handleExpandLazy(dirRel)
      if (!sub) return // 探这一层失败了:treeNote 已挂实话,不再往下硬闯
      tree = spliceSubtree(tree, dirRel, sub)
    }
    openPreview(hit.relPath)
  }

  // 「这台电脑」下钻单击文件 = 「瞄一眼」文件签(peek 品类,§7.1):
  // 读根记在页签的 scopeRoot 上(浏览树的盘根),文件节点是浏览账现捏的最小件
  function openBrowseFile(scopeRoot: string, file: { name: string; relPath: string }): void {
    const dot = file.name.lastIndexOf('.')
    openFileTabIfPreviewable(
      {
        type: 'file',
        name: file.name,
        relPath: file.relPath,
        ext: dot > 0 ? file.name.slice(dot).toLowerCase() : ''
      },
      scopeRoot
    )
  }

  // 分级扫描:点开还没探的目录,只探这一层,子树和统计接进现有地图。
  // 返回探到的子树 —— 深搜结果点开文件时,父链逐层探开要靠这个状态表走下一步
  async function handleExpandLazy(relPath: string): Promise<ScanDirNode | null> {
    if (!result || expandingRef.current) return null
    expandingRef.current = true
    const isCurrent = requests.current.begin('expand')
    const root = result.rootPath
    setExpanding(relPath)
    setTreeNote(null)
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),绝对路径只能由主进程 joinRoot 解析
      const sub = await window.atlas.scanSubdir(root, relPath)
      if (!isCurrent()) return null
      setResult((prev) =>
        prev && prev.rootPath === root
          ? {
              ...prev,
              tree: spliceSubtree(prev.tree, relPath, sub.tree),
              stats: mergeStats(prev.stats, sub.stats)
            }
          : prev
      )
      return sub.tree
    } catch (err) {
      if (isCurrent()) setTreeNote(cleanErrMsg(err))
      return null
    } finally {
      if (isCurrent()) {
        setExpanding(null)
        expandingRef.current = false
      }
    }
  }

  // 四个域钩子的统一接线口:放在最后 —— 它们要吃上面那一摞处理函数当参数,
  // 得等参数们先齐活(声明顺序,老规矩给 lint 让路)。返回值铺开成同名局部量,
  // 上面的函数与下面的 JSX 照旧点名,不用改一个字。
  const {
    uiScale,
    sidebarWidth,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    onSashPointerDown,
    onSashPointerMove,
    endSashDrag,
    onSashDoubleClick,
    onSashKeyDown
  } = useSidebarSash()
  // Ctrl+滚轮/键盘 ±0 缩放界面(浏览器惯例):走 setUiScale 原路
  useZoomKeys(() => {})
  // 独立子窗口标识(页签独立窗口):window.open 同进程子窗 + Portal 渲染坑位。
  // 死在页签状态上头 —— 拆签要它能开窗,窗死了要它名下的组关闭并清理
  const { auxWins, openAuxWindow, closeAuxWindow, onAuxGone } = useAuxWindows()
  const {
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
    openTranslationTab,
    openSingletonTab,
    moveTab,
    activateTab,
    closeTab,
    closeTabsInGroup,
    renameFileTab,
    markFlash,
    applyPaneSplit,
    onPaneSashDown,
    onTabDragEnd,
    onDetachTab,
    closeHostGroups
  } = usePaneTabs({
    result,
    openAuxWindow: () => openAuxWindow()?.id ?? null,
    setRevealPaths
  })
  // 子窗死讯 → 它名下的签连带关闭并清理该组(Chrome 语义:关窗即关签)
  useEffect(() => {
    onAuxGone(closeHostGroups)
  }, [onAuxGone, closeHostGroups])
  // 主窗名下的组 vs 各子窗名下的组:两边各画各的页签带和分屏
  const mainGroups = groupsForHost(groups, MAIN_HOST)
  // 设置导航中枢:模式判定、侧栏收起态进出账、分类跳转请求都收在钩里(useSettingsNav)
  const {
    sidebarFace,
    settingsMode,
    settingsSection,
    setSettingsSection,
    settingsReq,
    openSettings,
    openAiSettings
  } = useSettingsNav({ activeGroup, openSingletonTab, sidebarCollapsed, toggleSidebarCollapsed })
  const { nav, pushNav, goNav } = useNavStack({
    folder,
    result,
    scanning,
    scanPath,
    goHome,
    openFile,
    selectDir,
    clearSelection
  })
  const {
    previewRefs,
    setPreviewRefs,
    previewJump,
    fileLinks,
    addPreviewRef,
    removePreviewRef,
    handleDropRef
  } = usePreviewRefs({
    result,
    notes,
    chat,
    chatRef,
    openPreview,
    groups,
    activeGroup,
    markFlash,
    saveNote
  })

  // 内联标题改名(内联标题改名批次):编排本体在 useFileRename,
  // 这里只递状态表 —— 树/选中/备注/引用/页签登记一次换清新路径
  const handleRenameFile = useFileRename({
    result,
    selectedFile,
    folder,
    notes,
    setResult,
    setSelectedFile,
    setNotes,
    setPreviewRefs,
    renameFileTab
  })

  // 会话复现(Obsidian 式):开机还原上次的工作区+页签布局,账目变动防抖落账 ——
  // 生命周期接线收在 useSessionRestore(存档本体在 sessionState.ts)
  useSessionRestore({
    folder,
    groups,
    activeGroupId,
    selectedFile,
    selectedFolder,
    setGroups,
    setActiveGroupId,
    setSelectedFile,
    setSelectedFolder,
    setRevealPaths,
    scanPath
  })

  // 页签区通用接线包:主窗和每扇子窗吃的是同一副药(登记过滤后各自的组)
  const tabArea: TabAreaProps = {
    visibleOfGroup,
    flashTabId,
    activateTab,
    closeTab,
    closeTabsInGroup,
    moveTab,
    setDropMark,
    onTabDragEnd,
    onDetachTab,
    revealTabInTree,
    workspaceRoot: result?.rootPath ?? null,
    paneSplit,
    setActiveGroupId,
    dropMark,
    onPaneSashDown,
    applyPaneSplit,
    renderTabBody: (t) => (
      <TabBody
        tab={t}
        result={result}
        previewRefs={previewRefs}
        previewJump={previewJump}
        graph={graph}
        graphLoading={graphLoading}
        graphNote={graphNote}
        chat={chat}
        fileLinks={fileLinks}
        handleLoadGraph={handleLoadGraph}
        expandLazy={handleExpandLazy}
        openPreview={openPreview}
        addPreviewRef={addPreviewRef}
        removePreviewRef={removePreviewRef}
        handleDropRef={handleDropRef}
        onRenameFile={handleRenameFile}
        settingsWorkspaceName={folder ? (folder.split(/[\\/]/).pop() ?? null) : null}
        settingsSectionReq={settingsReq}
        onSettingsSection={setSettingsSection}
        onAiConfigSaved={(c) => setAiConfigured(isAiConfigured(c))}
      />
    )
  }

  // 顶栏页签带照常对齐,正文就是那张签(只画主窗名下的组)
  const paneGroupsEl = (
    <PaneGroups
      groups={mainGroups}
      setActiveGroupId={setActiveGroupId}
      dropMark={dropMark}
      onPaneSashDown={onPaneSashDown}
      applyPaneSplit={applyPaneSplit}
      paneSplit={paneSplit}
      renderTabBody={tabArea.renderTabBody}
    />
  )

  return (
    <AiSetupContext.Provider
      value={{
        configured: aiConfigured,
        openSettings: openAiSettings,
        isOnAiSettings: settingsMode && settingsSection === 'ai'
      }}
    >
      <div
        className={`app${sidebarCollapsed ? ' is-side-collapsed' : ''}`}
        // 侧栏宽挂 CSS 变量:侧栏本体和顶栏左段(分界线的上行段)同认这一份,
        // 拖 sash 时两边永远对齐;rem 值 = 基准宽 ÷ (16 × uiScale)
        style={
          {
            '--sidebar-w': `${(sidebarWidth / (ROOT_FONT_BASE_PX * uiScale)).toFixed(4)}rem`
          } as React.CSSProperties
        }
      >
        {revived && (
          <div className="revive-note" role="alert">
            画面刚才断了一次,已经自动接上 —— 正在跑的扫描和后台引擎都没受影响,页面回到了刚打开的样子
          </div>
        )}
        <AppTopBar
          scanning={scanning}
          hasWorkspace={result !== null}
          fileNavOff={sidebarFace !== 'files'}
          sidebarShown={!sidebarCollapsed}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebarCollapsed}
          nav={nav}
          goNav={goNav}
          handleRefresh={handleRefresh}
          refreshing={refreshing}
          filter={searchQuery}
          onFilterChange={setSearchQuery}
          tabs={
            // 页签带跟着主窗名下的组走(子窗的签在子窗自己带里),不看工作区:
            // 首页开的单例签(设置)也要能点能 ×
            mainGroups.length > 0 ? (
              <TopBarTabs
                groups={mainGroups}
                visibleOfGroup={visibleOfGroup}
                flashTabId={flashTabId}
                activateTab={activateTab}
                closeTab={closeTab}
                closeTabsInGroup={closeTabsInGroup}
                moveTab={moveTab}
                setDropMark={setDropMark}
                onTabDragEnd={onTabDragEnd}
                onDetachTab={onDetachTab}
                onRevealInTree={revealTabInTree}
                onTranslate={(tab, lang) => openTranslationTab(tab, lang)}
                workspaceRoot={result?.rootPath ?? null}
                paneSplit={paneSplit}
              />
            ) : null
          }
        />

        {/* 第 2 层:rail | 侧栏 | 内容区,全在顶栏之下。
              侧栏常驻(§7.1 不存在空侧栏):没开工作区时树区 = 「这台电脑」盘符列表 */}
        <div className="app-body">
          <Rail
            hasWorkspace={result !== null && !scanning}
            onGraph={() => openSingletonTab('graph')}
            onChat={() => openSingletonTab('chat')}
            onUiWorkbench={() => openSingletonTab('uiworkbench')}
            onSettings={() => openSettings()}
          />
          {/* 侧栏常驻挂载:收起改成宽动画收到 0(visibility 延迟隐),
                不是卸载 —— 展开态的滚动/勾选都留得住 */}
          <WorkspaceSidebar
            result={result}
            notes={notes}
            selectedFile={selectedFile}
            selectedFolder={selectedFolder}
            expanding={expanding}
            revealPaths={revealPaths}
            onOpenFile={openFile}
            onSelectDir={selectDir}
            handleExpandLazy={handleExpandLazy}
            saveNote={saveNote}
            openPreview={openPreview}
            treeNote={treeNote}
            search={searchPanel}
            onOpenSearchFile={(hit) => void openSearchFile(hit)}
            onOpenSearchDir={openSearchDir}
            folder={folder}
            scanning={scanning}
            pathDraft={pathDraft}
            pathHint={pathHint}
            pathShaking={pathShaking}
            pathInputRef={pathInputRef}
            setPathDraft={setPathDraft}
            dismissPathHint={dismissPathHint}
            goPath={goPath}
            setPathShaking={setPathShaking}
            recents={recents}
            onOpenWorkspace={(path) => void scanPath(path)}
            onTogglePin={togglePinRecent}
            onRemoveRecent={removeRecent}
            sidebarWidth={sidebarWidth}
            onSashPointerDown={onSashPointerDown}
            onSashPointerMove={onSashPointerMove}
            endSashDrag={endSashDrag}
            onSashDoubleClick={onSashDoubleClick}
            onSashKeyDown={onSashKeyDown}
            drives={drives}
            drivesNote={drivesNote}
            driveRefreshNonce={driveRefreshNonce}
            onGoHome={goHome}
            sidebarFace={sidebarFace}
            settingsSection={settingsSection}
            onSettingsSection={openSettings}
            onOpenBrowseFile={openBrowseFile}
          />
          {result && !scanning ? (
            // 资源管理器式双栏:左边目录树,右边当前选中项;两边各自独立滚动
            <main className="workspace">
              <section className="detail">{paneGroupsEl}</section>
            </main>
          ) : scanning || error ? (
            // 扫描中/失败:这两种状态优先于页签房;其余情况(含没开项目)一律进签区,
            // 空签组自然落 PaneEmptyBoard 空板
            <ScanOrError
              scanning={scanning}
              error={error}
              onRetry={() => (folder ? void scanPath(folder) : void handlePick())}
              onPick={() => void handlePick()}
              onGoHome={goHome}
            />
          ) : (
            // 没开工作区也能有房:单例签(设置/图谱)孤零零一张签也要正文区
            <main className="workspace">
              <section className="detail">{paneGroupsEl}</section>
            </main>
          )}
        </div>

        {/* 悬停轻提示(全场唯一登记):认 data-tip 属性,fixed 挂 body 不吃侧栏 overflow */}
        <TooltipHost />
        <Toast toast={toast} />
        {/* 文件路径右键菜单(全局单例):绿字文件链接上右键弹「复制完整路径」,只复制不打开 */}
        <FilePathMenu />
        {/* 通用右键菜单(全局单例,第二台):选区「引用到对话」这类不对着文件的右键走这儿 */}
        <ContextMenu />
      </div>

      {/* 独立子窗(页签独立窗口):壳本体在 AuxWindows 组件,
            Portal 渲染进子窗 document —— 同一棵 React 树,活的签的页签活 DOM整体迁移 */}
      <AuxWindows
        auxWins={auxWins}
        groups={groups}
        tabArea={tabArea}
        onRequestClose={closeAuxWindow}
      />
    </AiSetupContext.Provider>
  )
}

export default App
