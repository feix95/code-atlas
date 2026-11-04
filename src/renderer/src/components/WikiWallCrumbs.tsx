// 线索桌顶部路径:「全景 › src › renderer」,点哪一段就飞回哪一层。
import type { WallScope } from '../wikiWallScopes'

export function WikiWallCrumbs({
  trail,
  onGo
}: {
  trail: readonly WallScope[]
  onGo: (key: string) => void
}): React.JSX.Element {
  return (
    <nav className="wiki-wall-crumbs" aria-label="所在层">
      {trail.map((scope, i) => {
        const last = i === trail.length - 1
        return (
          <span key={scope.key || 'top'} className="wiki-wall-crumb">
            {i > 0 && (
              <span className="wiki-wall-crumb-sep" aria-hidden="true">
                ›
              </span>
            )}
            {last ? (
              <span aria-current="location">{scope.title}</span>
            ) : (
              <button type="button" onClick={() => onGo(scope.key)}>
                {scope.title}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
