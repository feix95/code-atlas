// 属性面板 · 直线分区:位置(起点/终点坐标)、长度与角度(由两端点派生,改它们 = 起点不动重算终点)、
// 描边(颜色/线宽/线型/端点样式)。直线必有描边,没有「移除描边」。
// 数值一律经 dispatch 落地(钳边界、取 2 位小数由 applyLinePatch 收口)。
// onPatch / isDefaults:同 RectPanel,「新直线默认外观」模式下 node 是承载默认值的预览节点,只展示描边分区。
import { parseIntegerInput } from '@shared/uiWorkbench/numberInput'
import {
  LINE_CAPS,
  LINE_CAP_LABELS,
  lineAngle,
  lineLength,
  lineWithAngle,
  lineWithLength,
  type LineCap,
  type LineNode,
  type LinePatch
} from '@shared/uiWorkbench/line'
import {
  NODE_COORD_LIMIT,
  RECT_STROKE_WIDTH_MAX,
  normalizeRotation,
  type StrokeStyle
} from '@shared/uiWorkbench/node'
import { docActions } from '../../uiWorkbench/documentStore'
import { ColorField } from './ColorField'
import { NumberField } from './NumberField'

const coord = (raw: string): number | null =>
  parseIntegerInput(raw, -NODE_COORD_LIMIT, NODE_COORD_LIMIT)
const length = (raw: string): number | null => parseIntegerInput(raw, 1, NODE_COORD_LIMIT * 2)
const strokeWidth = (raw: string): number | null => parseIntegerInput(raw, 1, RECT_STROKE_WIDTH_MAX)
const angle = (raw: string): number | null => {
  const v = parseIntegerInput(raw, -NODE_COORD_LIMIT, NODE_COORD_LIMIT)
  return v === null ? null : normalizeRotation(v)
}

export function LinePanel({
  node,
  onPatch,
  isDefaults = false
}: {
  node: LineNode
  onPatch?: (patch: LinePatch) => void
  isDefaults?: boolean
}): React.JSX.Element {
  const patch =
    onPatch ??
    ((p: LinePatch): void => docActions.dispatch({ type: 'update', id: node.id, patch: p }))
  const { stroke } = node
  return (
    <>
      {isDefaults && (
        <section className="uwb-section" aria-label="新直线默认外观">
          <h3 className="uwb-section-title">新直线</h3>
          <span className="uwb-multi-hint">下面的外观会用于接下来画出的每条直线</span>
        </section>
      )}
      {!isDefaults && (
        <section className="uwb-section" aria-label={node.name}>
          <h3 className="uwb-section-title">{node.name}</h3>
          <div className="uwb-field-row">
            <NumberField
              label="起点 X"
              value={Math.round(node.x1)}
              parse={coord}
              onCommit={(x1) => patch({ x1 })}
              unit="px"
            />
            <NumberField
              label="Y"
              value={Math.round(node.y1)}
              parse={coord}
              onCommit={(y1) => patch({ y1 })}
              unit="px"
            />
          </div>
          <div className="uwb-field-row">
            <NumberField
              label="终点 X"
              value={Math.round(node.x2)}
              parse={coord}
              onCommit={(x2) => patch({ x2 })}
              unit="px"
            />
            <NumberField
              label="Y"
              value={Math.round(node.y2)}
              parse={coord}
              onCommit={(y2) => patch({ y2 })}
              unit="px"
            />
          </div>
          <div className="uwb-field-row">
            <NumberField
              label="长度"
              value={Math.round(lineLength(node))}
              parse={length}
              onCommit={(len) => patch(lineWithLength(node, len))}
              unit="px"
            />
            <NumberField
              label="角度"
              value={Math.round(lineAngle(node)) % 360}
              parse={angle}
              onCommit={(deg) => patch(lineWithAngle(node, deg))}
              unit="°"
            />
          </div>
        </section>
      )}
      <section className="uwb-section" aria-label="描边">
        <h3 className="uwb-section-title">描边</h3>
        <div className="uwb-field-row">
          <ColorField
            label="描边色"
            value={stroke.color}
            onCommit={(color) => patch({ stroke: { ...stroke, color } })}
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
            onChange={(e) => patch({ stroke: { ...stroke, style: e.target.value as StrokeStyle } })}
          >
            <option value="solid">实线</option>
            <option value="dashed">虚线</option>
          </select>
        </div>
        <div className="uwb-field-row">
          <select
            className="cfg-select uwb-select"
            aria-label="端点样式"
            value={node.cap}
            onChange={(e) => patch({ cap: e.target.value as LineCap })}
          >
            {LINE_CAPS.map((cap) => (
              <option key={cap} value={cap}>
                {`端点:${LINE_CAP_LABELS[cap]}`}
              </option>
            ))}
          </select>
        </div>
      </section>
    </>
  )
}
