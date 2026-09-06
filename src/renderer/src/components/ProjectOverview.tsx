import type { DepGraphResult, GitChangesResult, ScanResult, ScanTreeNode } from '@shared/types'
import { FeatureLocator } from './FeatureLocator'
import { GitDoor } from './GitDoor'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

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
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar">
        <i style={{ width: `${(count / total) * 100}%` }} />
      </div>
      <b>{count}</b>
    </div>
  )
}

/** 在扫描树里找根目录下的 README(推荐阅读的天然入口) */
function findReadme(node: ScanTreeNode): string | null {
  if (node.type !== 'directory') return null
  const readme = node.children.find(
    (c) => c.type === 'file' && /^readme\./i.test(c.name)
  )
  return readme && readme.type === 'file' ? readme.relPath : null
}

/**
 * 项目概览:没选中任何文件/文件夹时的右侧主页。
 * 统计不摆完就完事 —— 「建议先看」给出下一步:Git 有账先看账,
 * 关系图没分析就先连线,分析完直接点名影响范围最大的几个文件。
 */
export function ProjectOverview({
  result,
  graph,
  graphLoading,
  graphNote,
  onLoadGraph,
  onJump,
  gitInfo,
  onRefreshed
}: {
  result: ScanResult
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  onLoadGraph: () => void
  onJump: (relPath: string) => void
  gitInfo: GitChangesResult | null
  onRefreshed: (result: GitChangesResult) => void
}): React.JSX.Element {
  const { stats } = result
  const languageEntries = topEntries(stats.byLanguage, 6)
  const extEntries = topEntries(stats.byExt, 5)
  const readme = findReadme(result.tree)

  const recs: Array<{ key: string; path: string; reason: string; onClick?: () => void; mono?: boolean }> = []

  if (graph && graph.hubs.length > 0) {
    for (const hub of graph.hubs.slice(0, 5)) {
      recs.push({
        key: `hub-${hub.relPath}`,
        path: hub.relPath,
        reason: `影响范围最大:被 ${hub.inCount} 个文件引用,改它之前先看一眼`,
        onClick: () => onJump(hub.relPath),
        mono: true
      })
    }
  }
  if (readme) {
    recs.push({
      key: 'readme',
      path: readme,
      reason: '项目说明,新人从这里开始最省力',
      onClick: () => onJump(readme),
      mono: true
    })
  }
  if (!graph && !graphLoading) {
    recs.unshift({
      key: 'graph-first',
      path: '分析文件关系',
      reason: '还没连线 —— 连上才知道改哪个文件牵连最广',
      onClick: onLoadGraph
    })
  }

  return (
    <div className="detail-page">
      <header className="detail-header">
        <nav className="crumbs" aria-label="所在位置">
          <span className="crumb is-current" title={result.rootPath}>
            {result.rootName}
          </span>
        </nav>
        <div className="entity-line">
          <span className="entity-icon" aria-hidden="true">
            ⌂
          </span>
          <div className="entity-title">
            <h1>项目概览</h1>
            <p className="mono" title={result.rootPath}>
              {result.rootPath}
            </p>
          </div>
        </div>
      </header>

      <div className="detail-body">
        <div className="section-label">
          项目规模 <span>扫描耗时 {result.durationMs} ms</span>
        </div>
        <div className="metric-grid">
          <div className="metric">
            <strong>{stats.fileCount}</strong>
            <span>个文件</span>
          </div>
          <div className="metric">
            <strong>{stats.dirCount}</strong>
            <span>个文件夹</span>
          </div>
          <div className="metric">
            <strong>{Object.keys(stats.byLanguage).length}</strong>
            <span>种语言</span>
          </div>
          <div className="metric">
            <strong>{stats.lazyCount > 0 ? `${stats.lazyCount} 处` : '全扫完'}</strong>
            <span>{stats.lazyCount > 0 ? '还没探(点开就扫)' : '扫描完整'}</span>
          </div>
        </div>

        {gitInfo && <GitDoor gitInfo={gitInfo} rootPath={result.rootPath} onJump={onJump} onRefreshed={onRefreshed} />}
        <FeatureLocator tree={result.tree} onJump={onJump} />
        <div className="two-col">
          <section className="sub-card">
            <h3>语言分布</h3>
            {languageEntries.map(({ key, label, count }) => (
              <BarRow key={key} label={label} count={count} total={stats.fileCount || 1} />
            ))}
            <h3 className="sub-card-gap">后缀分布</h3>
            {extEntries.map(({ label, count }) => (
              <BarRow key={label || 'none'} label={label || '无后缀'} count={count} total={stats.fileCount || 1} />
            ))}
          </section>

          <section className="sub-card">
            <h3>建议先看</h3>
            {recs.map((rec) => (
              <button
                key={rec.key}
                type="button"
                className="rec-row"
                onClick={rec.onClick}
                title={rec.path}
              >
                <span className="rec-number" aria-hidden="true">
                  ›
                </span>
                <span className="rec-main">
                  <strong className={rec.mono ? 'mono' : ''}>{rec.path}</strong>
                  <span>{rec.reason}</span>
                </span>
              </button>
            ))}
            {graph && (
              <p className="rec-footnote">
                {graph.edges.length} 条引用关系 · 分析了 {graph.stats.analyzed} 个源码文件 · 外部包引用{' '}
                {graph.stats.externalCount} 次 · 没连上 {graph.stats.unresolved.length} 条
              </p>
            )}
            {graphLoading && (
              <p className="rec-footnote">
                <ProgressDots />
                正在连线……
              </p>
            )}
            {graphNote && <Notice kind="error">{graphNote}</Notice>}
          </section>
        </div>

        {(stats.ignoredCount > 0 || stats.skippedCount > 0) && (
          <div className="chips">
            {stats.ignoredCount > 0 && <span className="chip chip-muted">已绕开 {stats.ignoredCount} 项(node_modules 等)</span>}
            {stats.skippedCount > 0 && <span className="chip chip-muted">跳过 {stats.skippedCount} 项(无权限/链接)</span>}
          </div>
        )}
      </div>
    </div>
  )
}
