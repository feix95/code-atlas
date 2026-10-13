// 左侧栏 · 样式组:把选中的若干对象(矩形、直线)存成一份 JSON 片段,之后点一下就整组放回画板。
// 放入的是散开的普通对象,可随意拆开、改动;整次放入合成一步撤销。
// 样式组是「素材」不是「外观」:外观样式放右侧属性面板(跟着选中对象走),这里放全局可复用的东西。
import { useState } from 'react'
import { describeGroup } from '@shared/uiWorkbench/groups'
import { useDocState } from '../../uiWorkbench/documentStore'
import { groupActions, useGroups } from '../../uiWorkbench/groupStore'
import { MinusIcon, PlusIcon, RowButton } from './RowButton'

const SAVE_NEEDS_SELECTION_TIP = '先在画布上选中要保存的对象'

export function GroupsPanel(): React.JSX.Element {
  const groups = useGroups()
  const hasSelection = useDocState().selectedIds.length > 0
  const [isNaming, setIsNaming] = useState(false)
  const [name, setName] = useState('')

  function commitName(): void {
    groupActions.saveSelection(name)
    setIsNaming(false)
    setName('')
  }

  return (
    <div className="uwb-groups">
      <div className="uwb-groups-head">
        <h3 className="uwb-section-title">样式组</h3>
        <button
          type="button"
          className="uwb-field-btn"
          aria-label="存为样式组"
          aria-disabled={!hasSelection || undefined}
          data-tip={hasSelection ? '把选中的对象存为样式组' : SAVE_NEEDS_SELECTION_TIP}
          onClick={() => {
            if (!hasSelection) return
            setIsNaming((v) => !v)
            setName('')
          }}
        >
          <PlusIcon />
        </button>
      </div>
      {isNaming && (
        <div className="uwb-field-row">
          <input
            className="cfg-input uwb-style-name"
            aria-label="样式组名"
            placeholder={`同名覆盖;留空 = 样式组 ${groups.length + 1}`}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              else if (e.key === 'Escape') setIsNaming(false)
            }}
          />
        </div>
      )}
      {groups.length === 0 ? (
        <p className="uwb-groups-empty">
          还没有样式组。选中几个对象,点上面的「+」存起来,之后点它就能整组放回画板。
        </p>
      ) : (
        <ul className="uwb-groups-list">
          {groups.map((g) => (
            <li key={g.id} className="uwb-group-row">
              <button
                type="button"
                className="uwb-group-item"
                data-tip="点击放入画板"
                onClick={() => groupActions.insert(g.id)}
              >
                <span className="uwb-group-name">{g.name}</span>
                <span className="uwb-group-meta">{describeGroup(g)}</span>
              </button>
              <RowButton
                label={`删除样式组「${g.name}」`}
                icon={<MinusIcon />}
                onClick={() => groupActions.remove(g.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
