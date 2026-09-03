import type { DepGraphResult } from '@shared/types'

// 关系小节:选中文件的"影响范围"(谁引用它)和"它的依赖"(它引用谁)。
// 路径全是关系图边上的 relPath,点击跳转走 App 里按契约查树的那条链路。
export function FileRelations({
  relPath,
  graph,
  onJump
}: {
  relPath: string
  graph: DepGraphResult
  onJump: (relPath: string) => void
}): React.JSX.Element | null {
  const importers = graph.edges.filter((edge) => edge.to === relPath).map((edge) => edge.from)
  const dependencies = graph.edges.filter((edge) => edge.from === relPath).map((edge) => edge.to)

  if (importers.length === 0 && dependencies.length === 0) {
    return (
      <div className="relations">
        <div className="structure-note">🕸️ 这个文件还没和别的文件连上线(没人引用它,它也不引用项目里的其他文件)</div>
      </div>
    )
  }

  return (
    <div className="relations">
      {importers.length > 0 && (
        <div className="structure-section">
          <div className="structure-section-title">
            🎯 影响范围:被这些文件引用
            <span className="structure-section-count">{importers.length}</span>
          </div>
          <div className="structure-chips">
            {importers.map((path) => (
              <button key={path} type="button" className="chip chip-sm chip-link" onClick={() => onJump(path)}>
                {path}
              </button>
            ))}
          </div>
        </div>
      )}
      {dependencies.length > 0 && (
        <div className="structure-section">
          <div className="structure-section-title">
            🕸️ 它引用了
            <span className="structure-section-count">{dependencies.length}</span>
          </div>
          <div className="structure-chips">
            {dependencies.map((path) => (
              <button key={path} type="button" className="chip chip-sm chip-link" onClick={() => onJump(path)}>
                {path}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
