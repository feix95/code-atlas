// 属性面板通用数值框:回车或失焦提交,Esc 还原;非法输入还原为当前值,越界钳到合法范围。
// key 跟随数值:外部改值(拖画布、选预设)时输入框重挂,草稿随之刷新。
import { useRef } from 'react'

export function NumberField({
  label,
  value,
  parse,
  onCommit,
  inputRef,
  unit = 'px',
  placeholder,
  ariaLabel
}: {
  label: string
  /** null = 多值混合(显示空白 + placeholder) */
  value: number | null
  parse: (raw: string) => number | null
  onCommit: (value: number) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  unit?: string
  placeholder?: string
  ariaLabel?: string
}): React.JSX.Element {
  const selfRef = useRef<HTMLInputElement | null>(null)
  const ref = inputRef ?? selfRef

  function commit(input: HTMLInputElement): void {
    const parsed = parse(input.value)
    input.value = String(parsed ?? value ?? '')
    if (parsed !== null && parsed !== value) onCommit(parsed)
  }

  return (
    <label className="uwb-field">
      <span className="uwb-field-label">{label}</span>
      <input
        key={value}
        ref={ref}
        className="cfg-input uwb-input"
        inputMode="numeric"
        defaultValue={value ?? ''}
        placeholder={placeholder}
        aria-label={ariaLabel ?? label}
        spellCheck={false}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          // 回车提交后交出焦点:焦点留在框内时 Ctrl+Z 是输入框的文字撤销,
          // 交出去才能让工作台的文档撤销接管(Figma 同款交互)
          if (e.key === 'Enter') {
            commit(e.currentTarget)
            e.currentTarget.blur()
          } else if (e.key === 'Escape') e.currentTarget.value = String(value ?? '')
        }}
      />
      <span className="uwb-field-unit">{unit}</span>
    </label>
  )
}
