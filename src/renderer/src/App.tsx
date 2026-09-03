import { useState } from 'react'
import type { DepGraphResult, FileStructure, ScanFileNode, ScanResult, ScanTreeNode } from '@shared/types'
import { AiSettings } from './components/AiSettings'
import { ExplainCard } from './components/ExplainCard'
import { FileRelations } from './components/FileRelations'
import { FileTree } from './components/FileTree'
import { GitChanges } from './components/GitChanges'
import { StructureGrid } from './components/StructureGrid'

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

// 主进程抛的错经过 IPC 会带上前缀,剥掉只留人话
function cleanErrMsg(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

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

// 按路径契约在扫描树里找文件节点:关系卡跳转只认 relPath,不手拼任何路径
function findFile(node: ScanTreeNode, relPath: string): ScanFileNode | null {
  if (node.type === 'file') return node.relPath === relPath ? node : null
  for (const child of node.children) {
    const hit = findFile(child, relPath)
    if (hit) return hit
  }
  return null
}

function App(): React.JSX.Element {
  const [versions] = useState<Versions | null>(readVersions)
  const [folder, setFolder] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [structure, setStructure] = useState<FileStructure | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeNote, setAnalyzeNote] = useState<string | null>(null)
  const [graph, setGraph] = useState<DepGraphResult | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphNote, setGraphNote] = useState<string | null>(null)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [showGit, setShowGit] = useState(false)

  async function handlePick(): Promise<void> {
    const dir = await window.atlas.pickFolder().catch(() => null)
    if (!dir) return
    setFolder(dir)
    setScanning(true)
    setResult(null)
    setError(null)
    setSelectedFile(null)
    setStructure(null)
    setAnalyzeNote(null)
    setGraph(null)
    setGraphNote(null)
    setShowGit(false)
    try {
      setResult(await window.atlas.scanFolder(dir))
    } catch (err) {
      setError(cleanErrMsg(err))
    } finally {
      setScanning(false)
    }
  }

  async function handleSelectFile(relPath: string, file: ScanFileNode): Promise<void> {
    setSelectedFile({ relPath, name: file.name, languageId: file.language?.id ?? '', languageName: file.language?.name ?? '' })
    setStructure(null)

    if (!file.language) {
      setAnalyzeNote('没有认出语言,暂不支持结构分析')
      return
    }
    setAnalyzing(true)
    setAnalyzeNote(null)
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),拼绝对路径是主进程的事
      if (!result) return
      const fs = await window.atlas.analyzeFile(result.rootPath, relPath, file.language.id)
      if (fs) {
        setStructure(fs)
      } else {
        setAnalyzeNote('该语言暂不支持结构分析(目前支持 TS/TSX/JS/JSX/Python)')
      }
    } catch (err) {
      setAnalyzeNote(cleanErrMsg(err))
    } finally {
      setAnalyzing(false)
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

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">🗺️ CodeAtlas</span>
        <button type="button" className="btn" onClick={handlePick} disabled={scanning}>
          📁 选择文件夹
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setShowAiSettings((v) => !v)}>
          ⚙️ AI 设置
        </button>
        {folder && (
          <button type="button" className="btn btn-ghost" onClick={() => setShowGit((v) => !v)}>
            🌿 Git 修改
          </button>
        )}
        {folder && <span className="current-path">{folder}</span>}
      </header>

      <main className="content">
        {showAiSettings && (
          <section className="summary">
            <div className="bars-title">⚙️ AI 人话解释设置</div>
            <AiSettings />
          </section>
        )}

        {showGit && folder && !scanning && (
          <section className="summary">
            <div className="bars-title">🌿 git 修改翻译 —— 谁动了代码,讲给你听</div>
            <GitChanges rootPath={folder} onJump={jumpTo} />
          </section>
        )}

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

        {result && !scanning && (
          <>
            <section className="summary">
              <div className="chips">
                <span className="chip">📄 {result.stats.fileCount} 个文件</span>
                <span className="chip">📁 {result.stats.dirCount} 个文件夹</span>
                <span className="chip">⏱ {result.durationMs} ms</span>
                {result.stats.ignoredCount > 0 && (
                  <span className="chip is-muted">已绕开 {result.stats.ignoredCount} 项杂物</span>
                )}
                {result.stats.skippedCount > 0 && (
                  <span className="chip is-muted">跳过 {result.stats.skippedCount} 项(无权限/链接)</span>
                )}
              </div>
              <div className="extbars">
                <div className="bars-title">🗣️ 语言分布</div>
                {topEntries(result.stats.byLanguage, 6).map(({ key, label, count }) => (
                  <BarRow key={key} label={label} count={count} total={result.stats.fileCount || 1} />
                ))}
                <div className="bars-title">🧩 后缀分布</div>
                {topEntries(result.stats.byExt, 5).map(({ label, count }) => (
                  <BarRow key={label || 'none'} label={label || '无后缀'} count={count} total={result.stats.fileCount || 1} />
                ))}
              </div>
              <div className="summary-actions">
                <button type="button" className="btn" onClick={handleLoadGraph} disabled={graphLoading}>
                  {graphLoading ? '⏳ 正在连线……' : graph ? '🔄 重新分析关系' : '🕸️ 分析文件关系'}
                </button>
                {graph && (
                  <span className="chip is-muted">
                    {graph.edges.length} 条引用关系 · 分析了 {graph.stats.analyzed} 个源码文件 · 外部包引用{' '}
                    {graph.stats.externalCount} 次 · 没连上 {graph.stats.unresolved.length} 条 · ⏱ {graph.durationMs} ms
                  </span>
                )}
              </div>
              {graphNote && <div className="structure-note">⚠️ {graphNote}</div>}
            </section>
            {graph && graph.hubs.length > 0 && (
              <section className="summary">
                <div className="bars-title">⭐ 最忙的文件(被引用最多,改它要小心)</div>
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
            {selectedFile && (
              <section className="structure">
                <div className="structure-head">
                  <span className="structure-title">🧬 {selectedFile.name}</span>
                  {selectedFile.languageName && (
                    <span className="structure-lang">{selectedFile.languageName}</span>
                  )}
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
                {!analyzing && analyzeNote && <div className="structure-note">{analyzeNote}</div>}
                {!analyzing && structure && <StructureGrid structure={structure} />}
                {!analyzing && graph && selectedFile && (
                  <FileRelations relPath={selectedFile.relPath} graph={graph} onJump={jumpTo} />
                )}
                {!analyzing && structure && selectedFile && result && (
                  <ExplainCard
                    key={selectedFile.relPath}
                    rootPath={result.rootPath}
                    relPath={selectedFile.relPath}
                    languageId={structure.languageId}
                  />
                )}
              </section>
            )}
            <FileTree root={result.tree} selectedPath={selectedFile?.relPath ?? null} onSelectFile={handleSelectFile} />
          </>
        )}
      </main>
    </div>
  )
}

export default App
