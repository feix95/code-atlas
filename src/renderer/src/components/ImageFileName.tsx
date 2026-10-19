import { useRef, useState } from 'react'
import { fileBaseName, fileExtOf, type RenameOutcome } from '@shared/fileRename'

type NameMode = 'idle' | 'edit'

/**
 * 看图底栏文件名:同款芯片;双击改主名(扩展名保留),手感对齐缩放栏。
 * Enter/失焦提交,Esc 取消;提交走调用方 onRename,不在这里碰盘。
 */
export function ImageFileName({
  fileName,
  onRename
}: {
  fileName: string
  onRename?: (base: string) => Promise<RenameOutcome>
}): React.JSX.Element {
  const skipBlurRef = useRef(false)
  const doneRef = useRef(false)
  const [mode, setMode] = useState<NameMode>('idle')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const base = fileBaseName(fileName)
  const ext = fileExtOf(fileName)

  function beginEdit(e: React.MouseEvent): void {
    e.preventDefault()
    if (!onRename) return
    doneRef.current = false
    skipBlurRef.current = false
    setDraft(base)
    setMode('edit')
  }

  async function commit(raw: string, cancel: boolean): Promise<void> {
    if (doneRef.current) return
    doneRef.current = true
    const next = raw.trim()
    if (cancel || !onRename || next === '' || next === base) {
      setMode('idle')
      return
    }
    setBusy(true)
    await onRename(next)
    setBusy(false)
    setMode('idle')
  }

  if (mode === 'edit') {
    return (
      <div className="image-chip image-info-name">
        <input
          className="image-zoom-input"
          value={draft}
          size={Math.max(draft.length, 1)}
          disabled={busy}
          aria-label="新文件名(不含扩展名)"
          spellCheck={false}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false
              return
            }
            void commit(draft, false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              e.preventDefault()
              skipBlurRef.current = true
              void commit(draft, true)
            }
            e.stopPropagation()
          }}
        />
        {ext !== '' && <span className="image-info-ext">{ext}</span>}
      </div>
    )
  }

  return (
    <div className="image-chip image-info-name" data-tip={fileName}>
      <button
        type="button"
        className="image-zoom-btn"
        aria-label={onRename ? '文件名,双击改名' : '文件名'}
        disabled={!onRename}
        onDoubleClick={onRename ? beginEdit : undefined}
      >
        {fileName}
      </button>
    </div>
  )
}
