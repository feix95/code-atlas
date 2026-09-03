import { useState } from 'react'
import type { ScanResult } from '@shared/types'
import { FileTree } from './components/FileTree'

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

function App(): React.JSX.Element {
  const [versions] = useState<Versions | null>(readVersions)
  const [folder, setFolder] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePick(): Promise<void> {
    const dir = await window.atlas.pickFolder().catch(() => null)
    if (!dir) return
    setFolder(dir)
    setScanning(true)
    setResult(null)
    setError(null)
    try {
      setResult(await window.atlas.scanFolder(dir))
    } catch (err) {
      setError(cleanErrMsg(err))
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">🗺️ CodeAtlas</span>
        <button type="button" className="btn" onClick={handlePick} disabled={scanning}>
          📁 选择文件夹
        </button>
        {folder && <span className="current-path">{folder}</span>}
      </header>

      <main className="content">
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
            </section>
            <FileTree root={result.tree} />
          </>
        )}
      </main>
    </div>
  )
}

export default App
