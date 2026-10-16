// 图层行的类型图标(矩形 / 直线):与 RowButton 里的加减号同一套 16px 线稿笔触。
import type { SceneNode } from '@shared/uiWorkbench/scene'

const KIND_ICON = {
  viewBox: '0 0 24 24',
  width: 14,
  height: 14,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

export function LayerKindIcon({ type }: { type: SceneNode['type'] }): React.JSX.Element {
  return (
    <svg {...KIND_ICON}>
      {type === 'rect' ? (
        <rect x="4" y="5" width="16" height="14" rx="2" />
      ) : (
        <path d="M5 19 19 5" />
      )}
    </svg>
  )
}
