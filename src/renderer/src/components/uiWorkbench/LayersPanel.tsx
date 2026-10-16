// 左侧栏 · 图层:当前页的对象列表,上层在上(Figma 同款)。
// 点行选中(Shift 加减选)、双击改名、眼睛显隐、锁头锁定、拖行调 z 序;鼠标停在行上,画布上描出对应对象。
// 图层 = 当前页节点数组的另一种视图:所有改动都走 docActions.dispatch,与画布手势、撤销共用一条路。
import { useEffect, useRef, useState } from 'react'
import { layerDisplayOrder, layerReorderIndex } from '@shared/uiWorkbench/layers'
import type { SceneNode } from '@shared/uiWorkbench/scene'
import { docActions, useDocState } from '../../uiWorkbench/documentStore'
import { setHoveredLayer } from '../../uiWorkbench/layerHoverStore'
import { dropMarkerClass, ROW_ATTR, useRowReorder } from '../../uiWorkbench/useRowReorder'
import { TreeIcon } from '../Icons'
import { InlineName } from './InlineName'
import { LayerKindIcon } from './LayerIcons'

const TOGGLE_ICON_SIZE = 14

/** 行尾开关钮:平时藏着,悬停行时出现;偏离默认状态(已锁定/已隐藏)时常亮,一眼看出哪些层被动过 */
function LayerToggle({
  isOn,
  isAttention,
  label,
  onIcon,
  offIcon,
  onToggle
}: {
  isOn: boolean
  isAttention: boolean
  label: string
  onIcon: string
  offIcon: string
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`uwb-field-btn uwb-layer-toggle${isAttention ? ' is-attention' : ''}`}
      aria-label={label}
      aria-pressed={isOn}
      data-tip={label}
      onClick={onToggle}
    >
      <TreeIcon name={isOn ? onIcon : offIcon} size={TOGGLE_ICON_SIZE} mono />
    </button>
  )
}

function patchLayer(
  id: string,
  patch: { name?: string; visible?: boolean; locked?: boolean }
): void {
  docActions.dispatch({ type: 'update', id, patch })
}

export function LayersPanel(): React.JSX.Element {
  const { nodes, selectedIds } = useDocState()
  const rows = layerDisplayOrder(nodes)
  const listRef = useRef<HTMLUListElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const { drag, startRow } = useRowReorder({
    listRef,
    onPress: (row, isShift) => {
      const id = rows[row].id
      if (isShift) docActions.toggleSelect(id)
      else if (!selectedIds.includes(id)) docActions.select(id)
    },
    onDrop: (fromRow, slot) => {
      const toIndex = layerReorderIndex(rows.length, fromRow, slot)
      if (toIndex !== null) docActions.dispatch({ type: 'reorder', id: rows[fromRow].id, toIndex })
    }
  })

  useEffect(() => () => setHoveredLayer(null), [])

  function renderRow(node: SceneNode, row: number): React.JSX.Element {
    const isSelected = selectedIds.includes(node.id)
    return (
      <li
        key={node.id}
        {...{ [ROW_ATTR]: '' }}
        className={`uwb-layer${isSelected ? ' is-selected' : ''}${node.visible ? '' : ' is-hidden'}${dropMarkerClass(drag, row, rows.length)}`}
        onPointerDown={(e) => startRow(e, row)}
        onDoubleClick={() => setEditingId(node.id)}
        onPointerEnter={() => setHoveredLayer(node.id)}
        onPointerLeave={() => setHoveredLayer(null)}
      >
        <LayerKindIcon type={node.type} />
        <InlineName
          value={node.name}
          label="图层名"
          className="uwb-layer-name"
          isEditing={editingId === node.id}
          onRename={(name) => patchLayer(node.id, { name })}
          onStopEditing={() => setEditingId(null)}
        />
        <LayerToggle
          isOn={node.locked}
          isAttention={node.locked}
          label={node.locked ? '解锁' : '锁定'}
          onIcon="lock"
          offIcon="lockOpen"
          onToggle={() => patchLayer(node.id, { locked: !node.locked })}
        />
        <LayerToggle
          isOn={node.visible}
          isAttention={!node.visible}
          label={node.visible ? '隐藏' : '显示'}
          onIcon="eye"
          offIcon="eyeOff"
          onToggle={() => patchLayer(node.id, { visible: !node.visible })}
        />
      </li>
    )
  }

  return (
    <section className="uwb-side-section uwb-layers" aria-label="图层">
      <div className="uwb-groups-head">
        <h3 className="uwb-section-title">图层</h3>
      </div>
      {rows.length === 0 ? (
        <p className="uwb-groups-empty">这一页还没有对象。用矩形或直线工具在画板上画一个。</p>
      ) : (
        <ul ref={listRef} className="uwb-layer-list">
          {rows.map(renderRow)}
        </ul>
      )}
    </section>
  )
}
