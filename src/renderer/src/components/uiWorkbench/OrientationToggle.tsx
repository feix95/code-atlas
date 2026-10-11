// 画板分区 · 横竖屏切换:点另一方向即对调宽高(画板不旋转);正方形无方向之分,两钮禁用。
import {
  artboardOrientation,
  withOrientation,
  type ArtboardOrientation,
  type ArtboardSize
} from '@shared/uiWorkbench/artboard'

const ORIENTATIONS: readonly { value: ArtboardOrientation; label: string }[] = [
  { value: 'portrait', label: '竖屏' },
  { value: 'landscape', label: '横屏' }
]

export function OrientationToggle({
  board,
  onChange
}: {
  board: ArtboardSize
  onChange: (size: ArtboardSize) => void
}): React.JSX.Element {
  const current = artboardOrientation(board)
  const isSquare = board.width === board.height
  return (
    <div className="uwb-field-row uwb-orient" role="group" aria-label="画板方向">
      <span className="uwb-field-label">方向</span>
      {ORIENTATIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className="cfg-btn"
          aria-pressed={!isSquare && current === o.value}
          disabled={isSquare}
          onClick={() => onChange(withOrientation(board, o.value))}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
