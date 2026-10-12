// 属性面板 · 矩形分区:位置(X/Y)、尺寸(宽/高)、角度;圆角 = 四角同值 + 四角分设(混合显示空)。
// 数值一律经 dispatch 落地(取整、钳边界、四角不超过短边一半由 applyRectPatch 收口)。
import { parseIntegerInput } from '@shared/uiWorkbench/numberInput'
import {
  CORNER_KEYS,
  maxCornerRadius,
  normalizeRotation,
  uniformRadius,
  withCornerRadius,
  type CornerIndex,
  type RectNode,
  type RectPatch
} from '@shared/uiWorkbench/node'
import { ARTBOARD_SIDE_MAX, ARTBOARD_SIDE_MIN } from '@shared/uiWorkbench/artboard'
import { NODE_COORD_LIMIT } from '@shared/uiWorkbench/node'
import { docActions } from '../../uiWorkbench/documentStore'
import { NumberField } from './NumberField'

const CORNER_LABELS = ['左上', '右上', '右下', '左下'] as const

export function RectPanel({ node }: { node: RectNode }): React.JSX.Element {
  const radiusLimit = maxCornerRadius(node.width, node.height)
  const patch = (p: RectPatch): void =>
    docActions.dispatch({ type: 'update', id: node.id, patch: p })
  const coord = (raw: string): number | null =>
    parseIntegerInput(raw, -NODE_COORD_LIMIT, NODE_COORD_LIMIT)
  const side = (raw: string): number | null =>
    parseIntegerInput(raw, ARTBOARD_SIDE_MIN, ARTBOARD_SIDE_MAX)
  const radius = (raw: string): number | null => parseIntegerInput(raw, 0, radiusLimit)
  const angle = (raw: string): number | null => {
    const v = parseIntegerInput(raw, -NODE_COORD_LIMIT, NODE_COORD_LIMIT)
    return v === null ? null : normalizeRotation(v)
  }
  return (
    <>
      <section className="uwb-section" aria-label={node.name}>
        <h3 className="uwb-section-title">{node.name}</h3>
        <div className="uwb-field-row">
          <NumberField label="X" value={node.x} parse={coord} onCommit={(x) => patch({ x })} />
          <NumberField label="Y" value={node.y} parse={coord} onCommit={(y) => patch({ y })} />
        </div>
        <div className="uwb-field-row">
          <NumberField
            label="宽"
            value={node.width}
            parse={side}
            onCommit={(width) => patch({ width })}
          />
          <NumberField
            label="高"
            value={node.height}
            parse={side}
            onCommit={(height) => patch({ height })}
          />
        </div>
        <div className="uwb-field-row">
          <NumberField
            label="角度"
            value={node.rotation}
            parse={angle}
            onCommit={(rotation) => patch({ rotation })}
            unit="°"
          />
        </div>
      </section>
      <section className="uwb-section" aria-label="圆角">
        <h3 className="uwb-section-title">圆角</h3>
        <NumberField
          label="四角"
          value={uniformRadius(node.radii)}
          placeholder="多值"
          parse={radius}
          onCommit={(r) => patch({ radii: withCornerRadius(node.radii, 'all', r) })}
        />
        <div className="uwb-field-row">
          {CORNER_KEYS.slice(0, 2).map((_, i) => (
            <CornerField key={i} node={node} corner={i as CornerIndex} parse={radius} />
          ))}
        </div>
        <div className="uwb-field-row">
          {CORNER_KEYS.slice(2).map((_, i) => (
            <CornerField key={i + 2} node={node} corner={(i + 2) as CornerIndex} parse={radius} />
          ))}
        </div>
      </section>
    </>
  )
}

function CornerField({
  node,
  corner,
  parse
}: {
  node: RectNode
  corner: CornerIndex
  parse: (raw: string) => number | null
}): React.JSX.Element {
  return (
    <NumberField
      label={CORNER_LABELS[corner]}
      value={node.radii[corner]}
      parse={parse}
      onCommit={(r) =>
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: { radii: withCornerRadius(node.radii, corner, r) }
        })
      }
    />
  )
}
