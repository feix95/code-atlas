// 间距标注覆盖层:等间距吸附命中、或拖动中按住 Alt/Ctrl/Shift 时,画出「谁和谁之间多少像素」。
// 设计单位 → 屏幕坐标,线与数字都不随缩放变形(PS / Figma 智能参考线同款)。
import type { GapMark } from '@shared/uiWorkbench/spacing'
import type { CanvasViewportApi } from '../../uiWorkbench/useCanvasViewport'

const TICK_PX = 4

const formatGap = (value: number): string => String(Math.round(value * 10) / 10)

export function GapMarks({
  marks,
  view
}: {
  marks: readonly GapMark[]
  view: CanvasViewportApi['view']
}): React.JSX.Element {
  const sx = (x: number): number => view.panX + x * view.zoom
  const sy = (y: number): number => view.panY + y * view.zoom
  return (
    <svg className="uwb-overlay" aria-hidden="true">
      {marks.map((m) => {
        const x1 = sx(m.x1)
        const y1 = sy(m.y1)
        const x2 = sx(m.x2)
        const y2 = sy(m.y2)
        const isHorizontal = m.axis === 'h'
        return (
          <g key={`${m.axis}:${m.x1}:${m.y1}:${m.x2}:${m.y2}`}>
            <line className="uwb-gap-line" x1={x1} y1={y1} x2={x2} y2={y2} />
            {isHorizontal ? (
              <>
                <line
                  className="uwb-gap-line"
                  x1={x1}
                  y1={y1 - TICK_PX}
                  x2={x1}
                  y2={y1 + TICK_PX}
                />
                <line
                  className="uwb-gap-line"
                  x1={x2}
                  y1={y2 - TICK_PX}
                  x2={x2}
                  y2={y2 + TICK_PX}
                />
              </>
            ) : (
              <>
                <line
                  className="uwb-gap-line"
                  x1={x1 - TICK_PX}
                  y1={y1}
                  x2={x1 + TICK_PX}
                  y2={y1}
                />
                <line
                  className="uwb-gap-line"
                  x1={x2 - TICK_PX}
                  y1={y2}
                  x2={x2 + TICK_PX}
                  y2={y2}
                />
              </>
            )}
            <text
              className="uwb-gap-label"
              x={(x1 + x2) / 2 + (isHorizontal ? 0 : TICK_PX * 2)}
              y={(y1 + y2) / 2 + (isHorizontal ? -TICK_PX * 2 : 0)}
              textAnchor={isHorizontal ? 'middle' : 'start'}
              dominantBaseline={isHorizontal ? 'auto' : 'middle'}
            >
              {formatGap(m.value)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
