/**
 * 设置行(Obsidian 式):左「标题 + 至多一句灰说明」,右控件;
 * stacked 竖排变体给 textarea/货架这类高控件 —— 标题说明占整行,控件在下一行。
 * 行间细线(.cfg-divider)与同组卡片(.cfg-panel)由外层管,这里只管一行。
 */
export function CfgRow({
  label,
  hint,
  stacked,
  children
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  stacked?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`cfg-row${stacked ? ' cfg-row-stack' : ''}`}>
      <div className="cfg-copy">
        <label>{label}</label>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </div>
  )
}

/** 行名旁的 ? 渐进披露钮:次要解释收进悬停气泡(data-tip 全场统一出口),不抢行内版面 */
export function CfgQ({ tip }: { tip: string }): React.JSX.Element {
  return (
    <button type="button" className="cfg-q" data-tip={tip} aria-label="说明">
      ?
    </button>
  )
}
