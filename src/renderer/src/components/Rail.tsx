// 第 2 层最左的图标列(UI v3 第 6 节):图谱 → 自由对话 → UI 工作台 → 设置,底端 AI 状态。
// 自由对话与 UI 工作台不吃工作区,没开项目也能点(没开项目时对话只是不带项目文件上下文)。
// 列宽 1u(= 顶栏高),与顶栏同底同色;图标 ~0.425u,点击区 ~0.75u。
// 图谱本体还没实现(规格见《项目结构图谱》),点开一张单例占位页签;
// AI 状态 = 三态图标 + 状态浮层(内容沿用旧文档第七节,细节在 RailAiStatus)。
import { TreeIcon } from './Icons'
import { RailAiStatus } from './RailAiStatus'

/** rail 图标本体 ≈0.425u ≈ 27px@100%(顶栏图标 ×0.85,规格给定) */
const RAIL_ICON = 25.3125

export function Rail({
  hasWorkspace,
  onGraph,
  onChat,
  onUiWorkbench,
  onSettings
}: {
  hasWorkspace: boolean
  /** 关系图谱:开/聚焦单例页签 */
  onGraph: () => void
  onChat: () => void
  onUiWorkbench: () => void
  onSettings: () => void
}): React.JSX.Element {
  return (
    <nav className="rail" aria-label="主导航">
      <button
        type="button"
        className="rail-btn"
        disabled={!hasWorkspace}
        onClick={onGraph}
        data-tip="关系图谱"
        data-tip-side="right"
        aria-label="关系图谱"
      >
        <TreeIcon name="view" size={RAIL_ICON} mono />
      </button>
      <button
        type="button"
        className="rail-btn"
        onClick={onChat}
        data-tip="自由对话"
        data-tip-side="right"
        aria-label="自由对话"
      >
        <TreeIcon name="bot" size={RAIL_ICON} mono />
      </button>
      <button
        type="button"
        className="rail-btn"
        onClick={onUiWorkbench}
        data-tip="UI 工作台"
        data-tip-side="right"
        aria-label="UI 工作台"
      >
        <TreeIcon name="palette" size={RAIL_ICON} mono />
      </button>
      <button
        type="button"
        className="rail-btn"
        onClick={onSettings}
        data-tip="设置"
        data-tip-side="right"
        aria-label="设置"
      >
        <TreeIcon name="gear" size={RAIL_ICON} mono />
      </button>
      {/* AI 状态:图标本体随模型状态切换(§6.1 唯一保色图标),点击弹状态浮层 */}
      <RailAiStatus />
    </nav>
  )
}
