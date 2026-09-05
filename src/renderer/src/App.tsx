import { useEffect, useRef, useState } from 'react'
import type { DepGraphResult, FileStructure, GitChangesResult, ScanDirNode, ScanFileNode, ScanResult, ScanTreeNode } from '@shared/types'
import { AiSettings } from './components/AiSettings'
import { AppearanceSettings } from './components/AppearanceSettings'
import { buildFileAttachment, buildFolderAttachment } from './chatContext'
import { DetailHeader, type Crumb } from './components/DetailHeader'
import { Drawer } from './components/Drawer'
import { FileOverview } from './components/FileOverview'
import { FileRelations } from './components/FileRelations'
import { FileTree } from './components/FileTree'
import { FolderOverview } from './components/FolderOverview'
import { FreeChatPanel } from './components/FreeChatPanel'
import { GitChanges } from './components/GitChanges'
import { GitFileStatus } from './components/GitFileStatus'
import { ProjectOverview } from './components/ProjectOverview'
import { StructureGrid } from './components/StructureGrid'
import { TitleBar } from './components/TitleBar'
import { cleanErrMsg } from './errText'
import { useAiAsk } from './useAiAsk'
import { useAiChat } from './useAiChat'
import { useWindowMaximized } from './useWindowMaximized'
import { Notice } from './components/Notice'
import { ProgressDots } from './components/ProgressDots'

interface Versions {
  node: string
  chrome: string
  electron: string
}

// 引擎版本在页面渲染前就能从 preload 拿到,渲染时读一次即可,无需 effect
function readVersions(): Versions | null {
  const v = window.atlas?.versions
  return v ? { node: v.node(), chrome: v.chrome(), electron: v.electron() } : null
}

// 文件详情的五个 Tab;文件夹详情有自己的两页
type DetailTab = 'overview' | 'structure' | 'relations' | 'changes' | 'chat'

const FILE_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'structure', label: '结构' },
  { key: 'relations', label: '关系' },
  { key: 'changes', label: '修改建议' },
  { key: 'chat', label: '自由对话' }
]

const FOLDER_TABS = [
  { key: 'overview', label: '概览' },
  { key: 'chat', label: '自由对话' }
]

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

function App(): React.JSX.Element {
  const [versions] = useState<Versions | null>(readVersions)
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
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 选中就只选中 —— AI 永远等用户自己点;本地结构分析(不耗模型)仍随选中自动跑
  const [selectedFile, setSelectedFile] = useState<ScanFileNode | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<ScanDirNode | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [structure, setStructure] = useState<FileStructure | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  // 结构分析的票号:连点两个文件时,慢的旧响应回来不许盖新的账
  const analyzeSeq = useRef(0)
  // 结构分析的提示分两色:info 随口一说(灰),error 真出事(红) —— 信号灯口径
  const [analyzeNote, setAnalyzeNote] = useState<{ text: string; kind: 'info' | 'error' } | null>(null)
  const [graph, setGraph] = useState<DepGraphResult | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphNote, setGraphNote] = useState<string | null>(null)
  // 项目 git 总账:开图后顺手查一份(本地 git 命令,不耗模型),修改建议 Tab 和 Git 抽屉共用
  const [gitInfo, setGitInfo] = useState<GitChangesResult | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  // 设置和 Git 都是抽屉:盖在主内容上面,不把详情往下推;关掉后详情原地不动
  const [showSettings, setShowSettings] = useState(false)
  const [showGit, setShowGit] = useState(false)
  // 分级扫描:正被点开探测的目录 relPath + 探测失败的人话提示
  const [expanding, setExpanding] = useState<string | null>(null)
  const [treeNote, setTreeNote] = useState<string | null>(null)

  // 窗口壳:最大化时圆角描边要收掉;状态挂 body 上,抽屉(传送门挂在 body)跟着一起换装
  const maximized = useWindowMaximized()
  useEffect(() => {
    document.body.classList.toggle('is-maximized', maximized)
    return () => document.body.classList.remove('is-maximized')
  }, [maximized])

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

  // 统一的开图入口:清掉上一张图的旧账,再扫新路径;对话框选的和手输的都走这条
  async function scanPath(dir: string): Promise<void> {
    setFolder(dir)
    setPathDraft(dir)
    setPathHint(null)
    if (pathHintTimerRef.current) clearTimeout(pathHintTimerRef.current)
    setScanning(true)
    setResult(null)
    setError(null)
    setSelectedFile(null)
    setSelectedFolder(null)
    setActiveTab('overview')
    setStructure(null)
    setAnalyzeNote(null)
    setGraph(null)
    setGraphNote(null)
    setShowGit(false)
    setExpanding(null)
    setTreeNote(null)
    setGitInfo(null)
    try {
      const scanned = await window.atlas.scanFolder(dir)
      setResult(scanned)
      flashToast(`地图画好了:${scanned.stats.fileCount} 个文件`)
      // git 总账顺手收一遍(本地 git 命令,不耗模型):失败就当没有,不算错误不弹红
      setGitLoading(true)
      try {
        setGitInfo(await window.atlas.gitChanges(dir))
      } catch {
        setGitInfo(null)
      } finally {
        setGitLoading(false)
      }
    } catch (err) {
      setError(cleanErrMsg(err))
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
      flashToast('先打开一个文件夹,才有得刷新 —— 点「打开项目」或在上面填路径')
      return
    }
    if (!scanning) await scanPath(folder)
  }

  // 空路径点了「前往」/回车:聚焦 + 轻晃 + 气泡提示,几秒后自己消失
  function setShakeAndHint(): void {
    setPathShaking(true)
    setPathHint('先填个文件夹路径,再点「前往」;也可以点「打开项目」选一个')
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

  /**
   * 选中文件:只更新选中,立即出静态详情;本地结构分析自动跑(不耗模型),
   * AI 绝不自动启动。keepTab = 从关系卡跳过来时保持当前 Tab,详情区不换页。
   */
  async function handleSelectFile(relPath: string, file: ScanFileNode, opts?: { keepTab?: boolean }): Promise<void> {
    const seq = ++analyzeSeq.current
    setSelectedFile(file)
    setSelectedFolder(null)
    setStructure(null)
    if (!opts?.keepTab) setActiveTab('overview')

    if (!file.language) {
      setAnalyzeNote({ text: '这个文件的类型没认出来,给不出结构骨架 —— 想知道它是干嘛的,去「自由对话」里问', kind: 'info' })
      return
    }
    setAnalyzing(true)
    setAnalyzeNote(null)
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),拼绝对路径是主进程的事
      if (!result) return
      const fs = await window.atlas.analyzeFile(result.rootPath, relPath, file.language.id)
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

  // 关系卡/概览推荐点路径跳转:在扫描树里按 relPath 找到文件节点,再走同一条选中链路
  // keepTab:从关系卡跳的保持「关系」Tab,顺着依赖链一路看;从概览跳的回到概览
  function jumpTo(relPath: string, keepTab = false): void {
    if (!result) return
    const found = findFile(result.tree, relPath)
    if (found) void handleSelectFile(found.relPath, found, { keepTab })
  }

  // 点文件夹名称:只选中,出静态概览;展开/收起是箭头的活,扫描只由展开触发
  function handleSelectFolder(node: ScanDirNode): void {
    setSelectedFolder(node)
    setSelectedFile(null)
    setStructure(null)
    setAnalyzeNote(null)
    setActiveTab('overview')
  }

  function clearSelection(): void {
    setSelectedFile(null)
    setSelectedFolder(null)
    setStructure(null)
    setAnalyzeNote(null)
    setActiveTab('overview')
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
      <TitleBar />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⌁
          </span>
          CodeAtlas
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void handlePick()} disabled={scanning}>
          {scanning ? '正在画地图……' : '打开项目'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void handleRefresh()} disabled={scanning}>
          {scanning ? '扫描中……' : '刷新'}
        </button>
        <div className={`path-box${pathShaking ? ' is-shaking' : ''}`} onAnimationEnd={() => setPathShaking(false)}>
          <input
            ref={pathInputRef}
            className="path-input mono"
            type="text"
            value={pathDraft}
            placeholder="输入或粘贴文件夹路径,回车直接打开"
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
          {pathHint && <div className="path-hint">{pathHint}</div>}
        </div>
        <button type="button" className="icon-btn" onClick={() => setShowSettings(true)} aria-label="打开设置">
          ⚙
        </button>
      </header>

      {result && !scanning ? (
        // 资源管理器式双栏:左边目录树,右边当前选中项;两边各自独立滚动
        <main className="workspace">
          <aside className="sidebar" style={{ width: sidebarWidth }}>
            <FileTree
              root={result.tree}
              selectedPath={selectedFile?.relPath ?? selectedFolder?.relPath ?? null}
              expandingPath={expanding}
              onSelectFile={(relPath, file) => void handleSelectFile(relPath, file)}
              onSelectFolder={handleSelectFolder}
              onExpandLazy={(relPath) => void handleExpandLazy(relPath)}
            />
            <footer className="sidebar-footer">
              <span>
                <i className={`status-dot${result.stats.lazyCount > 0 ? ' is-amber' : ''}`} aria-hidden="true" />
                {result.stats.lazyCount > 0 ? '部分已扫描' : '扫描完成'}
              </span>
              <span className="mono">
                {result.stats.fileCount} files · {result.stats.dirCount} folders
              </span>
            </footer>
            {treeNote && <div className="tree-toast">⚠️ {treeNote}</div>}
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
            {scanToast && <div className="scan-toast">{scanToast}</div>}
            {selectedFile && result ? (
              <FileDetailView
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
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onClose={clearSelection}
                onJump={(p) => jumpTo(p, true)}
                gitInfo={gitInfo}
                gitLoading={gitLoading}
                onOpenGit={() => setShowGit(true)}
              />
            ) : selectedFolder && result ? (
              <FolderDetailView key={selectedFolder.relPath || '(root)'} dir={selectedFolder} result={result} onClose={clearSelection} />
            ) : (
              <ProjectOverview
                result={result}
                graph={graph}
                graphLoading={graphLoading}
                graphNote={graphNote}
                onLoadGraph={() => void handleLoadGraph()}
                onJump={(p) => jumpTo(p)}
                gitInfo={gitInfo}
                onOpenGit={() => setShowGit(true)}
              />
            )}
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
            <div className="welcome-card">
              <div className="logo">
                <span className="brand-mark brand-mark-big" aria-hidden="true">
                  ⌁
                </span>
              </div>
              <h1>CodeAtlas</h1>
              <p className="slogan">你的 AI 代码地图 —— 不读代码,也能看懂整个项目</p>
              <p className="empty-hint">点上方「打开项目」,或在地址栏粘贴路径</p>
              <ol className="welcome-steps">
                <li>
                  <i>1</i>选一个文件夹打开,地图马上画出来
                </li>
                <li>
                  <i>2</i>在左边树上点开想看的东西(点箭头展开,点名字选中)
                </li>
                <li>
                  <i>3</i>右边先看静态结构;想让 AI 讲,点一下它才开跑
                </li>
              </ol>
              <div className="engine">
                {versions ? (
                  <>
                    <span>Electron {versions.electron}</span>
                    <span>Node {versions.node}</span>
                    <span>Chromium {versions.chrome}</span>
                  </>
                ) : (
                  <span>引擎启动中……</span>
                )}
              </div>
            </div>
          )}
        </main>
      )}

      {showSettings && (
        <Drawer title="设置" onClose={() => setShowSettings(false)}>
          <AppearanceSettings />
          <AiSettings />
        </Drawer>
      )}
      {showGit && folder && (
        <Drawer title="Git 修改" onClose={() => setShowGit(false)}>
          <GitChanges rootPath={folder} initial={gitInfo ?? undefined} onRefreshed={setGitInfo} onJump={(p) => jumpTo(p)} />
        </Drawer>
      )}
    </div>
  )
}

/**
 * 文件详情:固定头部(面包屑/文件名/徽章/关闭)+ 五个 Tab。
 * key = relPath:换文件整个重挂,AI 助手跟着换目标,旧请求就地取消,
 * 旧响应回来也盖不到新文件头上。
 */
function FileDetailView({
  file,
  result,
  structure,
  analyzing,
  analyzeNote,
  graph,
  graphLoading,
  graphNote,
  onLoadGraph,
  activeTab,
  onTabChange,
  onClose,
  onJump,
  gitInfo,
  gitLoading,
  onOpenGit
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
  activeTab: DetailTab
  onTabChange: (tab: DetailTab) => void
  onClose: () => void
  /** 关系卡跳转:保持当前 Tab */
  onJump: (relPath: string) => void
  gitInfo: GitChangesResult | null
  gitLoading: boolean
  onOpenGit: () => void
}): React.JSX.Element {
  // AI 解释:概览卡、修改建议共用,证据优先的单问单答,绝不自动开跑
  const ai = useAiAsk((requestId, question) =>
    window.atlas.aiExplainFile(result.rootPath, file.relPath, file.language?.id ?? '', requestId, question ?? undefined)
  )
  // 自由聊天:独立通道、独立 session。钩子挂在详情层,概览↔自由对话来回切不掉聊天记录;
  // 换文件时整个详情重挂(key=relPath),旧 session 连同在途请求一起就地清掉
  const chat = useAiChat(buildFileAttachment(file, structure))

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
        icon="▤"
        title={file.name}
        subtitle={file.summary?.text ?? (file.language ? `${file.language.name} 文件` : '文件')}
        badges={badges}
        tabs={FILE_TABS}
        activeTab={activeTab}
        onTabChange={(key) => onTabChange(key as DetailTab)}
        onClose={onClose}
      />
      <div className="detail-body">
        {activeTab === 'overview' && (
          <FileOverview file={file} structure={structure} analyzing={analyzing} analyzeNote={analyzeNote} graph={graph} ai={ai} />
        )}
        {activeTab === 'structure' && (
          <>
            {analyzing && (
              <div className="card-waiting">
                <ProgressDots />
                正在解析结构骨架……
              </div>
            )}
            {!analyzing && analyzeNote?.kind === 'error' && <Notice kind="error">{analyzeNote.text}</Notice>}
            {!analyzing && analyzeNote?.kind === 'info' && <p className="card-waiting">{analyzeNote.text}</p>}
            {!analyzing && structure && <StructureGrid structure={structure} />}
          </>
        )}
        {activeTab === 'relations' && (
          <>
            {graph ? (
              <FileRelations relPath={file.relPath} graph={graph} onJump={onJump} />
            ) : graphLoading ? (
              <div className="card-waiting">
                <ProgressDots />
                正在连线……
              </div>
            ) : (
              <div className="empty-state">
                <p className="empty-title">还没分析过文件关系</p>
                <p className="empty-hint">连上线才知道:谁引用了它、它引用谁、改它会牵连谁</p>
                <button type="button" className="btn btn-primary" onClick={onLoadGraph}>
                  分析文件关系
                </button>
                {graphNote && <Notice kind="error">{graphNote}</Notice>}
              </div>
            )}
          </>
        )}
        {activeTab === 'changes' && (
          <GitFileStatus
            gitInfo={gitInfo}
            gitLoading={gitLoading}
            rootPath={result.rootPath}
            relPath={file.relPath}
            onOpenGit={onOpenGit}
            ai={ai}
            onGoOverview={() => onTabChange('overview')}
          />
        )}
        {activeTab === 'chat' && <FreeChatPanel chat={chat} context={buildFileAttachment(file, structure)} />}
      </div>
    </div>
  )
}

/** 文件夹详情:静态目录概览为主;讲解卡在概览页,自由对话是独立 Tab/独立通道 */
function FolderDetailView({ dir, result, onClose }: { dir: ScanDirNode; result: ScanResult; onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState('overview')
  const ai = useAiAsk((requestId, question) => window.atlas.aiExplainFolder(result.rootPath, dir.relPath, requestId, question ?? undefined))
  const chat = useAiChat(buildFolderAttachment(dir, dir.name || result.rootName))

  const badges: Array<{ label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'muted' }> = []
  if (dir.relPath === '') badges.push({ label: '项目根', tone: 'blue' })
  if (dir.lazy) badges.push({ label: '未扫描', tone: 'amber' })
  else if (dir.truncated) badges.push({ label: '不完整', tone: 'amber' })
  else badges.push({ label: '已扫描', tone: 'green' })

  return (
    <div className="detail-page">
      <DetailHeader
        crumbs={buildCrumbs(result.rootName, result.rootPath, dir.relPath)}
        icon="▣"
        title={dir.name || result.rootName}
        subtitle={dir.summary?.text ?? '文件夹'}
        badges={badges}
        tabs={FOLDER_TABS}
        activeTab={tab}
        onTabChange={setTab}
        onClose={onClose}
      />
      <div className="detail-body">
        {tab === 'overview' && <FolderOverview dir={dir} ai={ai} />}
        {tab === 'chat' && <FreeChatPanel chat={chat} context={buildFolderAttachment(dir, dir.name || result.rootName)} />}
      </div>
    </div>
  )
}

export default App
