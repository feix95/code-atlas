// 图谱顶栏的 Wiki 入口:旧版生成弹窗与独立进度页已随旧版页面弃用退役,
// 生成与进度都在卡片墙里完成,这里只剩结构图与卡片墙的变形切换。
export function GraphWikiEntry({
  wallVisible,
  onToggleWall
}: {
  /** 卡片墙当前是否盖在画布上 */
  wallVisible: boolean
  onToggleWall: () => void
}): React.JSX.Element {
  return (
    <button type="button" className="graph-tool-text" onClick={onToggleWall}>
      {wallVisible ? '结构图' : '卡片墙'}
    </button>
  )
}
