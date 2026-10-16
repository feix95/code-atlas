// 属性面板分区行尾的 ghost 图标钮(加 / 减):与画板行的对调、存删预设同款。
// 矩形面板、直线面板、样式分区共用,图标只在这里登记一份。
const SVG_ICON = {
  viewBox: '0 0 24 24',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

export function PlusIcon(): React.JSX.Element {
  return (
    <svg {...SVG_ICON}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function MinusIcon(): React.JSX.Element {
  return (
    <svg {...SVG_ICON}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function RowButton({
  label,
  icon,
  onClick
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" className="uwb-field-btn" aria-label={label} onClick={onClick}>
      {icon}
    </button>
  )
}
