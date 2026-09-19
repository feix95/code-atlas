import { useState } from 'react'
import type { DepGraphResult, GitChangesResult, ScanResult, ScanTreeNode } from '@shared/types'
import { guideEntries, isTreePartial } from '@shared/scanCoverage'
import { FeatureLocator } from './FeatureLocator'
import { GitDoor } from './GitDoor'
import { TreeIcon } from './Icons'
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
    (c) => c.type === 'file' && /^readme(?:\.|$)/i.test(c.name)
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
  onReadFile,
  gitInfo,
  onRefreshed
}: {
  result: ScanResult
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  onLoadGraph: () => void
  onJump: (relPath: string) => void
  onReadFile: (relPath: string) => void
  gitInfo: GitChangesResult | null
  onRefreshed: (result: GitChangesResult) => void
}): React.JSX.Element {
  const { stats } = result
  const languageEntries = topEntries(stats.byLanguage, 6)
  const extEntries = topEntries(stats.byExt, 5)
  const readme = findReadme(result.tree)
  const partial = isTreePartial(result.tree)
  const [visibleCount, setVisibleCount] = useState(12)
  const entries = guideEntries(result.tree)
  const shown = entries.slice(0, visibleCount)

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
    <div className="detail-page project-guide">
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
            <h1>项目导览</h1>
            <p>先了解组成,再深入一个文件。</p>
          </div>
        </div>
      </header>

      <div className="detail-body guide-body">
        <section className="guide-orientation">
          <h2>{result.rootName}</h2>
          <p>这张地图来自实际扫描的文件和文件夹。说明按名称与目录规则整理,不是 AI 的确定结论。</p>
          <p className="guide-stats">
            已发现 {stats.fileCount} 个文件 · {stats.dirCount} 个文件夹
          </p>
          {partial ? (
            <Notice kind="warn">
              还有内容没有展开或无法读取,下面只展示已经发现的部分。可以在左侧展开文件夹,或选择更小的项目文件夹。
            </Notice>
          ) : (
            <p>
              <span className="chip chip-muted">当前目录已扫描</span>
            </p>
          )}
        </section>

        <section className="guide-start">
          <h2>从这里开始</h2>
          {readme ? (
            <button type="button" className="guide-start-link" onClick={() => onReadFile(readme)}>
              <strong>读项目说明</strong>
              <span>
                <span className="mono">{readme}</span>,先了解它做什么、怎么运行。
              </span>
            </button>
          ) : (
            <p>没有找到根目录的项目说明。可以先从下面的文件夹开始。</p>
          )}
        </section>

        <section className="guide-map">
          <h2>项目由这些部分组成</h2>
          <p className="guide-hint">点击名称查看;这是一张目录地图,不是文件调用关系图。</p>
          {entries.length === 0 ? (
            <p className="guide-empty">这个文件夹里没有可展示的文件。它可能是空的,或内容都属于已忽略的依赖和构建文件。</p>
          ) : (
            <>
              <div className="guide-list">
                {shown.map((entry) => (
                  <div className="guide-item" key={entry.relPath}>
                    <button type="button" className="guide-node" onClick={() => onJump(entry.relPath)}>
                      <span className="guide-node-icon" aria-hidden="true">
                        <TreeIcon name={entry.summary?.icon ?? (entry.type === 'directory' ? 'folder' : 'file')} />
                      </span>
                      <span className="guide-node-main">
                        <strong>{entry.name}</strong>
                        <span>
                          {entry.summary?.text ??
                            (entry.type === 'directory' ? '文件夹,打开查看里面的文件' : '文件,打开查看说明和内容')}
                        </span>
                        <span className="guide-node-path mono">{entry.relPath}</span>
                      </span>
                      <span className="badge">{entry.type === 'directory' ? '文件夹' : '文件'}</span>
                    </button>
                    {entry.type === 'directory' && entry.children.length > 0 && (
                      <div className="guide-children">
                        {guideEntries(entry)
                          .slice(0, 3)
                          .map((child) => (
                            <button
                              key={child.relPath}
                              type="button"
                              className="guide-child"
                              onClick={() => onJump(child.relPath)}
                            >
                              <TreeIcon name={child.summary?.icon ?? (child.type === 'directory' ? 'folder' : 'file')} />
                              <span>{child.name}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {entries.length > 12 && (
                <button
                  type="button"
                  className="btn btn-ghost guide-toggle"
                  onClick={() =>
                    setVisibleCount((n) => (n < entries.length ? Math.min(entries.length, n + 24) : 12))
                  }
                >
                  {visibleCount < entries.length
                    ? `再显示一些(还剩 ${entries.length - visibleCount} 项)`
                    : '收起列表'}
                </button>
              )}
            </>
          )}
        </section>

        <details className="guide-more">
          <summary>找功能、看文件关系和修改记录</summary>
          <div className="guide-more-body">
            <FeatureLocator key={result.rootPath} tree={result.tree} onJump={onJump} />
            {gitInfo && (
              <GitDoor gitInfo={gitInfo} rootPath={result.rootPath} onJump={onJump} onRefreshed={onRefreshed} />
            )}
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
                <h3>文件关系与阅读线索</h3>
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
                {stats.ignoredCount > 0 && (
                  <span className="chip chip-muted">已绕开 {stats.ignoredCount} 项(node_modules 等)</span>
                )}
                {stats.skippedCount > 0 && (
                  <span className="chip chip-muted">跳过 {stats.skippedCount} 项(无权限/链接)</span>
                )}
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}
