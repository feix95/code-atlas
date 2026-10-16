// 行内改名:平时是文字,进入编辑态变输入框;回车/失焦提交,Esc 放弃。图层与页面名共用。
// 是否编辑由所在行控制(双击要挂在整行上:行的按下手势有指针捕获,双击事件会落在行元素而不是名字上)。
// 提交的是原始输入,去空白、截断、留空保留原名由 sanitizeName 在仓库层统一处理。
import { useRef } from 'react'

export function InlineName({
  value,
  label,
  className,
  isEditing,
  onRename,
  onStopEditing
}: {
  value: string
  label: string
  className: string
  isEditing: boolean
  onRename: (next: string) => void
  onStopEditing: () => void
}): React.JSX.Element {
  const isCancelledRef = useRef(false)

  function finish(input: HTMLInputElement): void {
    onStopEditing()
    if (!isCancelledRef.current && input.value !== value) onRename(input.value)
    isCancelledRef.current = false
  }

  if (!isEditing) {
    return (
      <span className={className} data-tip="双击改名">
        {value}
      </span>
    )
  }
  return (
    <input
      className="cfg-input uwb-rename"
      aria-label={label}
      defaultValue={value}
      spellCheck={false}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          isCancelledRef.current = true
          e.currentTarget.blur()
        }
        e.stopPropagation()
      }}
    />
  )
}
