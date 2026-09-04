import type { DepGraphResult } from '@shared/types'

/**
 * 关系 Tab:左「影响范围」右「它引用了」,双栏盒子。
 * 路径全部等宽字体、超长省略号,悬停看全路径,点击跳转对应文件
 * (跳转保持当前 Tab,方便顺着关系链一路看下去)。
 */
export function FileRelations({
  relPath,
  graph,
  onJump
}: {
  relPath: string
  graph: DepGraphResult
  onJump: (relPath: string) => void
}): React.JSX.Element | null {
  const importers = [...new Set(graph.edges.filter((edge) => edge.to === relPath).map((edge) => edge.from))]
  const dependencies = [...new Set(graph.edges.filter((edge) => edge.from === relPath).map((edge) => edge.to))]

  if (importers.length === 0 && dependencies.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-title">这个文件还没和项目里其他文件连上线</p>
        <p className="empty-hint">没人引用它,它也不引用别人 —— 多半是个独立的小脚本或入口</p>
      </div>
    )
  }

  return (
    <>
      <div className="section-label">
        文件关系 <span>{importers.length + dependencies.length} 条引用 · 点击跳转,详情区不换页</span>
      </div>
      <div className="relation-list">
        {importers.length > 0 && (
          <section className="relation-box">
            <h3>
              影响范围:被这些文件引用 <span className="structure-section-count">{importers.length}</span>
            </h3>
            {importers.map((path) => (
              <button key={path} type="button" className="relation-link mono" title={path} onClick={() => onJump(path)}>
                {path}
              </button>
            ))}
          </section>
        )}
        {dependencies.length > 0 && (
          <section className="relation-box">
            <h3>
              它引用了 <span className="structure-section-count">{dependencies.length}</span>
            </h3>
            {dependencies.map((path) => (
              <button key={path} type="button" className="relation-link mono" title={path} onClick={() => onJump(path)}>
                {path}
              </button>
            ))}
          </section>
        )}
      </div>
    </>
  )
}
