// 属性面板 · 矩形分区:位置(X/Y)、尺寸(宽/高)、角度;圆角 = 四角同值 + 四角分设(混合显示空);
// 外观 = 填充(可空)+ 描边(可空,含线宽/线型)。不填/不勾走 null,不写哨兵值。
// 数值一律经 dispatch 落地(取整、钳边界、四角不超过短边一半由 applyRectPatch 收口)。
import { parseIntegerInput } from '@shared/uiWorkbench/numberInput'
import {
  CORNER_KEYS,
  maxCornerRadius,
  normalizeRotation,
  uniformRadius,
  withCornerRadius,
  RECT_DEFAULT_FILL,
  RECT_DEFAULT_STROKE,
  RECT_STROKE_WIDTH_MAX,
  type CornerIndex,
  type RectNode,
  type RectPatch,
  type StrokeStyle
} from '@shared/uiWorkbench/node'
import { ARTBOARD_SIDE_MAX, ARTBOARD_SIDE_MIN } from '@shared/uiWorkbench/artboard'
import { NODE_COORD_LIMIT } from '@shared/uiWorkbench/node'
import { docActions } from '../../uiWorkbench/documentStore'
import { NumberField } from './NumberField'
import { ColorField } from './ColorField'

const CORNER_LABELS = ['左上', '右上', '右下', '左下'] as const

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

const PLUS_ICON = (
  <svg {...SVG_ICON}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const MINUS_ICON = (
  <svg {...SVG_ICON}>
    <path d="M5 12h14" />
  </svg>
)

/** 分区行尾 ghost 图标钮(加 / 减):与画板行的对调、存删预设同款 */
function RowButton({
  label,
  icon,
  onClick
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="uwb-field-btn"
      aria-label={label}
      data-tip={label}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}

export function RectPanel({ node }: { node: RectNode }): React.JSX.Element {
  const radiusLimit = maxCornerRadius(node.width, node.height)
  const stroke = node.stroke
  const patch = (p: RectPatch): void =>
    docActions.dispatch({ type: 'update', id: node.id, patch: p })
  const coord = (raw: string): number | null =>
    parseIntegerInput(raw, -NODE_COORD_LIMIT, NODE_COORD_LIMIT)
  const side = (raw: string): number | null =>
    parseIntegerInput(raw, ARTBOARD_SIDE_MIN, ARTBOARD_SIDE_MAX)
  const radius = (raw: string): number | null => parseIntegerInput(raw, 0, radiusLimit)
  const strokeWidth = (raw: string): number | null =>
    parseIntegerInput(raw, 1, RECT_STROKE_WIDTH_MAX)
  const angle = (raw: string): number | null => {
    const v = parseIntegerInput(raw, -NODE_COORD_LIMIT, NODE_COORD_LIMIT)
    return v === null ? null : normalizeRotation(v)
  }
  return (
    <>
      <section className="uwb-section" aria-label={node.name}>
        <h3 className="uwb-section-title">{node.name}</h3>
        <div className="uwb-field-row">
          <NumberField
            label="X"
            value={node.x}
            parse={coord}
            onCommit={(x) => patch({ x })}
            unit="px"
          />
          <NumberField
            label="Y"
            value={node.y}
            parse={coord}
            onCommit={(y) => patch({ y })}
            unit="px"
          />
        </div>
        <div className="uwb-field-row">
          <NumberField
            label="宽"
            value={node.width}
            parse={side}
            onCommit={(width) => patch({ width })}
            unit="px"
          />
          <NumberField
            label="高"
            value={node.height}
            parse={side}
            onCommit={(height) => patch({ height })}
            unit="px"
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
          unit="px"
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
      <section className="uwb-section" aria-label="填充">
        <h3 className="uwb-section-title">填充</h3>
        <div className="uwb-field-row">
          {node.fill === null ? (
            <>
              <span className="uwb-field-empty">不填充</span>
              <RowButton
                label="添加填充"
                icon={PLUS_ICON}
                onClick={() => patch({ fill: RECT_DEFAULT_FILL })}
              />
            </>
          ) : (
            <>
              <ColorField label="填充色" value={node.fill} onCommit={(fill) => patch({ fill })} />
              <RowButton label="移除填充" icon={MINUS_ICON} onClick={() => patch({ fill: null })} />
            </>
          )}
        </div>
      </section>
      <section className="uwb-section" aria-label="描边">
        <h3 className="uwb-section-title">描边</h3>
        {stroke === null ? (
          <div className="uwb-field-row">
            <span className="uwb-field-empty">不描边</span>
            <RowButton
              label="添加描边"
              icon={PLUS_ICON}
              onClick={() => patch({ stroke: RECT_DEFAULT_STROKE })}
            />
          </div>
        ) : (
          <>
            <div className="uwb-field-row">
              <ColorField
                label="描边色"
                value={stroke.color}
                onCommit={(color) => patch({ stroke: { ...stroke, color } })}
              />
              <RowButton
                label="移除描边"
                icon={MINUS_ICON}
                onClick={() => patch({ stroke: null })}
              />
            </div>
            <div className="uwb-field-row">
              <NumberField
                label="线宽"
                value={stroke.width}
                parse={strokeWidth}
                onCommit={(width) => patch({ stroke: { ...stroke, width } })}
              />
              <select
                className="cfg-select uwb-select"
                aria-label="线型"
                value={stroke.style}
                onChange={(e) =>
                  patch({ stroke: { ...stroke, style: e.target.value as StrokeStyle } })
                }
              >
                <option value="solid">实线</option>
                <option value="dashed">虚线</option>
              </select>
            </div>
          </>
        )}
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
      unit="px"
    />
  )
}
