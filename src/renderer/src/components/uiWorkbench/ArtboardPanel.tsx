// 属性面板 · 画板分区:尺寸下拉(最近使用 / 我的预设 / 内置预设 / 自定义)+ 宽高输入 + 横竖屏 + 预设存删;
// 宽高回车或失焦提交,Esc 还原;非法输入还原为当前值,越界钳到合法范围。
import { useMemo, useRef, useState } from 'react'
import { parseArtboardSide, type ArtboardSize } from '@shared/uiWorkbench/artboard'
import type { ArtboardPrefs } from '@shared/uiWorkbench/artboardPrefs'
import {
  buildArtboardOptionGroups,
  CUSTOM_OPTION,
  findArtboardOption,
  matchArtboardOption
} from '../../uiWorkbench/artboardOptions'
import { NumberField } from './NumberField'
import { OrientationToggle } from './OrientationToggle'
import { SavePresetForm } from './SavePresetForm'

export function ArtboardPanel({
  board,
  prefs,
  onChange,
  onSavePreset,
  onRemovePreset
}: {
  board: ArtboardSize
  prefs: ArtboardPrefs
  onChange: (size: ArtboardSize) => void
  onSavePreset: (name: string) => void
  onRemovePreset: (id: string) => void
}): React.JSX.Element {
  // 选「自定义」时尺寸不变,下拉须停在「自定义」而不是被当前尺寸匹配回预设
  const [isCustomPicked, setIsCustomPicked] = useState(false)
  const widthRef = useRef<HTMLInputElement | null>(null)
  const groups = useMemo(() => buildArtboardOptionGroups(prefs), [prefs])
  const matched = matchArtboardOption(groups, board)
  const selectValue = isCustomPicked || !matched ? CUSTOM_OPTION : matched.value

  function pickOption(value: string): void {
    const option = findArtboardOption(groups, value)
    setIsCustomPicked(!option)
    if (option) onChange(option.size)
    else widthRef.current?.focus()
  }

  return (
    <section className="uwb-section" aria-label="画板">
      <h3 className="uwb-section-title">画板</h3>
      <select
        className="cfg-select uwb-select"
        aria-label="画板尺寸预设"
        value={selectValue}
        onChange={(e) => pickOption(e.target.value)}
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM_OPTION}>自定义</option>
      </select>
      <div className="uwb-field-row">
        <NumberField
          inputRef={widthRef}
          label="宽"
          ariaLabel="画板宽"
          value={board.width}
          parse={parseArtboardSide}
          onCommit={(width) => onChange({ ...board, width })}
        />
        <NumberField
          label="高"
          ariaLabel="画板高"
          value={board.height}
          parse={parseArtboardSide}
          onCommit={(height) => onChange({ ...board, height })}
        />
      </div>
      <OrientationToggle board={board} onChange={onChange} />
      <SavePresetForm
        board={board}
        removableId={isCustomPicked ? null : (matched?.savedId ?? null)}
        onSave={(name) => {
          setIsCustomPicked(false)
          onSavePreset(name)
        }}
        onRemove={onRemovePreset}
      />
    </section>
  )
}
