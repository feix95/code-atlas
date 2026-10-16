// 属性面板 · 画板分区(选中画板时):位置(X/Y)、尺寸(预设下拉 + 宽高)、填充。
// 画板固定不旋转、无圆角、无描边、不挂样式(见 shared/frame.ts),所以只有这三块。
// 尺寸预设与「最近使用 / 我的预设」仍由本机偏好管(artboardPrefsStore),画板只是用它。
import { parseIntegerInput } from '@shared/uiWorkbench/numberInput'
import type { ArtboardSize } from '@shared/uiWorkbench/artboard'
import { FRAME_DEFAULT_FILL, type FrameNode, type FramePatch } from '@shared/uiWorkbench/frame'
import { NODE_COORD_LIMIT } from '@shared/uiWorkbench/node'
import { artboardPrefsActions, useArtboardPrefs } from '../../uiWorkbench/artboardPrefsStore'
import { docActions } from '../../uiWorkbench/documentStore'
import { ArtboardPanel } from './ArtboardPanel'
import { ColorField } from './ColorField'
import { NumberField } from './NumberField'
import { MinusIcon, PlusIcon, RowButton } from './RowButton'

const coord = (raw: string): number | null =>
  parseIntegerInput(raw, -NODE_COORD_LIMIT, NODE_COORD_LIMIT)

export function FramePanel({ node }: { node: FrameNode }): React.JSX.Element {
  const prefs = useArtboardPrefs()
  const patch = (p: FramePatch): void =>
    docActions.dispatch({ type: 'update', id: node.id, patch: p })
  const size: ArtboardSize = { width: node.width, height: node.height }

  function resize(next: ArtboardSize): void {
    patch(next)
    artboardPrefsActions.record(next)
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
      </section>
      <ArtboardPanel
        board={size}
        prefs={prefs}
        onChange={resize}
        onSavePreset={(name) => artboardPrefsActions.savePreset(name, size)}
        onRemovePreset={artboardPrefsActions.removePreset}
      />
      <section className="uwb-section" aria-label="填充">
        <h3 className="uwb-section-title">填充</h3>
        <div className="uwb-field-row">
          {node.fill === null ? (
            <>
              <span className="uwb-field-empty">不填充</span>
              <RowButton
                label="添加填充"
                icon={<PlusIcon />}
                onClick={() => patch({ fill: FRAME_DEFAULT_FILL })}
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
    </>
  )
}
