/**
 * 设置行(Edge 式):左「标题 + 至多一句灰说明」,右控件;
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
  children: React.ReactNode
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
