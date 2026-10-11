// 空区域占位:区域名 + 用途说明(灰字居中);compact 用于工具栏、面板顶栏这类窄条,单行显示
import { WORKBENCH_REGIONS, type WorkbenchRegionKey } from './regions'

export function RegionHint({
  region,
  compact = false
}: {
  region: WorkbenchRegionKey
  compact?: boolean
}): React.JSX.Element {
  const { name, hint } = WORKBENCH_REGIONS[region]
  return (
    <div className={`uwb-hint${compact ? ' is-compact' : ''}`}>
      <span className="uwb-hint-name">{name}</span>
      <span className="uwb-hint-text">{hint}</span>
    </div>
  )
}
