// 第 2 层最左的图标列(UI v3 · §6):图谱 → 概览 → 自由对话 → 设置,底端 AI 状态。
// 列宽 1u(= 顶栏高),与顶栏同底同色;图标 ~0.425u,点击区 ~0.75u。
// 图谱本体还没实现(规格见《项目关系图谱》),先挂位占位钮;
// AI 状态钮暂接 AI 设置,B4 换三态图标 + 状态浮层。
import { TreeIcon } from './Icons'

/** rail 图标本体 ≈0.425u ≈ 27px@100%(顶栏图标 ×0.85,规格给定) */
const RAIL_ICON = 27

export function Rail({
  hasWorkspace,
  onOverview,
  onChat,
  onSettings,
  onAiStatus
}: {
  hasWorkspace: boolean
  onOverview: () => void
  onChat: () => void
  onSettings: () => void
  onAiStatus: () => void
}): React.JSX.Element {
  return (
    <nav className="rail" aria-label="主导航">
      <button
        type="button"
        className="rail-btn"
        disabled
        title="关系图谱(规划中)"
        aria-label="关系图谱"
      >
        <TreeIcon name="view" size={RAIL_ICON} mono />
      </button>
      <button
        type="button"
        className="rail-btn"
        disabled={!hasWorkspace}
        onClick={onOverview}
        title="概览"
        aria-label="概览"
      >
        <TreeIcon name="navigation" size={RAIL_ICON} mono />
      </button>
      <button
        type="button"
        className="rail-btn"
        disabled={!hasWorkspace}
        onClick={onChat}
        title="自由对话"
        aria-label="自由对话"
      >
        <TreeIcon name="bot" size={RAIL_ICON} mono />
      </button>
      <button
        type="button"
        className="rail-btn"
        onClick={onSettings}
        title="设置"
        aria-label="设置"
      >
        <TreeIcon name="gear" size={RAIL_ICON} mono />
      </button>
      {/* AI 状态:先挂占位(插头灰 = 未加载态),B4 上三态图标 + 状态浮层 */}
      <button
        type="button"
        className="rail-btn rail-ai"
        onClick={onAiStatus}
        title="AI 状态"
        aria-label="AI 状态"
      >
        <TreeIcon name="unplug" size={RAIL_ICON} mono />
      </button>
    </nav>
  )
}
