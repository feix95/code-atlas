import { useRef, useState } from 'react'
import type { DepGraphResult, FileStructure, ScanDirNode, ScanFileNode, ScanResult, ScanStats, ScanTreeNode } from '@shared/types'
import { AiSettings } from './components/AiSettings'
import { ExplainCard } from './components/ExplainCard'
import { FileRelations } from './components/FileRelations'
import { FileTree } from './components/FileTree'
import { FolderCard } from './components/FolderCard'
import { GitChanges } from './components/GitChanges'
import { StructureGrid } from './components/StructureGrid'
import { cleanErrMsg } from './errText'
import { Notice } from './components/Notice'

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

// 主进程抛的错经过 IPC 会带上前缀,剥掉只留人话 —— 统一走 errText 的共享口径
function topEntries(
  record: Record<string, { name: string; count: number } | number>,
  n: number
): Array<{ key: string; label: string; count: number }> {
  return Object.entries(record)
    .map(([key, value]) => ({
      key,
      label: typeof value === 'number' ? key : value.name,
      count: typeof value === 'number' ? value : value.count
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

function BarRow({ label, count, total }: { label: string; count: number; total: number }): React.JSX.Element {
  return (
    <div className="extbar">
      <span className="extbar-label">{label}</span>
      <div className="extbar-track">
        <div className="extbar-fill" style={{ width: `${(count / total) * 100}%` }} />
      </div>
      <span className="extbar-count">{count}</span>
    </div>
  )
}

interface SelectedFile {
  relPath: string
  name: string
  languageId: string
  languageName: string
}

interface SelectedFolder {
  relPath: string
  name: string
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
function mergeStats(base: ScanStats, add: ScanStats): ScanStats {
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

// 左栏宽度:分割条拖多宽记进 localStorage,下次打开还是自己调好的样子
const DEFAULT_SIDEBAR_WIDTH = 420
const MIN_SIDEBAR_WIDTH = 260
const SIDEBAR_WIDTH_KEY = 'atlas.sidebar-width'

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
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolder | null>(null)
  const [structure, setStructure] = useState<FileStructure | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [graph, setGraph] = useState<DepGraphResult | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphNote, setGraphNote] = useState<string | null>(null)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [showGit, setShowGit] = useState(false)
  // 分级扫描:正被点开探测的目录 relPath + 探测失败的人话提示
  const [expanding, setExpanding] = useState<string | null>(null)
  const [treeNote, setTreeNote] = useState<string | null>(null)
  // 结构分析的头票号:连点两个文件时,慢的旧响应回来不许盖新的账
  const analyzeSeqRef = useRef(0)
  // 结构分析的提示分两色:info 随口一说(灰),error 真出事(红) —— 信号灯口径
  const [analyzeNote, setAnalyzeNote] = useState<{ text: string; kind: 'info' | 'error' } | null>(null)

  // VSCode 式分割条:左栏宽度跟着鼠标走;拖动布尔放 ref,不为它每帧重渲染
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return saved > 0 ? clampSidebar(saved) : DEFAULT_SIDEBAR_WIDTH
  })
  const sidebarWidthRef = useRef(sidebarWidth)
  const sashDraggingRef = useRef(false)

  function applySidebarWidth(next: number): void {
    const clamped = clampSidebar(next)
    sidebarWidthRef.current = clamped
    setSidebarWidth(clamped)
  }

  function persistSidebarWidth(): void {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current))
  }

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
    applySidebarWidth(DEFAULT_SIDEBAR_WIDTH)
    persistSidebarWidth()
  }

  // 键盘也能调(VSCode 同款):左右方向键微调,24px 一步
  function onSashKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    applySidebarWidth(sidebarWidthRef.current + (e.key === 'ArrowRight' ? 24 : -24))
    persistSidebarWidth()
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
    setStructure(null)
    setAnalyzeNote(null)
    setGraph(null)
    setGraphNote(null)
    setShowGit(false)
    setExpanding(null)
    setTreeNote(null)
    try {
      setResult(await window.atlas.scanFolder(dir))
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

  // 空路径点了「前往」/回车:聚焦 + 轻晃 + 气泡提示,几秒后自己消失
  function setShakeAndHint(): void {
    setPathShaking(true)
    setPathHint('先填个文件夹路径,再点「前往」;也可以点左边「选择文件夹」')
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

  async function handleSelectFile(relPath: string, file: ScanFileNode): Promise<void> {
    const seq = ++analyzeSeqRef.current
    setSelectedFile({ relPath, name: file.name, languageId: file.language?.id ?? '', languageName: file.language?.name ?? '' })
    setSelectedFolder(null)
    setStructure(null)

    if (!file.language) {
      setAnalyzeNote({ text: '这个文件的类型没认出来,给不出结构骨架 —— 想知道它是干嘛的,AI 会看名字和内容片段猜给你', kind: 'info' })
      return
    }
    setAnalyzing(true)
    setAnalyzeNote(null)
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),拼绝对路径是主进程的事
      if (!result) return
      const fs = await window.atlas.analyzeFile(result.rootPath, relPath, file.language.id)
      if (seq !== analyzeSeqRef.current) return // 用户已经点了别的文件,这份旧账作废
      if (fs) {
        setStructure(fs)
      } else {
        setAnalyzeNote({ text: '该语言暂不支持结构分析(支持 TS/TSX/JS/JSX/Python/Java/Go/C/C++/C#/Rust)', kind: 'info' })
      }
    } catch (err) {
      if (seq !== analyzeSeqRef.current) return
      setAnalyzeNote({ text: cleanErrMsg(err), kind: 'error' })
    } finally {
      if (seq === analyzeSeqRef.current) setAnalyzing(false)
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

  // 关系卡点路径跳转:在扫描树里按 relPath 找到文件节点,再走同一条选中链路
  function jumpTo(relPath: string): void {
    if (!result) return
    const found = findFile(result.tree, relPath)
    if (found) void handleSelectFile(found.relPath, found)
  }

  // 点了文件夹:展开/收起由 FileTree 自己管,这儿负责出文件夹讲解卡(与文件卡互斥)
  function handleSelectFolder(relPath: string, name: string): void {
    setSelectedFolder({ relPath, name })
    setSelectedFile(null)
    setStructure(null)
    setAnalyzeNote(null)
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

  // 全局小账条:无论选中什么都挂在一屏里,随时知道这张图有多大、还欠多少没探
  const statsStrip = result && (
    <div className="summary chips-strip">
      <div className="chips">
        <span className="chip">📄 {result.stats.fileCount} 个文件</span>
        <span className="chip">📁 {result.stats.dirCount} 个文件夹</span>
        <span className="chip">⏱ {result.durationMs} ms</span>
        {result.stats.ignoredCount > 0 && <span className="chip is-muted">已绕开 {result.stats.ignoredCount} 项杂物</span>}
        {result.stats.skippedCount > 0 && <span className="chip is-muted">跳过 {result.stats.skippedCount} 项(无权限/链接)</span>}
        {result.stats.lazyCount > 0 && <span className="chip is-muted">还有 {result.stats.lazyCount} 个文件夹没探,点开就扫</span>}
      </div>
    </div>
  )

  const aiSettingsCard = showAiSettings && (
    <section className="summary">
      <div className="bars-title">⚙️ AI 人话解释设置</div>
      <AiSettings />
    </section>
  )

  const gitCard = showGit && folder && !scanning && (
    <section className="summary">
      <div className="bars-title">🌿 git 修改翻译 —— 谁动了代码,讲给你听</div>
      <GitChanges rootPath={folder} onJump={jumpTo} />
    </section>
  )

  // 还没选中任何东西:右侧是全项目概览(语言分布 + 关系图入口)
  const overview = (
    <>
      <section className="summary">
        <div className="extbars">
          <div className="bars-title">🗣️ 语言分布</div>
          {result && topEntries(result.stats.byLanguage, 6).map(({ key, label, count }) => (
            <BarRow key={key} label={label} count={count} total={result.stats.fileCount || 1} />
          ))}
          <div className="bars-title">🧩 后缀分布</div>
          {result && topEntries(result.stats.byExt, 5).map(({ label, count }) => (
            <BarRow key={label || 'none'} label={label || '无后缀'} count={count} total={result.stats.fileCount || 1} />
          ))}
        </div>
        <div className="summary-actions">
          <button type="button" className="btn" onClick={() => void handleLoadGraph()} disabled={graphLoading}>
            {graphLoading ? '⏳ 正在连线……' : graph ? '🔄 重新分析关系' : '🕸️ 分析文件关系'}
          </button>
          {graph && (
            <span className="chip is-muted">
              {graph.edges.length} 条引用关系 · 分析了 {graph.stats.analyzed} 个源码文件 · 外部包引用{' '}
              {graph.stats.externalCount} 次 · 没连上 {graph.stats.unresolved.length} 条 · ⏱ {graph.durationMs} ms
            </span>
          )}
        </div>
        {graphNote && <Notice kind="error">⚠️ {graphNote}</Notice>}
      </section>
      {graph && graph.hubs.length > 0 && (
        <section className="summary">
          <div className="bars-title">⭐ 最忙的文件(被引用最多,改它要小心 · 点名字跳过去看)</div>
          <div className="extbars bars-hub">
            {graph.hubs.slice(0, 8).map((hub) => (
              <button
                key={hub.relPath}
                type="button"
                className="extbar extbar-link"
                onClick={() => jumpTo(hub.relPath)}
                title={hub.relPath}
              >
                <span className="extbar-label">{hub.relPath}</span>
                <div className="extbar-track">
                  <div className="extbar-fill" style={{ width: `${(hub.inCount / graph.hubs[0].inCount) * 100}%` }} />
                </div>
                <span className="extbar-count">{hub.inCount}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )

  // 选中了文件:结构骨架 + 它在关系图里的位置 + AI 自动开讲,全在右侧一屏
  const fileDetail = selectedFile && result && (
    <section className="structure">
      <div className="structure-head">
        <span className="structure-title">🧬 {selectedFile.name}</span>
        {selectedFile.languageName && <span className="structure-lang">{selectedFile.languageName}</span>}
        <button
          type="button"
          className="structure-close"
          onClick={() => {
            setSelectedFile(null)
            setStructure(null)
            setAnalyzeNote(null)
          }}
        >
          ✕
        </button>
      </div>
      {analyzing && <div className="structure-note">🔍 解析结构中……</div>}
      {!analyzing && analyzeNote && (
        analyzeNote.kind === 'error' ? <Notice kind="error">⚠️ {analyzeNote.text}</Notice> : <div className="structure-note">{analyzeNote.text}</div>
      )}
      {!analyzing && structure && <StructureGrid structure={structure} />}
      {!analyzing && graph && <FileRelations relPath={selectedFile.relPath} graph={graph} onJump={jumpTo} />}
      {!analyzing && (
        <ExplainCard
          key={selectedFile.relPath}
          rootPath={result.rootPath}
          relPath={selectedFile.relPath}
          languageId={selectedFile.languageId}
        />
      )}
    </section>
  )

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">🗺️ CodeAtlas</span>
        <button type="button" className="btn" onClick={handlePick} disabled={scanning}>
          {scanning ? '⏳ 正在画地图……' : '📁 选择文件夹'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setShowAiSettings((v) => !v)}>
          ⚙️ AI 设置
        </button>
        {folder && (
          <button type="button" className="btn btn-ghost" onClick={() => setShowGit((v) => !v)}>
            🌿 Git 修改
          </button>
        )}
        <div
          className={`path-box${pathShaking ? ' is-shaking' : ''}`}
          onAnimationEnd={() => setPathShaking(false)}
        >
          <input
            ref={pathInputRef}
            className="path-input"
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
          <button type="button" className="btn btn-ghost path-go" onClick={() => void goPath()} disabled={scanning}>
            {scanning ? '⏳ 扫描中……' : '前往'}
          </button>
          {pathHint && <div className="path-hint">{pathHint}</div>}
        </div>
      </header>

      {result && !scanning ? (
        // 资源管理器式双栏:左边目录树,右边选中项的全部分析信息
        <main className="workspace">
          <aside className="sidebar" style={{ width: sidebarWidth }}>
            <FileTree
              root={result.tree}
              selectedPath={selectedFile?.relPath ?? selectedFolder?.relPath ?? null}
              expandingPath={expanding}
              onSelectFile={handleSelectFile}
              onSelectFolder={handleSelectFolder}
              onExpandLazy={handleExpandLazy}
            />
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
            {statsStrip}
            {aiSettingsCard}
            {gitCard}
            {selectedFile ? fileDetail : selectedFolder ? (
              <FolderCard
                key={selectedFolder.relPath || '(root)'}
                rootPath={result.rootPath}
                relPath={selectedFolder.relPath}
                name={selectedFolder.name}
                onClose={() => setSelectedFolder(null)}
              />
            ) : (
              overview
            )}
          </section>
        </main>
      ) : (
        <main className="content">
          {aiSettingsCard}
          {gitCard}
          {scanning && <div className="state">⏳ 正在绘制地图,稍等……</div>}
          {!scanning && error && <div className="state is-error">⚠️ {error}</div>}
          {!folder && !scanning && !error && (
            <div className="welcome-card">
              <div className="logo">🗺️</div>
              <h1>CodeAtlas</h1>
              <p className="slogan">你的 AI 代码地图 —— 不读代码,也能看懂整个项目</p>
              <p className="empty-hint">点上方「选择文件夹」,哥把它的地图画给你看</p>
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
    </div>
  )
}

export default App
