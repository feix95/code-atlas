// 属性面板 · 矩形分区:样式(整包外观方案:填充+描边+圆角,活链接)、位置(X/Y)、尺寸(宽/高)、
// 角度;圆角 = 四角同值 + 四角分设(混合显示空);外观 = 填充(可空)+ 描边(可空,含线宽/线型)。
// 样式规则:应用 = 挂 styleId 并写入定义值;手动改外观 = 静默脱钩;同名保存 = 覆盖定义并回写所有挂接节点。
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
import { appearanceOf } from '@shared/uiWorkbench/styles'
import { docActions, getDocState } from '../../uiWorkbench/documentStore'
import { newRectDefaultsActions } from '../../uiWorkbench/newRectDefaultsStore'
import { styleActions, useStyles } from '../../uiWorkbench/styleStore'
import { NumberField } from './NumberField'
import { ColorField } from './ColorField'
import { MinusIcon, PlusIcon, RowButton } from './RowButton'
import { StyleSection } from './StyleSection'

const CORNER_LABELS = ['左上', '右上', '右下', '左下'] as const

/** onPatch 缺省 = 改文档里的这个节点;传入则改别处(「新矩形默认外观」模式:node 是承载默认值的
 *  预览节点,只展示外观分区,位置/尺寸/角度由拖出矩形时决定,面板不给) */
export function RectPanel({
  node,
  onPatch,
  isDefaults = false
}: {
  node: RectNode
  onPatch?: (patch: RectPatch) => void
  isDefaults?: boolean
}): React.JSX.Element {
  const radiusLimit = maxCornerRadius(node.width, node.height)
  const stroke = node.stroke
  const patch =
    onPatch ??
    ((p: RectPatch): void => docActions.dispatch({ type: 'update', id: node.id, patch: p }))
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
  const styles = useStyles()
  // 挂着的方案 id;定义被删的悬空 id 按「无样式」落位
  const linkedId = styles.some((s) => s.id === node.styleId) ? (node.styleId ?? '') : ''

  /** 应用方案:写入定义值 + 挂 styleId(一次 dispatch = 一笔撤销);空值 = 脱钩 */
  function applyStyle(id: string): void {
    if (id === '') {
      patch({ styleId: null })
      newRectDefaultsActions.rememberStyle(null)
      return
    }
    const s = styles.find((it) => it.id === id)
    if (!s) return
    patch({
      fill: s.fill,
      stroke: s.stroke,
      radii: [...s.radii] as typeof node.radii,
      styleId: s.id
    })
    newRectDefaultsActions.rememberStyle(s.id, s)
  }

  /** 存为样式:同名覆盖并把新定义回写所有挂接节点(活链接);最后把当前矩形挂上(或保持挂) */
  function saveStyle(name: string): void {
    const { id, overwrote } = styleActions.save(name, appearanceOf(node))
    docActions.beginBatch()
    try {
      if (overwrote) {
        for (const n of getDocState().nodes) {
          if (n.type === 'rect' && n.styleId === id) {
            const s = appearanceOf(node)
            docActions.dispatch({ type: 'update', id: n.id, patch: { ...s, styleId: id } })
          }
        }
      }
      if (node.styleId !== id) patch({ styleId: id })
      newRectDefaultsActions.rememberStyle(id, appearanceOf(node))
    } finally {
      docActions.endBatch()
    }
  }

  /** 删除样式定义:挂着的节点保留当前数值、统一脱钩(进文档批次,可撤销) */
  function removeStyle(): void {
    if (!linkedId) return
    styleActions.remove(linkedId)
    docActions.beginBatch()
    try {
      for (const n of getDocState().nodes) {
        if (n.type === 'rect' && n.styleId === linkedId) {
          docActions.dispatch({ type: 'update', id: n.id, patch: { styleId: null } })
        }
      }
    } finally {
      docActions.endBatch()
    }
    // 默认外观节点不在文档里,上面的循环扫不到它
    if (isDefaults) patch({ styleId: null })
  }

  return (
    <>
      {isDefaults && (
        <section className="uwb-section" aria-label="新矩形默认外观">
          <h3 className="uwb-section-title">新矩形</h3>
          <span className="uwb-multi-hint">下面的外观会用于接下来画出的每个矩形</span>
        </section>
      )}
      <StyleSection
        styles={styles}
        linkedId={linkedId}
        onApply={applyStyle}
        onSave={saveStyle}
        onRemove={removeStyle}
      />
      {!isDefaults && (
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
      )}
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
            <CornerField
              key={i}
              node={node}
              corner={i as CornerIndex}
              parse={radius}
              patch={patch}
            />
          ))}
        </div>
        <div className="uwb-field-row">
          {CORNER_KEYS.slice(2).map((_, i) => (
            <CornerField
              key={i + 2}
              node={node}
              corner={(i + 2) as CornerIndex}
              parse={radius}
              patch={patch}
            />
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
                icon={<PlusIcon />}
                onClick={() => patch({ fill: RECT_DEFAULT_FILL })}
              />
            </>
          ) : (
            <>
              <ColorField label="填充色" value={node.fill} onCommit={(fill) => patch({ fill })} />
              <RowButton
                label="移除填充"
                icon={<MinusIcon />}
                onClick={() => patch({ fill: null })}
              />
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
              icon={<PlusIcon />}
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
                icon={<MinusIcon />}
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
  parse,
  patch
}: {
  node: RectNode
  corner: CornerIndex
  parse: (raw: string) => number | null
  patch: (p: RectPatch) => void
}): React.JSX.Element {
  return (
    <NumberField
      label={CORNER_LABELS[corner]}
      value={node.radii[corner]}
      parse={parse}
      onCommit={(r) => patch({ radii: withCornerRadius(node.radii, corner, r) })}
      unit="px"
    />
  )
}
