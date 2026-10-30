// 悬停看法标签:贴在鼠标右下,显示当前看法与第几种 / 共几种;「同模块」看法下补一句有多少成员不在当前画面。
import { HOVER_MODE_LABEL } from '../graph/hoverModes'
import type { HoverModeTag } from '../graph/useGraphHoverMode'

export function GraphHoverTag({
  tag,
  elsewhere
}: {
  tag: HoverModeTag
  /** 「同模块」看法下,该模块不在当前画面上的成员文件数 */
  elsewhere: number
}): React.JSX.Element {
  return (
    <p
      className="graph-mode-tag"
      style={{ left: tag.x, top: tag.y }}
      role="status"
      aria-live="polite"
    >
      <span className="graph-mode-name">{HOVER_MODE_LABEL[tag.mode]}</span>
      <span className="graph-mode-count">
        {tag.index}/{tag.count}
      </span>
      {tag.mode === 'module' && elsewhere > 0 && (
        <span className="graph-mode-note">另有 {elsewhere} 个在其他文件夹</span>
      )}
    </p>
  )
}
