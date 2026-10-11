// 画板分区 · 预设存删:「存为预设」展开命名框(回车保存、Esc 取消,留空以尺寸命名);
// 当前尺寸命中我的预设时显示「删除预设」。Electron 不支持 window.prompt,命名框内联在面板里。
import { useState } from 'react'
import type { ArtboardSize } from '@shared/uiWorkbench/artboard'
import { formatSize, PRESET_NAME_MAX } from '@shared/uiWorkbench/artboardPrefs'

type FormMode = 'idle' | 'naming'

export function SavePresetForm({
  board,
  removableId,
  onSave,
  onRemove
}: {
  board: ArtboardSize
  /** 当前选中的我的预设 id;null 表示没有可删的 */
  removableId: string | null
  onSave: (name: string) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<FormMode>('idle')
  const [name, setName] = useState('')

  function close(): void {
    setMode('idle')
    setName('')
  }

  function save(): void {
    onSave(name)
    close()
  }

  if (mode === 'naming') {
    return (
      <div className="uwb-field-row">
        <input
          autoFocus
          className="cfg-input uwb-input"
          aria-label="预设名称"
          placeholder={formatSize(board)}
          maxLength={PRESET_NAME_MAX}
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            else if (e.key === 'Escape') close()
          }}
        />
        <button type="button" className="cfg-btn" onClick={save}>
          保存
        </button>
        <button type="button" className="cfg-btn is-ghost" onClick={close}>
          取消
        </button>
      </div>
    )
  }

  return (
    <div className="uwb-field-row">
      <button type="button" className="cfg-btn" onClick={() => setMode('naming')}>
        存为预设
      </button>
      {removableId && (
        <button type="button" className="cfg-btn is-ghost" onClick={() => onRemove(removableId)}>
          删除预设
        </button>
      )}
    </div>
  )
}
