import type { DepGraphResult } from '@shared/types'

/**
 * 关系模组(概览页压轴):像「文件概览」「Atlas 小探针」一样独立成块 ——
 * 自带卡片壳和模组头,不再有露在面板上的标签小字(露天标签原来还和组件
 * 内部的说明叠成两行重复,一并治掉)。
 * 左「影响范围」右「它引用了」,双栏盒子。路径全部等宽字体、超长省略号,
 * 悬停看全路径,点击跳转对应文件(跳转保持当前 Tab,方便顺着关系链一路看下去)。
 * 一条连线都没有时也是同一个模组相,内容换成一行灰色小字轻轻带过,不抢眼。
 */
export function FileRelations({
  relPath,
  graph,
  onJump
}: {
  relPath: string
  graph: DepGraphResult
  onJump: (relPath: string) => void
}): React.JSX.Element {
  const importers = [
    ...new Set(graph.edges.filter((edge) => edge.to === relPath).map((edge) => edge.from))
  ]
  const dependencies = [
    ...new Set(graph.edges.filter((edge) => edge.from === relPath).map((edge) => edge.to))
  ]
  const total = importers.length + dependencies.length

  if (total === 0) {
    return (
      <section className="card relation-card">
        <header className="relation-card-head">
          文件关系 <span>谁引用了它、它引用谁、改它会牵连谁</span>
        </header>
        <p className="relation-empty-note">
          这个文件还没和项目里其他文件连上线 —— 没人引用它,它也不引用别人,多半是个独立的小脚本或入口
        </p>
      </section>
    )
  }

  return (
    <section className="card relation-card">
      <header className="relation-card-head">
        文件关系 <span>{total} 条引用 · 点击跳转,还停在概览</span>
      </header>
      <div className="relation-list">
        {importers.length > 0 && (
          <section className="relation-box">
            <h3>
              影响范围:被这些文件引用{' '}
              <span className="structure-section-count">{importers.length}</span>
            </h3>
            {importers.map((path) => (
              <button
                key={path}
                type="button"
                className="relation-link mono"
                data-tip={path}
                onClick={() => onJump(path)}
              >
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
              <button
                key={path}
                type="button"
                className="relation-link mono"
                data-tip={path}
                onClick={() => onJump(path)}
              >
                {path}
              </button>
            ))}
          </section>
        )}
      </div>
    </section>
  )
}
