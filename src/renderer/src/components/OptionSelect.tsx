import { useEffect, useRef, useState } from 'react'
import { TreeIcon } from './Icons'

/** 档位下拉(第一百一十八锤补的语气下拉,讲解深度来了就泛化成通用款,照小葵的参考图):
 * 档名+介绍两行式 —— 原生 option 画不出两行,这一颗自己画。点外面或按 Esc 收起,选中项亮着。 */
export function OptionSelect<K extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: {
  options: Array<{ key: K; label: string; hint: string }>
  value: K
  onChange: (k: K) => void
  /** 列表弹开时的无障碍名:跟这行的 label 同名 */
  ariaLabel: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = options.find((o) => o.key === value) ?? options[0]
  return (
    <div className="tone-select" ref={rootRef}>
      <button
        type="button"
        className="tone-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {current.label}
        {/* 箭头照抄本文件图标册的 chevron(和其他控件同一颗),钉到最右;小葵点名加粗放大 */}
        <span className="tone-select-caret">
          <TreeIcon name="chevron" size={14} strokeWidth={4} mono />
        </span>
      </button>
      {open && (
        <div className="tone-select-list" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="option"
              aria-selected={o.key === value}
              className={`tone-select-item${o.key === value ? ' is-active' : ''}`}
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
            >
              <span className="tone-select-item-copy">
                <span className="tone-select-label">{o.label}</span>
                <span className="tone-select-hint">{o.hint}</span>
              </span>
              {o.key === value && (
                <span className="tone-select-tick" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
