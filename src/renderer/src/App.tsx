import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatCodeRef, ChatContextAttachment, DepGraphResult, DriveInfo, FileStructure, GitChangesResult, ScanDirNode, ScanFileNode, ScanResult, ScanTreeNode } from '@shared/types'
import { buildFileLinkIndex, type FileLinkTarget } from '@shared/fileLinks'
import { refreshNotesForScan, saveNotes, upsertNote, type NoteEntry, type NoteMap } from '@shared/notes'
import { CODE_REFS_MAX } from '@shared/aiDefaults'
import { planWholeFileRef } from '@shared/preview'
import { buildFileAttachment, buildFolderAttachment } from './chatContext'
import { DetailHeader, type Crumb } from './components/DetailHeader'
import { CodePreview } from './components/CodePreview'
import { FileOverview } from './components/FileOverview'
import { FilePathMenu } from './components/FilePathMenu'
import { openFilePathMenuFor } from './components/filePathMenuStore'
import { FileTree } from './components/FileTree'
import { TabBar } from './components/TabBar'
import { FolderOverview } from './components/FolderOverview'
import { FreeChatPanel } from './components/FreeChatPanel'
import { ModelStatusBar } from './components/ModelStatusBar'
import { ProjectOverview } from './components/ProjectOverview'
import { SettingsDialog } from './components/SettingsDialog'
import { TitleBar } from './components/TitleBar'
import { cleanErrMsg } from './errText'
import { pushNavLocation, stepNavIndex, type NavLocation } from './navHistory'
import {
  formatRecentTime,
  forgetRecentProject,
  readRecentProjects,
  rememberRecentProject,
  writeRecentProjects,
  type RecentProject
} from './recents'
import { useAiAsk } from './useAiAsk'
import { useAiChat, type AiChatApi, type ChatMessage } from './useAiChat'
import { useChatSuggestions } from './useChatSuggestions'
import { loadChatSuggestionsOn, saveChatSuggestionsOn } from './chatPrefs'
import { usePresetQuestions } from './usePresetQuestions'
import { useWindowMaximized } from './useWindowMaximized'
import { KIND_CAPS, KIND_ICONS, KIND_LABELS, loadEnabledKinds, saveEnabledKinds, type PaneKind } from './paneKinds'
import { Notice } from './components/Notice'
import { ProgressDots } from './components/ProgressDots'
import { IconArrowLeft, IconArrowRight, IconFolder, IconRefresh } from './components/Icons'

/** 容量读数:字节换 GB,过百就不带小数,别啰嗦 */
function driveCapacity(d: DriveInfo): string {
  if (!d.total) return '就绪'
  const gb = (n: number): string => `${(n / 1024 ** 3).toFixed(n / 1024 ** 3 >= 100 ? 0 : 1)} GB`
  return d.free !== undefined ? `剩 ${gb(d.free)} / 共 ${gb(d.total)}` : '就绪'
}

/**
 * 右栏页签(小葵的页签模型,2026-09-13 线框图定稿):
 * 页签分三个品类 —— 概览 / Atlas 小探针(自由对话) / 文件预览,品类能不能挂在某个节点上,
 * 由 paneKinds 的两层过滤管(先卡类型上限,再卡显示开关)。
 * 没钉的页签是「跟随页签」:左侧树点谁,它就换成谁的内容;每个品类同时只有一张在跟随。
 * 双击页签 = 钉住(pin):内容定在当时的节点上,树里换文件它不动,新文件的同品类额外新开一张。
 * 对话页签钉住 = 这场对话分家单过(记录搬给它,公用场清空重开)。
 */
interface PaneTab {
  id: string
  kind: PaneKind
  /** 跟随页签=当前跟着的节点(每次跟随换装);钉住的=定死的节点。空串=项目主页/空槽 */
  relPath: string
  name: string
  icon: string
  pinned: boolean
  /** 对话页签钉住分家时的初始记录(保活面板挂载时吃掉,之后各长各的) */
  seed?: ChatMessage[]
}

// 页签 id 发号器:页签身份跟内容走是两回事,跟随页签换装不换 id(聊天草稿不丢)
let tabSeq = 0
function nextTabId(): string {
  tabSeq += 1
  return `tab:${tabSeq}`
}

// 分级扫描:把点开探测到的子树接进地图。沿 relPath 一路浅拷贝(其余节点原样复用),落到目标就换内容
function spliceSubtree(root: ScanDirNode, relPath: string, sub: ScanDirNode): ScanDirNode {
  const parts = relPath === '' ? [] : relPath.split('/')
  if (parts.length === 0) {
    // 重探根:换内容,身份(rootPath 相关的字段)照旧;truncated 照实透传,子目录没探完不许装完整
    return { ...root, children: sub.children, summary: sub.summary, lazy: undefined, truncated: sub.truncated }
  }
  const walk = (node: ScanDirNode, i: number): ScanDirNode => {
    if (i === parts.length) {
      return { ...node, children: sub.children, summary: sub.summary, lazy: undefined, truncated: sub.truncated }
    }
    return {
      ...node,
      children: node.children.map((c) => (c.type === 'directory' && c.name === parts[i] ? walk(c, i + 1) : c))
    }
  }
  return walk(root, 0)
}

// 分级扫描:把子树探出来的一份统计累加进总账(各项都是纯增量,直接加)
function mergeStats(base: ScanResult['stats'], add: ScanResult['stats']): ScanResult['stats'] {
  const byExt = { ...base.byExt }
  for (const [k, v] of Object.entries(add.byExt)) byExt[k] = (byExt[k] ?? 0) + v
  const byLanguage = { ...base.byLanguage }
  for (const [k, v] of Object.entries(add.byLanguage)) {
    byLanguage[k] = { name: v.name, count: (byLanguage[k]?.count ?? 0) + v.count }
  }
  return {
    fileCount: base.fileCount + add.fileCount,
    dirCount: base.dirCount + add.dirCount,
    byExt,
    byLanguage,
    ignoredCount: base.ignoredCount + add.ignoredCount,
    skippedCount: base.skippedCount + add.skippedCount,
    // 目标目录自己从"没探"变成"探了",减回它那一份
    lazyCount: base.lazyCount + add.lazyCount - 1
  }
}

// 按路径契约在扫描树里找文件节点:关系卡跳转只认 relPath,不手拼任何路径
function findFile(node: ScanTreeNode, relPath: string): ScanFileNode | null {
  if (node.type === 'file') return node.relPath === relPath ? node : null
  for (const child of node.children) {
    const hit = findFile(child, relPath)
    if (hit) return hit
  }
  return null
}

/** 收齐全树的 relPath,给聊天文件链接建索引用:AI 提到谁,就拿这份花名册查户口 */
function collectRelPaths(node: ScanTreeNode): string[] {
  const out: string[] = []
  const walk = (n: ScanTreeNode): void => {
    if (n.type === 'file') {
      out.push(n.relPath)
      return
    }
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out
}

/** 按 relPath 找目录节点:功能定位指中文件夹时,跳转走这里 */
function findDir(node: ScanTreeNode, relPath: string): ScanDirNode | null {
  if (node.type === 'directory') {
    if (node.relPath === relPath) return node
    for (const child of node.children) {
      const hit = findDir(child, relPath)
      if (hit) return hit
    }
  }
  return null
}

/** 面包屑分段:rootName + relPath 的每一层;最后一段由调用方自己标成当前 */
function buildCrumbs(rootName: string, rootPath: string, relPath: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: rootName, title: rootPath }]
  const parts = relPath === '' ? [] : relPath.split('/')
  for (const part of parts) crumbs.push({ label: part, title: relPath })
  return crumbs
}

// 左栏宽度:分割条拖多宽记进 localStorage(存 100% 缩放下的基准值),下次打开还是自己调好的样子
const DEFAULT_SIDEBAR_WIDTH = 340
const MIN_SIDEBAR_WIDTH = 240
const SIDEBAR_WIDTH_KEY = 'atlas.sidebar-width'

function readSidebarBase(): number {
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  return saved > 0 ? saved : DEFAULT_SIDEBAR_WIDTH
}

// 树再宽也不能把右栏挤没:右栏保底 360px 看分析内容
function clampSidebar(width: number): number {
  const max = Math.max(MIN_SIDEBAR_WIDTH + 40, window.innerWidth - 360)
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), max)
}

/** 从树根下钻到目标文件的父目录链(reveal 联动用):这些目录要在树里强制展开。
 *  中途撞到没扫描的目录就到那为止 —— 文件能被找到,链上目录必然都已扫实 */
function dirChainOf(root: ScanDirNode, relPath: string): string[] {
  if (relPath === '') return []
  const chain: string[] = []
  let cur: ScanDirNode = root
  const parts = relPath.split('/')
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur.children.find((c) => c.type === 'directory' && c.name === parts[i])
    if (!next || next.type !== 'directory') return chain
    chain.push(next.relPath)
    cur = next
  }
  return chain
}

function App(): React.JSX.Element {
  // 画面心跳(救生圈2.0,白屏案后搬家):从 main.tsx(React 树外)挪进树内 ——
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
  // 首页盘符列表(第六十锤):一开就是「这台电脑」,只问有哪些盘,点哪个盘扫哪个
  const [drives, setDrives] = useState<DriveInfo[] | null>(null)
  const [drivesNote, setDrivesNote] = useState<string | null>(null)
  // 最近打开的项目(第八十一锤):存 localStorage,开过谁就记谁,首页一排卡片点回去
  const [recents, setRecents] = useState<RecentProject[]>(() => readRecentProjects())
  const [folder, setFolder] = useState<string | null>(null)
  // 地址栏草稿:跟着已打开的路径走,也能随手改成别的直接回车开图
  const [pathDraft, setPathDraft] = useState('')
  // 空路径点了「前往」:不禁用按钮,点了才提示缺什么(禁用灰在小白眼里像坏了)
  const [pathHint, setPathHint] = useState<string | null>(null)
  const [pathShaking, setPathShaking] = useState(false)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const pathHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 扫描完成的轻提示:报个数就自己退场,不挡路
  const [scanToast, setScanToast] = useState<string | null>(null)
  const scanToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 救生圈的复活横幅(2026-09-13):画面断了被主进程重接回来时弹一句人话,十几秒后自己退场
  const [revived, setRevived] = useState(false)
  useEffect(() => {
    const off = window.atlas.onRendererRevived(() => setRevived(true))
    return off
  }, [])
  useEffect(() => {
    if (!revived) return
    const t = setTimeout(() => setRevived(false), 15_000)
    return () => clearTimeout(t)
  }, [revived])
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 手动备注(第九十八锤):本项目 relPath → 小葵的一句话;存本机,存上限有孤儿清收
  const [notes, setNotes] = useState<NoteMap>({})
  // 树上右键「写/编辑备注」(第一百零二锤):指向要弹编辑框的 relPath
  const [noteEditRequest, setNoteEditRequest] = useState<string | null>(null)
  // 右栏页签(小葵的页签模型):页签分品类,没钉的跟着树走,钉住的定在原地;
  // 品类显示开关记进本机,页签实例留着(取消勾选只是藏起来,再勾上连钉住状态都回来)
  const [tabs, setTabs] = useState<PaneTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [enabledKinds, setEnabledKinds] = useState<Set<PaneKind>>(loadEnabledKinds)
  // 系统自动勾回品类时刚点亮的那张页签:轻强调一下让用户察觉(小葵点的,别做得太静默)
  const [flashTabId, setFlashTabId] = useState<string | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // reveal 联动:激活页签/跳转目标在树里的父目录链,这些目录强制展开 + 滚到可见
  const [revealPaths, setRevealPaths] = useState<Set<string>>(new Set())
  // 预览里选中的代码段(第一百一十一锤):挂到右栏输入框上,和问题一起发;换预览文件即清
  const [previewRefs, setPreviewRefs] = useState<ChatCodeRef[]>([])
  // 聊天文件链接的跳行目标:点了带行号的链接,预览窗滚到那一行;seq 计数让同一行连点也能再跳
  const [previewJump, setPreviewJump] = useState<{ line: number; seq: number } | null>(null)
  const jumpSeqRef = useRef(0)
  // 文件链接索引:扫描树一变就重建,AI 提到的文件拿它查户口;查得到的才画成可点链接
  const fileLinkIndex = useMemo(() => (result ? buildFileLinkIndex(collectRelPaths(result.tree)) : null), [result])
  // 选中就只选中 —— AI 永远等用户自己点;本地结构分析(不耗模型)仍随选中自动跑
  const [selectedFile, setSelectedFile] = useState<ScanFileNode | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<ScanDirNode | null>(null)
  const [structure, setStructure] = useState<FileStructure | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  // 结构分析的票号:连点两个文件时,慢的旧响应回来不许盖新的账
  const analyzeSeq = useRef(0)
  // 结构分析的提示分两色:info 随口一说(灰),error 真出事(红) —— 信号灯口径
  const [analyzeNote, setAnalyzeNote] = useState<{ text: string; kind: 'info' | 'error' } | null>(null)
  const [graph, setGraph] = useState<DepGraphResult | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphNote, setGraphNote] = useState<string | null>(null)
  // 项目 git 总账:开图后顺手查一份(本地 git 命令,不耗模型),修改建议 Tab 和右栏 git 门共用
  const [gitInfo, setGitInfo] = useState<GitChangesResult | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // 推荐问题总闸(聊天偏好,存本机):关了聊天框上面和预览 AI 卡下面的推荐都不出,两处模型预测也一并省掉
  const [chatSuggestionsOn, setChatSuggestionsOn] = useState(loadChatSuggestionsOn)
  // 分级扫描:正被点开探测的目录 relPath + 探测失败的人话提示
  const [expanding, setExpanding] = useState<string | null>(null)
  const [treeNote, setTreeNote] = useState<string | null>(null)
  // 后退/前进(第八十三锤):浏览过的位置(首页/项目/选中的文件文件夹)串成一条线,按钮挪游标
  const [nav, setNav] = useState<{ stack: NavLocation[]; index: number }>(() => ({
    stack: [{ folder: null, file: null, dir: null }],
    index: 0
  }))
  // 后退/前进跳转途中记录器闭嘴:恢复旧位置引发的一串选中不许再记新账
  const navTravelingRef = useRef(false)
  // 自由对话的公用场(第一百二十四锤的老规矩原样保留):全 app 一份,挂在 App 顶层 ——
  // 换文件、换文件夹、切页签,聊天记录都活着;钉住对话页签时才把记录分家给新页签
  // 显示开关过滤后的页签才上页签栏;取消勾选的页签实例还留着,勾回来连钉住状态一起回来
  const visibleTabs = useMemo(() => tabs.filter((t) => enabledKinds.has(t.kind)), [tabs, enabledKinds])
  const activeTabObj = visibleTabs.find((t) => t.id === activeTabId) ?? null
  // 激活页签指向的文件/文件夹节点(页签只存 relPath,树是户口本;重扫后节点没了就渲染兜底)
  const activeFileNode = useMemo(
    () => (activeTabObj && (activeTabObj.kind === 'preview' || (activeTabObj.kind === 'overview' && activeTabObj.pinned)) && activeTabObj.relPath !== '' && result ? findFile(result.tree, activeTabObj.relPath) : null),
    [activeTabObj, result]
  )
  const activeDirNode = useMemo(
    () => (activeTabObj?.kind === 'overview' && activeTabObj.pinned && result ? findDir(result.tree, activeTabObj.relPath) : null),
    [activeTabObj, result]
  )
  // 公用场的聊天上下文:预览页签激活时聊左栏那扇窗,其余时候跟着选中的文件/文件夹走;
  // 什么都没选就聊项目根 —— 探针随时都在,不挑时候
  const chatContext = useMemo(() => {
    if (!result) return null
    if (activeTabObj?.kind === 'preview' && activeTabObj.relPath !== '') {
      const f = findFile(result.tree, activeTabObj.relPath)
      if (f) return buildFileAttachment(f, null)
    }
    if (selectedFile) return buildFileAttachment(selectedFile, structure)
    if (selectedFolder) return buildFolderAttachment(selectedFolder, selectedFolder.name || result.rootName)
    return buildFolderAttachment(result.tree, result.rootName)
  }, [result, activeTabObj, selectedFile, selectedFolder, structure])
  // 翻文件模式(agent)的项目根从这儿递进去:沙盒只认这个目录,越界的活儿一律不接
  const chat = useAiChat(chatContext, result?.rootPath ?? null)
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

  // 开屏列盘符,之后每回退回首页(含 logo 回家)都重列一遍(第八十一锤):
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
        if (alive) setDrivesNote('盘符列不出来,用上方「打开项目」选文件夹一样能用')
      })
    return () => {
      alive = false
    }
  }, [folder])

  // 界面缩放系数:设置页滑条实时改;左栏宽度要按比例跟着走(固定像素不跟缩放,
  // 高倍率下文字变大、面板不变,挤在一起 —— 第四十四锤修的根因就在这)
  const [uiScale, setUiScale] = useState(window.atlas.getUiScale)
  // VSCode 式分割条:左栏宽度跟着鼠标走。存的是「100% 缩放下的基准值」,
  // 渲染宽度 = 基准值 × 缩放系数,面板和文字等比例一起变
  const sidebarBaseRef = useRef(readSidebarBase())
  const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebar(readSidebarBase() * window.atlas.getUiScale()))
  const sidebarWidthRef = useRef(sidebarWidth)
  const sashDraggingRef = useRef(false)

  function applySidebarWidth(next: number): void {
    const clamped = clampSidebar(next)
    sidebarWidthRef.current = clamped
    sidebarBaseRef.current = clamped / uiScale
    setSidebarWidth(clamped)
  }

  function persistSidebarWidth(): void {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarBaseRef.current))
  }

  // 设置页拖了缩放滑条:按基准值 × 新系数重算左栏宽度,重夹一遍边界
  useEffect(() => {
    function onUiScale(e: Event): void {
      const factor = (e as CustomEvent<number>).detail
      setUiScale(factor)
      const clamped = clampSidebar(sidebarBaseRef.current * factor)
      sidebarWidthRef.current = clamped
      setSidebarWidth(clamped)
    }
    window.addEventListener('atlas:ui-scale', onUiScale)
    return () => window.removeEventListener('atlas:ui-scale', onUiScale)
  }, [])

  // pointer capture:鼠标拖出分割条、甚至拖出窗口,move 事件照样送到条上,不跟丢
  function onSashPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    sashDraggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('is-sash-dragging')
  }

  function onSashPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!sashDraggingRef.current) return
    // 树栏贴着窗口左缘,分割条的横向位置就是左栏该有的宽度
    applySidebarWidth(e.clientX)
  }

  function endSashDrag(e: React.PointerEvent<HTMLDivElement>): void {
    if (!sashDraggingRef.current) return
    sashDraggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.classList.remove('is-sash-dragging')
    persistSidebarWidth()
  }

  function onSashDoubleClick(): void {
    applySidebarWidth(DEFAULT_SIDEBAR_WIDTH * uiScale)
    persistSidebarWidth()
  }

  // 键盘也能调(VSCode 同款):左右方向键微调,24px 一步
  function onSashKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    applySidebarWidth(sidebarWidthRef.current + (e.key === 'ArrowRight' ? 24 : -24))
    persistSidebarWidth()
  }

  // 扫描完成的轻提示:报个数就自己退场
  function flashToast(text: string): void {
    setScanToast(text)
    if (scanToastTimerRef.current) clearTimeout(scanToastTimerRef.current)
    scanToastTimerRef.current = setTimeout(() => setScanToast(null), 4000)
  }

  // 记一站(第八十三锤):开项目/选文件/选文件夹/回家时喊一声;后退前进途中有铃铛拦着,自动闭嘴
  function pushNav(loc: NavLocation): void {
    if (navTravelingRef.current) return
    setNav((prev) => pushNavLocation(prev.stack, prev.index, loc))
  }

  // 统一的开图入口:清掉上一张图的旧账,再扫新路径;对话框选的和手输的都走这条。
  // 扫成的图递还给调用方(后退/前进恢复选中要在新树上找人);扫砸了回 null
  async function scanPath(dir: string): Promise<ScanResult | null> {
    setFolder(dir)
    setPathDraft(dir)
    setPathHint(null)
    if (pathHintTimerRef.current) clearTimeout(pathHintTimerRef.current)
    setScanning(true)
    setResult(null)
    setError(null)
    setSelectedFile(null)
    setSelectedFolder(null)
    resetPaneTabs()
    setRevealPaths(new Set())
    setPreviewRefs([])
    setStructure(null)
    setAnalyzeNote(null)
    setGraph(null)
    setGraphNote(null)
    setExpanding(null)
    setTreeNote(null)
    setGitInfo(null)
    setNotes({})
    try {
      const scanned = await window.atlas.scanFolder(dir)
      setResult(scanned)
      // 备注跟上新树:顺带清孤儿(垃圾不越攒越多),再写回本机
      setNotes(refreshNotesForScan(dir, scanned.tree))
      // 画成了一张图才算「打开过」:记进最近列表,下次首页一点就回(第八十一锤)
      setRecents(rememberRecentProject(dir))
      // 换了地方就是新的一站(第八十三锤);同路径的刷新不算搬家,不记
      if (dir !== folder) pushNav({ folder: dir, file: null, dir: null })
      flashToast(`扫描完成:${scanned.stats.fileCount} 个文件`)
      // git 总账顺手收一遍(本地 git 命令,不耗模型):失败就当没有,不算错误不弹红
      setGitLoading(true)
      try {
        setGitInfo(await window.atlas.gitChanges(dir))
      } catch {
        setGitInfo(null)
      } finally {
        setGitLoading(false)
      }
      return scanned
    } catch (err) {
      setError(cleanErrMsg(err))
      return null
    } finally {
      setScanning(false)
    }
  }

  async function handlePick(): Promise<void> {
    const dir = await window.atlas.pickFolder().catch(() => null)
    if (dir) await scanPath(dir)
  }

  // 刷新 = 把当前项目重扫一遍;没开项目就点了,告诉他缺什么,按钮不装哑巴
  async function handleRefresh(): Promise<void> {
    if (!folder) {
      flashToast('先打开一个项目,再刷新')
      return
    }
    if (!scanning) await scanPath(folder)
  }

  // 空路径点了「前往」/回车:聚焦 + 轻晃 + 气泡提示,几秒后自己消失
  function setShakeAndHint(): void {
    setPathShaking(true)
    setPathHint('先填个路径,或点「打开项目」选一个')
    if (pathHintTimerRef.current) clearTimeout(pathHintTimerRef.current)
    pathHintTimerRef.current = setTimeout(() => setPathHint(null), 5000)
    pathInputRef.current?.focus()
  }

  // 地址栏回车/点「前往」:直接开输进来的路径;粘来的路径常带首尾引号,顺手剥掉
  async function goPath(): Promise<void> {
    if (scanning) return
    const dir = pathDraft.trim().replace(/^"+|"+$/g, '').trim()
    if (dir === '') {
      setShakeAndHint()
      return
    }
    await scanPath(dir)
  }

  // ── 页签层(小葵的页签模型:品类页签 + 双击钉住 + 空白右键品类菜单) ──

  // 开一张新图/回家时页签重置:概览+探针两张跟随页签就位(勾着的品类才可见),
  // 激活可见的第一张;预览不预开 —— 双击文件才开
  function resetPaneTabs(): void {
    const overview = paneTabFor('overview', null)
    const probe = paneTabFor('chat', null)
    setTabs([overview, probe])
    setActiveTabId(enabledKinds.has('overview') ? overview.id : enabledKinds.has('chat') ? probe.id : null)
  }

  // 系统自动勾回品类时给刚亮起的页签一点轻强调:让用户察觉「设置刚被自动改了」,
  // 过几天不会莫名其妙 —— 不弹窗、不出声,就是页签卡上闪一下(小葵点的细节)
  function markFlash(id: string): void {
    setFlashTabId(id)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashTabId(null), 1200)
  }

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

  // 钉住瞬间页签该固化的门面:换成具体节点的名和图标,分得清钉的是谁;节点没了退回品类名牌
  function solidFace(kind: PaneKind, relPath: string): { name: string; icon: string } {
    const f = relPath === '' ? null : result ? findFile(result.tree, relPath) : null
    if (f) return { name: f.name, icon: f.summary?.icon ?? 'file' }
    const d = relPath === '' ? (result?.tree ?? null) : result ? findDir(result.tree, relPath) : null
    if (d) return { name: d.name || result?.rootName || KIND_LABELS[kind], icon: d.summary?.icon ?? 'folder' }
    return { name: KIND_LABELS[kind], icon: KIND_ICONS[kind] }
  }

  // 让某品类的页签亮起来装着 node:有跟随页签就确认内容到位,没有(被钉死/被关了/被藏了)
  // 就新开一张 —— 钉住的那张永远不碰,这正是「固定了,新内容额外新开一张」的来由。
  // auto = 入口撞上被关掉的品类,系统自动勾回来:顺带给页签一点轻强调
  function ensureKindTab(kind: PaneKind, node: ScanFileNode | ScanDirNode | null, auto = false): void {
    if (!enabledKinds.has(kind)) {
      const next = new Set(enabledKinds)
      next.add(kind)
      setEnabledKinds(next)
      saveEnabledKinds(next)
    }
    const slot = tabs.find((t) => t.kind === kind && !t.pinned)
    if (slot) {
      setActiveTabId(slot.id)
      if (auto) markFlash(slot.id)
      return
    }
    const tab = paneTabFor(kind, node)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    if (auto) markFlash(tab.id)
  }

  // 跟随页签全员转向:没钉的页签都是「当前选中的镜子」,树里点谁它们的 relPath 一起换过去
  // (名字图标不动 —— 页签栏挂的是品类名牌);钉住的不碰,节点类型用不上的品类(preview 撞
  // 上文件夹)也不跟,安分守己
  function retargetFollowTabs(node: ScanFileNode | ScanDirNode): void {
    const caps = KIND_CAPS[node.type === 'file' ? 'file' : 'directory']
    setTabs((prev) => prev.map((t) => (!t.pinned && caps.includes(t.kind) ? { ...t, relPath: node.relPath } : t)))
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
    // 藏的正好是激活品类:就近挪到剩下的可见页签,全空就是底板
    if (activeTabObj?.kind === kind) {
      const rest = visibleTabs.filter((t) => t.kind !== kind)
      setActiveTabId(rest.length > 0 ? rest[rest.length - 1].id : null)
    }
  }

  /**
   * 树里单击文件(小葵拍的规矩:单击就是换内容):选中它,右栏跟随页签全体转向它;
   * 激活的页签要是钉着,新内容就额外开一张新页签。本地结构分析照旧自动跑(不耗模型)。
   */
  async function followFile(file: ScanFileNode): Promise<void> {
    const seq = ++analyzeSeq.current
    pushNav({ folder, file: file.relPath, dir: null })
    setSelectedFile(file)
    setSelectedFolder(null)
    setStructure(null)
    // 公用场垫字(第一百二十四锤老规矩):聊着东西换资料,垫一句「换成了」;点同一个文件不垫
    if (chat.messages.length > 0 && selectedFile?.relPath !== file.relPath) chat.note(`参考资料换成了 ${file.name}`)
    retargetFollowTabs(file)
    // 激活页签的品类这个文件用得上就保持,用不上(如钉着的预览)落回概览
    const kind = activeTabObj && KIND_CAPS.file.includes(activeTabObj.kind) ? activeTabObj.kind : 'overview'
    ensureKindTab(kind, file)
    if (result) setRevealPaths(new Set(dirChainOf(result.tree, file.relPath)))

    if (!file.language) {
      setAnalyzeNote({ text: '类型没认出来,无法分析结构;想知道它是干嘛的,去「Atlas 小探针」问', kind: 'info' })
      return
    }
    setAnalyzing(true)
    setAnalyzeNote(null)
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),拼绝对路径是主进程的事
      if (!result) return
      const fs = await window.atlas.analyzeFile(result.rootPath, file.relPath, file.language.id)
      if (seq !== analyzeSeq.current) return // 用户已经点了别的文件,这份旧账作废
      if (fs) {
        setStructure(fs)
      } else {
        setAnalyzeNote({ text: '该语言暂不支持结构分析(支持 TS/TSX/JS/JSX/Python/Java/Go/C/C++/C#/Rust)', kind: 'info' })
      }
    } catch (err) {
      if (seq !== analyzeSeq.current) return
      setAnalyzeNote({ text: cleanErrMsg(err), kind: 'error' })
    } finally {
      if (seq === analyzeSeq.current) setAnalyzing(false)
    }
  }

  // 树里点文件夹:选中出概览,页签规矩同文件;箭头管展开,点名字不触发扫描
  function followDir(node: ScanDirNode): void {
    pushNav({ folder, file: null, dir: node.relPath })
    setSelectedFolder(node)
    setSelectedFile(null)
    setStructure(null)
    setAnalyzeNote(null)
    // 聊天中点文件夹(第一百二十四锤老规矩):只换资料不抢台 —— 探针页签本来就没动,垫字即可
    if (chat.messages.length > 0 && selectedFolder?.relPath !== node.relPath)
      chat.note(`参考资料换成了 ${node.name || result?.rootName || '这个文件夹'}`)
    retargetFollowTabs(node)
    const kind = activeTabObj && KIND_CAPS.directory.includes(activeTabObj.kind) ? activeTabObj.kind : 'overview'
    ensureKindTab(kind, node)
    if (result) setRevealPaths(new Set(dirChainOf(result.tree, node.relPath)))
  }

  async function handleLoadGraph(): Promise<void> {
    if (!result) return
    setGraphLoading(true)
    setGraphNote(null)
    try {
      // 路径契约:renderer 只递 rootPath,图里的节点全是主进程算好的 relPath
      setGraph(await window.atlas.depGraph(result.rootPath))
    } catch (err) {
      setGraphNote(cleanErrMsg(err))
    } finally {
      setGraphLoading(false)
    }
  }

  // 关系卡/概览推荐点路径跳转:在扫描树里按 relPath 找到文件节点,走同一条跟随链路;
  // 文件找不到再找目录:功能定位指中「整个功能住在这个文件夹」时也能跳
  function jumpTo(relPath: string): void {
    if (!result) return
    const found = findFile(result.tree, relPath)
    if (found) {
      followFile(found)
      return
    }
    const dir = findDir(result.tree, relPath)
    if (dir) followDir(dir)
  }

  // 点文件夹名称:只选中,出静态概览;展开/收起是箭头的活,扫描只由展开触发。
  // (followDir 在上面,和文件共用一套页签规矩)

  // 后退/前进回到「没选中」的一站:选中清空,概览页签回项目主页(它的零状态)
  function clearSelection(): void {
    setSelectedFolder(null)
    setSelectedFile(null)
    setStructure(null)
    setAnalyzeNote(null)
    ensureKindTab('overview', null)
  }

  // 页签操作:激活(树里顺势照过来)、双击钉住/拆钉(对话页签的分家规矩在里面)、关闭(接力规矩)
  function activateTab(id: string): void {
    if (id === activeTabId) return
    const t = visibleTabs.find((x) => x.id === id)
    setActiveTabId(id)
    // 点亮页签时树里顺势照过来:父目录链展开+滚到可见 —— 点钉住的旧文件也能在树里找到家
    if (t && t.relPath && result) setRevealPaths(new Set(dirChainOf(result.tree, t.relPath)))
  }

  function pinToggleTab(id: string): void {
    const t = tabs.find((x) => x.id === id)
    if (!t) return
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
          setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, pinned: true, seed, ...face } : x)))
          chat.newChat()
          return
        }
      }
      setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, pinned: true, ...face } : x)))
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
    setTabs((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, pinned: false, relPath, name: KIND_LABELS[t.kind], icon: KIND_ICONS[t.kind] } : x
      )
    )
  }

  function closeTab(id: string): void {
    const idx = visibleTabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const nextVis = visibleTabs.filter((t) => t.id !== id)
    setTabs((prev) => prev.filter((t) => t.id !== id))
    if (id !== activeTabId) return
    // 关的是激活页签:右邻优先接力,左邻兜底,全空回底板(VS Code 同款)。
    // 钉住的对话页签关掉 = 那场对话跟着蒸发(纯内存,记录不落盘)
    const nextActive = nextVis[idx] ?? nextVis[idx - 1] ?? null
    setActiveTabId(nextActive?.id ?? null)
    if (nextActive?.relPath && result) setRevealPaths(new Set(dirChainOf(result.tree, nextActive.relPath)))
  }

  // logo = 回「这台电脑」(第八十锤,小葵拍板):开到多深的项目,一点就退回选盘首页;
  // 上次开的路径留在输入框里,想回这个项目点「前往」就行。没开项目时按钮自己变灰
  function goHome(): void {
    if (!folder) return
    pushNav({ folder: null, file: null, dir: null })
    clearSelection()
    setTabs([])
    setActiveTabId(null)
    setFlashTabId(null)
    setRevealPaths(new Set())
    setPreviewRefs([])
    setFolder(null)
    setResult(null)
    setError(null)
    setGraph(null)
    setGraphNote(null)
    setExpanding(null)
    setTreeNote(null)
    setGitInfo(null)
    setPathHint(null)
    setNotes({})
  }

  // 存一条手动备注(第九十八锤):空串 = 删除;上限和淘汰在 shared/notes 里管
  function saveNote(relPath: string, text: string): void {
    if (!folder) return
    setNotes((prev) => {
      const next = upsertNote(prev, relPath, text, Date.now())
      saveNotes(folder, next)
      return next
    })
  }

  // 树上右键「写/编辑备注」(第一百零二锤):先选中节点让概览页签出来,再弹编辑框
  function editNoteFromTree(relPath: string): void {
    if (!result) return
    const f = findFile(result.tree, relPath)
    if (f) {
      followFile(f)
      setNoteEditRequest(relPath)
      return
    }
    const d = findDir(result.tree, relPath)
    if (d) {
      followDir(d)
      setNoteEditRequest(relPath)
    }
  }

  // 树上双击/右键「预览文件」:让「文件预览」页签亮起来装着它(预览被藏了就自动勾回)。
  // 文件还不是当前选中才走跟随链路 —— 双击总伴着单击,别把导航账记重了
  function openPreview(relPath: string): void {
    if (!result) return
    const f = findFile(result.tree, relPath)
    if (!f) return
    if (selectedFile?.relPath !== relPath) followFile(f)
    ensureKindTab('preview', f)
  }

  // 点聊天里的文件链接:树上查到就选中+开预览,带行号的连滚带跳直达那一行;
  // 查不到(刚被删/改名)就老实垫一句,绝不点了个寂寞。
  // 用 refs 持有最新的 result/chat/openPreview,让这个动作身份永远稳定 —— MiniMD 的 memo 才守得住:
  // 流式输出时只有正在吐字的那条消息重画,别的消息一个字都不动(聊多了也不给画面上强度)
  const chatRef = useRef(chat)
  useEffect(() => {
    chatRef.current = chat
  })
  const resultRef = useRef(result)
  useEffect(() => {
    resultRef.current = result
  })
  const openPreviewRef = useRef(openPreview)
  useEffect(() => {
    openPreviewRef.current = openPreview
  })
  const openFileLink = useCallback((relPath: string, line?: number): void => {
    const cur = resultRef.current
    if (!cur) return
    if (!findFile(cur.tree, relPath)) {
      chatRef.current.note(`${relPath} 现在不在目录树里了(可能刚被删掉或改名),开不了预览`)
      return
    }
    jumpSeqRef.current += 1
    // 引用就地清账 —— 行号是跟着文件走的
    setPreviewRefs([])
    setPreviewJump(line !== undefined ? { line, seq: jumpSeqRef.current } : null)
    openPreviewRef.current(relPath)
  }, [])

  // 文件链接上下文:索引 + 点击去处 + 右键菜单;没扫出树(还在首页)就没有链接这回事
  const openFileLinkMenu = useCallback((relPath: string, x: number, y: number): void => {
    const cur = resultRef.current
    if (!cur) return
    openFilePathMenuFor(cur.rootPath, relPath, x, y)
  }, [])
  const fileLinks: FileLinkTarget | null = useMemo(
    () => (fileLinkIndex ? { index: fileLinkIndex, onOpen: openFileLink, onMenu: openFileLinkMenu } : null),
    [fileLinkIndex, openFileLink, openFileLinkMenu]
  )

  // 引用一段选中代码(第一百一十一锤):额度满了就不收(浮钮那边也会说清)
  function addPreviewRef(ref: ChatCodeRef): void {
    setPreviewRefs((prev) => (prev.length >= CODE_REFS_MAX ? prev : [...prev, ref]))
  }

  function removePreviewRef(index: number): void {
    setPreviewRefs((prev) => prev.filter((_, i) => i !== index))
  }

  // 拖文件进聊天挂引用(第一百二十五锤):读一份 → 按「整份引用」的账裁好 → 挂卡;
  // 文件夹和读不了的垫灰字指路,不装死。引用额度满了也照实说
  async function handleDropNode(kind: 'file' | 'folder', relPath: string): Promise<void> {
    if (!result || !folder) return
    if (kind === 'folder') {
      chat.note('文件夹挂不上引用——点它一下,就能给探针换参考资料')
      return
    }
    if (previewRefs.length >= CODE_REFS_MAX) {
      chat.note(`一轮最多引用 ${CODE_REFS_MAX} 段,想换新的先摘一段`)
      return
    }
    const f = findFile(result.tree, relPath)
    if (!f) return
    try {
      const res = await window.atlas.readPreview(folder, relPath)
      if (res.status !== 'ok') {
        chat.note(res.reason)
        return
      }
      const plan = planWholeFileRef({ text: res.text, refLimit: CODE_REFS_MAX, canAddRef: true })
      if (plan.code.trim() === '') {
        chat.note('这个文件是空的,挂了也没东西可讲')
        return
      }
      addPreviewRef({ relPath: f.relPath, startLine: plan.startLine, endLine: plan.endLine, code: plan.code })
    } catch {
      chat.note('这个文件读不了(可能被系统占用),挂不上引用')
    }
  }

  // 退出预览的老函数已退役(页签地基);树上双击钉住也退役了(小葵的页签模型:
  // 钉不钉只看页签上的双击,树的双击专职开预览)

  // 记一站(第八十三锤)的定义挪去了 scanPath 之前(声明顺序给 lint 让路)

  // 后退/前进本体:游标挪一步,再按那站的样子把界面摆回去 —— 换项目就重扫,还在本项目就恢复选中
  async function goNav(delta: number): Promise<void> {
    if (navTravelingRef.current || scanning) return
    const target = stepNavIndex(nav.index, delta, nav.stack.length)
    if (target === nav.index) return
    navTravelingRef.current = true
    try {
      const loc = nav.stack[target]
      if (!loc.folder) {
        goHome()
      } else if (loc.folder !== folder) {
        applyNavSelection(await scanPath(loc.folder), loc)
      } else {
        applyNavSelection(result, loc)
      }
      setNav((prev) => ({ ...prev, index: target }))
    } finally {
      navTravelingRef.current = false
    }
  }

  // 把某一站的样子摆回界面:文件还在树上就选中,节点没了(重扫过)就老实清空选中
  function applyNavSelection(scanned: ScanResult | null, loc: NavLocation): void {
    if (!scanned) return
    if (loc.file) {
      const f = findFile(scanned.tree, loc.file)
      if (f) {
        followFile(f)
        return
      }
    }
    if (loc.dir) {
      const d = findDir(scanned.tree, loc.dir)
      if (d) {
        followDir(d)
        return
      }
    }
    clearSelection()
  }

  // 最近列表点 ✕:只删记录,不碰文件夹本身(第八十一锤);给 6 秒撤销窗(第九十四锤,破坏性动作不裸奔)
  const [recentUndo, setRecentUndo] = useState<{ snapshot: RecentProject[]; removed: RecentProject } | null>(null)
  const recentUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function removeRecent(path: string): void {
    const removed = recents.find((r) => r.p === path)
    if (!removed) return
    setRecents(forgetRecentProject(path))
    setRecentUndo({ snapshot: recents, removed })
    if (recentUndoTimerRef.current) clearTimeout(recentUndoTimerRef.current)
    recentUndoTimerRef.current = setTimeout(() => setRecentUndo(null), 6000)
  }

  function undoRecentRemove(): void {
    if (!recentUndo) return
    if (recentUndoTimerRef.current) clearTimeout(recentUndoTimerRef.current)
    writeRecentProjects(recentUndo.snapshot)
    setRecents(recentUndo.snapshot)
    setRecentUndo(null)
  }

  /** 盘的来路人话(第八十一锤):固定硬盘 / U 盘或移动硬盘 / 网络盘 / 光驱;问不到照旧叫本地磁盘 */
  function driveKindName(d: DriveInfo): string {
    if (d.kind === 'removable') return 'U 盘或移动硬盘'
    if (d.kind === 'network') return '网络盘'
    if (d.kind === 'optical') return '光驱'
    if (d.kind === 'fixed') return '固定硬盘'
    return '本地磁盘'
  }

  /** 容量条走掉的百分比(0~100);拿不到容量回 null(不画条) */
  function driveUsedPercent(d: DriveInfo): number | null {
    if (!d.total) return null
    const used = (d.total - (d.free ?? 0)) / d.total
    return Math.round(Math.min(100, Math.max(0, used * 100)))
  }

  // 分级扫描:点开还没探的目录,只探这一层,子树和统计接进现有地图
  async function handleExpandLazy(relPath: string): Promise<void> {
    if (!result) return
    setExpanding(relPath)
    setTreeNote(null)
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),绝对路径只能由主进程 joinRoot 解析
      const sub = await window.atlas.scanSubdir(result.rootPath, relPath)
      setResult((prev) =>
        prev
          ? { ...prev, tree: spliceSubtree(prev.tree, relPath, sub.tree), stats: mergeStats(prev.stats, sub.stats) }
          : prev
      )
    } catch (err) {
      setTreeNote(cleanErrMsg(err))
    } finally {
      setExpanding(null)
    }
  }

  return (
    <div className="app">
      {revived && (
        <div className="revive-note" role="alert">
          画面刚才断了一次,已经自动接上 —— 正在跑的扫描和后台引擎都没受影响,页面回到了刚打开的样子
        </div>
      )}
      <TitleBar />
      <header className="topbar">
        <button
          type="button"
          className="brand"
          onClick={goHome}
          disabled={!folder || scanning}
          title={folder ? '回到这台电脑' : '已经在这台电脑了'}
          aria-label="回到这台电脑"
        >
          <span className="brand-mark" aria-hidden="true">
            ⌁
          </span>
          CodeAtlas
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void handlePick()} disabled={scanning}>
          <IconFolder />
          {scanning ? '扫描中……' : '打开项目'}
        </button>
        {/* 后退/前进(第八十三锤,小葵点名跟刷新放一起):在线的两端自己变灰 */}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void goNav(-1)}
          disabled={scanning || nav.index <= 0}
          title="后退"
          aria-label="后退"
        >
          <IconArrowLeft />
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void goNav(1)}
          disabled={scanning || nav.index >= nav.stack.length - 1}
          title="前进"
          aria-label="前进"
        >
          <IconArrowRight />
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void handleRefresh()} disabled={scanning}>
          <IconRefresh />
          {scanning ? '扫描中……' : '刷新'}
        </button>
        <div className={`path-box${pathShaking ? ' is-shaking' : ''}`} onAnimationEnd={() => setPathShaking(false)}>
          <input
            ref={pathInputRef}
            className="path-input mono"
            type="text"
            value={pathDraft}
            placeholder="文件夹路径,回车直接打开"
            spellCheck={false}
            aria-label="文件夹路径"
            onChange={(e) => {
              setPathDraft(e.target.value)
              setPathHint(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void goPath()
              if (e.key === 'Escape') setPathDraft(folder ?? '')
            }}
          />
          <button type="button" className="btn path-go" onClick={() => void goPath()} disabled={scanning}>
            {scanning ? '……' : '前往'}
          </button>
          {pathHint && <div className="path-hint" role="status">{pathHint}</div>}
        </div>
        <button type="button" className="icon-btn" onClick={() => setShowSettings(true)} aria-label="打开设置">
          ⚙
        </button>
      </header>

      {result && !scanning ? (
        // 资源管理器式双栏:左边目录树,右边当前选中项;两边各自独立滚动
        <main className="workspace">
          {/* 宽度渲染成 rem 交给根字号缩放:rem 值 = 基准宽/16,根字号一动面板自动等比,
              不再自己乘系数画像素 —— 坐标系只有一套,鼠标判定和视觉永远重合 */}
          <aside className="sidebar" style={{ width: `${(sidebarWidth / (16 * uiScale)).toFixed(4)}rem` }}>
            {/* 页签地基后树常驻左栏:预览搬进右栏页签,左栏不再整扇换装(点绿字闪一下的老病根就地拔除) */}
            <FileTree
              root={result.tree}
              notes={notes}
              selectedPath={selectedFile?.relPath ?? selectedFolder?.relPath ?? null}
              expandingPath={expanding}
              revealPaths={revealPaths}
              onSelectFile={(_relPath, file) => followFile(file)}
              onSelectFolder={followDir}
              onExpandLazy={(relPath) => void handleExpandLazy(relPath)}
              onNoteEdit={editNoteFromTree}
              onNoteRemove={(relPath) => saveNote(relPath, '')}
              onPreviewFile={openPreview}
            />
            <footer className="sidebar-footer">
              <span>
                <i className={`status-dot${result.stats.lazyCount > 0 ? ' is-amber' : ''}`} aria-hidden="true" />
                {result.stats.lazyCount > 0 ? '部分已扫描' : '扫描完成'}
              </span>
              <span className="mono">
                {result.stats.fileCount} 个文件 · {result.stats.dirCount} 个文件夹
              </span>
            </footer>
            {treeNote && <div className="tree-toast" role="alert">{treeNote}</div>}
          </aside>
          <div
            className="sash"
            role="separator"
            aria-orientation="vertical"
            aria-label="左右栏分割条:拖动调整左栏宽度,双击恢复默认"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuenow={Math.round(sidebarWidth)}
            tabIndex={0}
            onPointerDown={onSashPointerDown}
            onPointerMove={onSashPointerMove}
            onPointerUp={endSashDrag}
            onPointerCancel={endSashDrag}
            onDoubleClick={onSashDoubleClick}
            onKeyDown={onSashKeyDown}
          />
          <section className="detail">
            {scanToast && <div className="scan-toast" role="status">{scanToast}</div>}
            <TabBar
              tabs={visibleTabs}
              activeId={activeTabId}
              flashId={flashTabId}
              onActivate={activateTab}
              onClose={closeTab}
              onPinToggle={pinToggleTab}
              enabledKinds={enabledKinds}
              onToggleKind={toggleKind}
            />
            {activeTabObj ? (
              // 页签态:顶上一条页签条,下面只渲染激活那张(VS Code 的克制:一次一个房间)。
              // 钉住的对话页签不在正房渲染 —— 它走下面的保活层,切走也不能拆账本
              activeTabObj.kind === 'chat' && activeTabObj.pinned ? null : (
                <div className="pane-body">
                  {activeTabObj.kind === 'overview' ? (
                    activeTabObj.pinned ? (
                      // 钉住的概览:定在 pin 时的那个节点上(空槽 = 项目主页也照钉)
                      activeTabObj.relPath === '' ? (
                        <ProjectOverview
                          key={activeTabObj.id}
                          result={result}
                          graph={graph}
                          graphLoading={graphLoading}
                          graphNote={graphNote}
                          onLoadGraph={() => void handleLoadGraph()}
                          onJump={jumpTo}
                          gitInfo={gitInfo}
                          onRefreshed={setGitInfo}
                        />
                      ) : activeFileNode ? (
                        <FileOverviewPage
                          key={activeTabObj.id}
                          file={activeFileNode}
                          result={result}
                          structure={activeTabObj.relPath === selectedFile?.relPath ? structure : null}
                          analyzing={activeTabObj.relPath === selectedFile?.relPath && analyzing}
                          analyzeNote={activeTabObj.relPath === selectedFile?.relPath ? analyzeNote : null}
                          graph={graph}
                          graphLoading={graphLoading}
                          graphNote={graphNote}
                          onLoadGraph={() => void handleLoadGraph()}
                          onJump={jumpTo}
                          gitInfo={gitInfo}
                          gitLoading={gitLoading}
                          note={notes[activeFileNode.relPath] ?? null}
                          onNoteSave={saveNote}
                          autoOpenNote={noteEditRequest === activeFileNode.relPath}
                          suggestionsOn={chatSuggestionsOn}
                          onGoChat={() => ensureKindTab('chat', activeFileNode)}
                        />
                      ) : activeDirNode ? (
                        <FolderOverviewPage
                          key={activeTabObj.id}
                          dir={activeDirNode}
                          result={result}
                          gitInfo={gitInfo}
                          onJump={jumpTo}
                          onRefreshed={setGitInfo}
                          note={notes[activeDirNode.relPath] ?? null}
                          onNoteSave={saveNote}
                          autoOpenNote={noteEditRequest === activeDirNode.relPath}
                          onGoChat={() => ensureKindTab('chat', activeDirNode)}
                        />
                      ) : (
                        // 钉的节点在树里没了(重扫被删):退到项目主页,不装死
                        <ProjectOverview
                          key={activeTabObj.id}
                          result={result}
                          graph={graph}
                          graphLoading={graphLoading}
                          graphNote={graphNote}
                          onLoadGraph={() => void handleLoadGraph()}
                          onJump={jumpTo}
                          gitInfo={gitInfo}
                          onRefreshed={setGitInfo}
                        />
                      )
                    ) : selectedFolder ? (
                      // 跟随概览:左侧树选中谁就显示谁的概览(文件夹)
                      <FolderOverviewPage
                        key={selectedFolder.relPath || '(root)'}
                        dir={selectedFolder}
                        result={result}
                        gitInfo={gitInfo}
                        onJump={jumpTo}
                        onRefreshed={setGitInfo}
                        note={notes[selectedFolder.relPath] ?? null}
                        onNoteSave={saveNote}
                        autoOpenNote={noteEditRequest === selectedFolder.relPath}
                        onGoChat={() => ensureKindTab('chat', selectedFolder)}
                      />
                    ) : selectedFile ? (
                      // 跟随概览:左侧树选中谁就显示谁的概览(文件)
                      <FileOverviewPage
                        key={selectedFile.relPath}
                        file={selectedFile}
                        result={result}
                        structure={structure}
                        analyzing={analyzing}
                        analyzeNote={analyzeNote}
                        graph={graph}
                        graphLoading={graphLoading}
                        graphNote={graphNote}
                        onLoadGraph={() => void handleLoadGraph()}
                        onJump={jumpTo}
                        gitInfo={gitInfo}
                        gitLoading={gitLoading}
                        note={notes[selectedFile.relPath] ?? null}
                        onNoteSave={saveNote}
                        autoOpenNote={noteEditRequest === selectedFile.relPath}
                        suggestionsOn={chatSuggestionsOn}
                        onGoChat={() => ensureKindTab('chat', selectedFile)}
                      />
                    ) : (
                      // 什么都没选:概览页签的零状态 = 项目主页
                      <ProjectOverview
                        key={result.rootPath}
                        result={result}
                        graph={graph}
                        graphLoading={graphLoading}
                        graphNote={graphNote}
                        onLoadGraph={() => void handleLoadGraph()}
                        onJump={jumpTo}
                        gitInfo={gitInfo}
                        onRefreshed={setGitInfo}
                      />
                    )
                  ) : activeTabObj.kind === 'chat' ? (
                    // 公用对话场:所有文件聊天都在这一场里,除非主动开新对话(第一百二十四锤的老规矩)
                    <div className="preview-chat soft-in">
                      <FreeChatPanel
                        chat={chat}
                        context={chatContext}
                        refs={previewRefs}
                        onRemoveRef={removePreviewRef}
                        onDropNode={handleDropNode}
                        fileLinks={fileLinks}
                        suggestionsOn={chatSuggestionsOn}
                      />
                    </div>
                  ) : activeFileNode ? (
                    // 预览页签:左源码右伴聊 —— 「边看代码边聊」的门牌
                    <div className="preview-split" key={activeTabObj.id}>
                      <CodePreview
                        rootPath={result.rootPath}
                        file={activeFileNode}
                        canAddRef={previewRefs.length < CODE_REFS_MAX}
                        refLimit={CODE_REFS_MAX}
                        onAddRef={addPreviewRef}
                        onClose={() => closeTab(activeTabObj.id)}
                        jump={previewJump}
                      />
                      <PreviewChatPane
                        file={activeFileNode}
                        result={result}
                        refs={previewRefs}
                        onRemoveRef={removePreviewRef}
                        chat={chat}
                        chatContext={chatContext ?? buildFileAttachment(activeFileNode, null)}
                        fileLinks={fileLinks}
                        suggestionsOn={chatSuggestionsOn}
                      />
                    </div>
                  ) : (
                    <div className="pane-hint">
                      {activeTabObj.relPath === ''
                        ? '在左侧文件树双击一个文件,代码就在这儿看'
                        : '这个文件不在树里了(可能被删了或改名了),双击树里的文件换一个看'}
                    </div>
                  )}
                </div>
              )
            ) : (
              // 一张页签都不显示(品类全被取消勾选):大 logo 底板,页签栏还在,右键空白处能勾回来
              <PaneEmptyBoard />
            )}
            {/* 钉住的对话保活层:账本各自长,切页签只藏不拆 —— 一拆,那场对话就真没了 */}
            {result &&
              tabs
                .filter((t) => t.kind === 'chat' && t.pinned)
                .map((t) => (
                  <div key={t.id} className={`pinned-chat-host${t.id === activeTabId ? '' : ' is-hidden'}`}>
                    <PinnedChatPane
                      tab={t}
                      result={result}
                      refs={previewRefs}
                      onRemoveRef={removePreviewRef}
                      onDropNode={handleDropNode}
                      fileLinks={fileLinks}
                      suggestionsOn={chatSuggestionsOn}
                    />
                  </div>
                ))}
          </section>
        </main>
      ) : (
        <main className="content">
          {scanning && (
            <div className="state">
              <ProgressDots />
              正在绘制地图,稍等……
            </div>
          )}
          {!scanning && error && (
            <div className="state">
              <Notice kind="error">{error}</Notice>
              <p className="empty-hint">检查一下路径,或点上方「打开项目」重新选一个文件夹</p>
            </div>
          )}
          {!folder && !scanning && !error && (
            <div className="drives-view">
              <h1>这台电脑</h1>
              <p className="empty-hint">点一个盘开始扫描;想直奔某个项目,用上方「打开项目」或粘贴路径</p>
              {recents.length > 0 && (
                <div className="recents">
                  <p className="recents-title">最近打开</p>
                  <div className="recents-grid">
                    {recents.map((r) => (
                      <div key={r.p} className="recent-card">
                        <button type="button" className="recent-open" onClick={() => void scanPath(r.p)} title={r.p}>
                          <strong className="recent-name">{r.n}</strong>
                          <small className="recent-time">{formatRecentTime(r.t)}</small>
                        </button>
                        <button
                          type="button"
                          className="recent-remove"
                          onClick={() => removeRecent(r.p)}
                          aria-label={`从最近列表删掉 ${r.n}`}
                          title="只删这条记录,不动文件夹本身"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {recentUndo && (
                <div className="recent-undo" role="status">
                  已删除「{recentUndo.removed.n}」
                  <button type="button" className="btn btn-ghost" onClick={undoRecentRemove}>
                    撤销
                  </button>
                </div>
              )}
              {drives === null && !drivesNote ? (
                <div className="state">
                  <ProgressDots />
                  正在列盘符……
                </div>
              ) : drivesNote ? (
                <Notice kind="error">{drivesNote}</Notice>
              ) : (
                <div className="drives-grid">
                  {(drives ?? []).map((d) => {
                    const used = driveUsedPercent(d)
                    return (
                      <button key={d.letter} type="button" className="drive-card" onClick={() => void scanPath(d.root)}>
                        <strong className="drive-letter">{d.letter}:</strong>
                        <span className="drive-info">
                          <strong>{driveKindName(d)}</strong>
                          <small>{driveCapacity(d)}</small>
                          {used !== null && (
                            <i className={`drive-bar${d.free !== undefined && d.free / d.total! < 0.1 ? ' is-low' : ''}`}>
                              <i style={{ width: `${used}%` }} />
                            </i>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      )}

      {/* 模型状态栏(第七十锤):钉在窗口最底下,首页/项目页都常驻,模型热身到哪了随时看得见 */}
      <ModelStatusBar />

      {/* 文件路径右键菜单(全局单例):绿字文件链接上右键弹「复制完整路径」,只复制不打开 */}
      <FilePathMenu />

      {showSettings && (
        <SettingsDialog
          workspaceName={folder ? (folder.split(/[\\/]/).pop() ?? null) : null}
          chatSuggestionsOn={chatSuggestionsOn}
          onChatSuggestionsChange={(v) => {
            setChatSuggestionsOn(v)
            saveChatSuggestionsOn(v)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

/**
 * 预览页签的右半(页签地基):小探针的自由对话列,专聊左边那扇源码窗里的文件。
 * 从前它是右栏整扇(PreviewDetailView,自带详情头);预览成页签后头没了 ——
 * 页签条管身份,CodePreview 管文件名,它只管聊。走的是详情页同一条聊天通道。
 * 第一百一十一锤:源码里选中的代码以引用卡挂到输入框上,和问题一起发出去。
 */
function PreviewChatPane({
  file,
  result,
  refs,
  onRemoveRef,
  chat,
  chatContext,
  fileLinks,
  suggestionsOn
}: {
  file: ScanFileNode
  result: ScanResult
  refs: ChatCodeRef[]
  onRemoveRef: (index: number) => void
  chat: AiChatApi
  chatContext: ChatContextAttachment
  fileLinks?: FileLinkTarget | null
  suggestionsOn: boolean
}): React.JSX.Element {
  // 推荐问题随对话演进(第一百一十二锤):规则层秒出,AI 层每答完一轮悄悄换新;总闸关了全歇
  const suggestions = useChatSuggestions({
    rootPath: result.rootPath,
    file,
    messages: chat.messages,
    busy: chat.busy,
    enabled: suggestionsOn
  })

  return (
    <div className="preview-chat soft-in">
      <FreeChatPanel chat={chat} context={chatContext} refs={refs} onRemoveRef={onRemoveRef} suggestions={suggestions.questions} fileLinks={fileLinks} suggestionsOn={suggestionsOn} />
    </div>
  )
}

/**
 * 概览页签的正文(文件版):讲解卡 + 结构清单 + 关系卡,头顶一条轻头部(面包屑/徽章/备注)。
 * 内页 Tab 已退役 —— 「聊天」是独立的品类页签,概览想聊天就喊一声把探针页签点亮。
 * key = 页签/文件身份:换文件整个重挂,AI 助手跟着换目标,旧请求就地取消。
 */
function FileOverviewPage({
  file,
  result,
  structure,
  analyzing,
  analyzeNote,
  graph,
  graphLoading,
  graphNote,
  onLoadGraph,
  onJump,
  gitInfo,
  gitLoading,
  note,
  onNoteSave,
  autoOpenNote,
  suggestionsOn,
  onGoChat
}: {
  file: ScanFileNode
  result: ScanResult
  structure: FileStructure | null
  analyzing: boolean
  analyzeNote: { text: string; kind: 'info' | 'error' } | null
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  onLoadGraph: () => void
  /** 关系卡跳转 */
  onJump: (relPath: string) => void
  gitInfo: GitChangesResult | null
  gitLoading: boolean
  /** 小葵的手动备注(第九十八锤) */
  note: NoteEntry | null
  onNoteSave: (relPath: string, text: string) => void
  /** 树上右键「写/编辑备注」:头部自动展开编辑框 */
  autoOpenNote?: boolean
  /** 推荐问题总闸(设置里的「推荐问题」):关了概览 AI 卡不出预设题,烧模型的预测也一并歇 */
  suggestionsOn: boolean
  /** 「去聊两句」:把 Atlas 小探针页签点亮装着这个文件 */
  onGoChat: () => void
}): React.JSX.Element {
  // AI 解释:概览卡,证据优先的单问单答,绝不自动开跑
  const ai = useAiAsk((requestId, question) =>
    window.atlas.aiExplainFile(result.rootPath, file.relPath, file.language?.id ?? '', requestId, question ?? undefined, note?.text)
  )
  // 预设问题三层预测(第一百零九锤):规则秒出,AI 按文件证据定制,失败不惊动;总闸关了全歇
  const presets = usePresetQuestions({ rootPath: result.rootPath, file, note: note?.text, enabled: suggestionsOn })

  const crumbs = buildCrumbs(result.rootName, result.rootPath, file.relPath)
  const gitChange = gitInfo?.changes.find((c) => c.relPath === file.relPath)
  const badges: Array<{ label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'muted' }> = []
  if (file.language) badges.push({ label: file.language.name, tone: 'blue' })
  if (gitChange) {
    const tone = gitChange.kind === 'deleted' ? 'red' : gitChange.kind === 'added' ? 'green' : 'blue'
    const label: Record<string, string> = {
      added: 'git 新增',
      modified: 'git 修改',
      deleted: 'git 删除',
      renamed: 'git 重命名',
      untracked: 'git 新文件'
    }
    badges.push({ label: label[gitChange.kind], tone })
  } else if (gitInfo && !gitLoading) {
    badges.push({ label: '无未提交改动', tone: 'muted' })
  }

  return (
    <div className="detail-page">
      <DetailHeader
        crumbs={crumbs}
        iconName={file.summary?.icon ?? 'file'}
        title={file.name}
        subtitle={file.summary?.text ?? (file.language ? `${file.language.name} 文件` : '文件')}
        note={note}
        onNoteSave={(text) => onNoteSave(file.relPath, text)}
        autoOpenNote={autoOpenNote}
        badges={badges}
      />
      <div className="detail-body">
        <FileOverview
          file={file}
          noteText={note?.text}
          presets={presets.questions}
          structure={structure}
          analyzing={analyzing}
          analyzeNote={analyzeNote}
          graph={graph}
          graphLoading={graphLoading}
          graphNote={graphNote}
          onLoadGraph={onLoadGraph}
          ai={ai}
          onGoChat={onGoChat}
          onJump={onJump}
        />
      </div>
    </div>
  )
}

/** 概览页签的正文(文件夹版):静态目录概览为主,讲解卡在页面里;聊天是独立的品类页签 */
function FolderOverviewPage({
  dir,
  result,
  gitInfo,
  onJump,
  onRefreshed,
  note,
  onNoteSave,
  autoOpenNote,
  onGoChat
}: {
  dir: ScanDirNode
  result: ScanResult
  gitInfo: GitChangesResult | null
  onJump: (relPath: string) => void
  onRefreshed: (result: GitChangesResult) => void
  /** 小葵的手动备注(第九十八锤) */
  note: NoteEntry | null
  onNoteSave: (relPath: string, text: string) => void
  /** 树上右键「写/编辑备注」:头部自动展开编辑框 */
  autoOpenNote?: boolean
  /** 「去聊两句」:把 Atlas 小探针页签点亮装着这个文件夹 */
  onGoChat: () => void
}): React.JSX.Element {
  const ai = useAiAsk((requestId, question) => window.atlas.aiExplainFolder(result.rootPath, dir.relPath, requestId, question ?? undefined))

  const badges: Array<{ label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'muted' }> = []
  if (dir.relPath === '') badges.push({ label: '项目根', tone: 'blue' })
  if (dir.lazy) badges.push({ label: '未扫描', tone: 'amber' })
  else if (dir.truncated) badges.push({ label: '不完整', tone: 'amber' })
  else badges.push({ label: '已扫描', tone: 'green' })

  return (
    <div className="detail-page">
      <DetailHeader
        crumbs={buildCrumbs(result.rootName, result.rootPath, dir.relPath)}
        iconName={dir.summary?.icon ?? 'folder'}
        title={dir.name || result.rootName}
        subtitle={dir.summary?.text ?? '文件夹'}
        note={note}
        onNoteSave={(text) => onNoteSave(dir.relPath, text)}
        autoOpenNote={autoOpenNote}
        badges={badges}
      />
      <div className="detail-body">
        <FolderOverview
          dir={dir}
          noteText={note?.text}
          ai={ai}
          onGoChat={onGoChat}
          gitInfo={gitInfo}
          rootPath={result.rootPath}
          onJump={onJump}
          onRefreshed={onRefreshed}
        />
      </div>
    </div>
  )
}

/**
 * 钉住的对话页签正文:pin 那一刻从公用场分家出来的独立账本(出生自带当时的记录),
 * 上下文也定死在 pin 时的节点上 —— 树里换文件,这页对话纹丝不动。
 * 它住在保活层里(只藏不拆),关掉页签才是这场对话的终点。
 */
function PinnedChatPane({
  tab,
  result,
  refs,
  onRemoveRef,
  onDropNode,
  fileLinks,
  suggestionsOn
}: {
  tab: PaneTab
  result: ScanResult
  refs: ChatCodeRef[]
  onRemoveRef: (index: number) => void
  onDropNode?: (kind: 'file' | 'folder', relPath: string) => void
  fileLinks?: FileLinkTarget | null
  suggestionsOn: boolean
}): React.JSX.Element {
  // 上下文定死在 pin 时的节点:文件在就是文件附件,文件夹/项目根就是文件夹附件,没了就空着
  const context = useMemo(() => {
    const f = tab.relPath === '' ? null : findFile(result.tree, tab.relPath)
    if (f) return buildFileAttachment(f, null)
    const d = tab.relPath === '' ? result.tree : findDir(result.tree, tab.relPath)
    if (d) return buildFolderAttachment(d, d.name || result.rootName)
    return null
  }, [result, tab.relPath])
  const chat = useAiChat(context, result.rootPath, tab.seed)

  return (
    <div className="preview-chat soft-in">
      <FreeChatPanel chat={chat} context={context} refs={refs} onRemoveRef={onRemoveRef} onDropNode={onDropNode} fileLinks={fileLinks} suggestionsOn={suggestionsOn} />
    </div>
  )
}

/** 页签全关光时的底板:大 logo + 一句指路(页签栏还在,右键空白处能勾回来) */
function PaneEmptyBoard(): React.JSX.Element {
  return (
    <div className="pane-empty">
      <span className="pane-empty-mark" aria-hidden="true">
        ⌁
      </span>
      <p className="pane-empty-title">页签都关掉了</p>
      <p className="pane-empty-hint">在左侧文件树点一个文件就能打开;想勾回功能页,在页签栏空白处右键</p>
    </div>
  )
}

export default App
