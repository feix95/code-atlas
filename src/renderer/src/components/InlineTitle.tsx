import { useRef, useState } from 'react'
import type { RenameOutcome } from '@shared/fileRename'

/**
 * 可改名的内联标题(·Obsidian inline title):
 * 平时一行大字,点进去原地变输入框 —— Enter/失焦提交,Esc 取消;
 * 提交期间输入框锁住等回执,成败都由调用方(RenameOutcome)发话。
 * onRename 缺席 = 纯展示(聊天消息里的 MiniMD 等老用法,点着也没戏)。
 */
export function InlineTitle({
  title,
  onRename
}: {
  title: string
  onRename?: (base: string) => Promise<RenameOutcome>
}): React.JSX.Element {
  /** 编辑中的草稿;null = 大字展示态 */
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 提交只跑一次:disabled 触发的 blur、连按的 Enter,都靠这道闸挡住 */
  const doneRef = useRef(false)

  const beginEdit = (): void => {
    if (!onRename) return
    doneRef.current = false
    setDraft(title)
  }

  const commit = async (value: string, cancel: boolean): Promise<void> => {
    if (doneRef.current) return
    doneRef.current = true
    const v = value.trim()
    if (cancel || v === '' || v === title || !onRename) {
      setDraft(null)
      return
    }
    setBusy(true)
    await onRename(v)
    setBusy(false)
    setDraft(null)
  }

  if (draft === null) {
    return (
      <div
        className="md-title"
        role={onRename ? 'button' : undefined}
        tabIndex={onRename ? 0 : undefined}
        onClick={onRename ? beginEdit : undefined}
        onKeyDown={
          onRename
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  beginEdit()
                }
              }
            : undefined
        }
      >
        {title}
      </div>
    )
  }
  return (
    <div className="md-title is-editing">
      <input
        className="md-title-input"
        value={draft}
        disabled={busy}
        aria-label="新文件名(不含扩展名)"
        ref={(el) => {
          if (el) {
            el.focus()
            el.select()
          }
        }}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit(draft, false)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            void commit(draft, true)
          }
        }}
        onBlur={() => void commit(draft, false)}
      />
    </div>
  )
}
