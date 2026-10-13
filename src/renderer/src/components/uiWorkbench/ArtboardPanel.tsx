// 属性面板 · 画板分区:尺寸下拉(最近使用 / 我的预设 / 内置预设 / 自定义)+ 宽高输入 + 对调钮 + 预设存删钮;
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
  // 当前尺寸已存成我的预设时,书签钮变删除态(书签 X);手动选过「自定义」时不显示删除
  const savedId = isCustomPicked ? null : (matched?.savedId ?? null)

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
          isScrubbable={false}
          value={board.width}
          parse={parseArtboardSide}
          onCommit={(width) => onChange({ ...board, width })}
        />
        {/* 横竖互换:方向是宽高的派生属性不是独立配置,对调钮夹在框间;正方形对调无意义,禁态 */}
        <button
          type="button"
          className="uwb-field-btn"
          aria-label="对调宽高"
          aria-disabled={board.width === board.height || undefined}
          data-tip={board.width === board.height ? '正方形无需对调' : '对调宽高(横竖互换)'}
          onClick={() =>
            board.width !== board.height && onChange({ width: board.height, height: board.width })
          }
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m16 3 4 4-4 4" />
            <path d="M20 7H4" />
            <path d="m8 21-4-4 4-4" />
            <path d="M4 17h16" />
          </svg>
        </button>
        <NumberField
          label="高"
          ariaLabel="画板高"
          isScrubbable={false}
          value={board.height}
          parse={parseArtboardSide}
          onCommit={(height) => onChange({ ...board, height })}
        />
        {/* 存删预设:一键以当前尺寸命名存入(空名回落「宽 × 高」);已存时切换为删除态 */}
        <button
          type="button"
          className={`uwb-field-btn${savedId ? ' is-saved' : ''}`}
          aria-label={savedId ? '删除预设' : '存为预设'}
          data-tip={
            savedId ? `已存为预设,点此删除\n${matched?.label ?? ''}` : '存为预设(以当前尺寸命名)'
          }
          onClick={() => {
            if (savedId) onRemovePreset(savedId)
            else {
              setIsCustomPicked(false)
              onSavePreset('')
            }
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            {savedId ? (
              <>
                <path d="m14.5 7.5-5 5" />
                <path d="m9.5 7.5 5 5" />
              </>
            ) : (
              <>
                <path d="M12 7v6" />
                <path d="M9 10h6" />
              </>
            )}
          </svg>
        </button>
      </div>
    </section>
  )
}
