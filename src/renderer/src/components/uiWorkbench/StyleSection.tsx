// 属性面板 · 「样式」分区(矩形、直线共用):下拉套用已存样式 + 「+」存为样式 + 「−」删除当前样式。
// 各工具自己的样式库、套用与回写规则由调用方传入;这里只管界面与「命名输入框」这一点本地状态,
// 保证所有可存样式的工具,这一块的位置、外观、交互完全一致。
import { useState } from 'react'
import { MinusIcon, PlusIcon, RowButton } from './RowButton'

export function StyleSection({
  styles,
  linkedId,
  onApply,
  onSave,
  onRemove
}: {
  styles: readonly { id: string; name: string }[]
  /** 当前对象挂着的样式 id;无样式或悬空为 '' */
  linkedId: string
  onApply: (id: string) => void
  /** 命名后存为样式;留空由调用方回落默认名 */
  onSave: (name: string) => void
  onRemove: () => void
}): React.JSX.Element {
  const [isNaming, setIsNaming] = useState(false)
  const [name, setName] = useState('')

  function commitName(): void {
    onSave(name)
    setIsNaming(false)
    setName('')
  }

  return (
    <section className="uwb-section" aria-label="样式">
      <h3 className="uwb-section-title">样式</h3>
      <div className="uwb-field-row">
        <select
          className="cfg-select uwb-select"
          aria-label="外观样式"
          value={linkedId}
          onChange={(e) => onApply(e.target.value)}
        >
          <option value="">无样式</option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <RowButton
          label="存为样式"
          icon={<PlusIcon />}
          onClick={() => {
            setIsNaming((v) => !v)
            setName('')
          }}
        />
        {linkedId && <RowButton label="删除样式" icon={<MinusIcon />} onClick={onRemove} />}
      </div>
      {isNaming && (
        <div className="uwb-field-row">
          <input
            className="cfg-input uwb-style-name"
            aria-label="样式名"
            placeholder={`同名覆盖;留空 = 样式 ${styles.length + 1}`}
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
    </section>
  )
}
