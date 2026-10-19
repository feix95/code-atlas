import { useCallback, useEffect, useRef, useState } from 'react'
import { IMAGE_ZOOM_PRESETS, parseImageZoomPercent } from '@shared/imageZoom'

/** 单击与双击拆开:等这一阵,没等到第二次点击才弹出档位菜单 */
const CLICK_WAIT_MS = 280

type ZoomCtlMode = 'idle' | 'menu' | 'edit'

/**
 * 图片缩放底栏控件:单击上拉档位、双击原地输入百分比。
 * 点外/Esc/滚轮收菜单;回车或失焦提交输入,Esc 放弃。
 */
export function ImageZoomControl({
  percent,
  disabled,
  onPick
}: {
  percent: number
  disabled: boolean
  onPick: (percent: number) => void
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const clickTimerRef = useRef<number>(0)
  const skipBlurRef = useRef(false)
  const [mode, setMode] = useState<ZoomCtlMode>('idle')
  const [draft, setDraft] = useState('')

  const close = useCallback((): void => setMode('idle'), [])

  useEffect(() => {
    const win = wrapRef.current?.ownerDocument.defaultView
    return () => {
      if (win && clickTimerRef.current) win.clearTimeout(clickTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (mode !== 'menu') return
    const el = wrapRef.current
    const doc = el?.ownerDocument
    if (!el || !doc) return
    const onDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && el.contains(e.target)) return
      close()
    }
    const onWheel = (e: WheelEvent): void => {
      if (e.target instanceof Node && el.contains(e.target)) return
      close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('wheel', onWheel, true)
    doc.addEventListener('keydown', onKey, true)
    return () => {
      doc.removeEventListener('mousedown', onDown, true)
      doc.removeEventListener('wheel', onWheel, true)
      doc.removeEventListener('keydown', onKey, true)
    }
  }, [mode, close])

  function clearClickTimer(): void {
    const win = wrapRef.current?.ownerDocument.defaultView
    if (win && clickTimerRef.current) win.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = 0
  }

  function onButtonClick(): void {
    if (disabled || mode === 'edit') return
    if (mode === 'menu') {
      close()
      return
    }
    const win = wrapRef.current?.ownerDocument.defaultView
    if (!win) return
    clearClickTimer()
    clickTimerRef.current = win.setTimeout(() => {
      clickTimerRef.current = 0
      setMode('menu')
    }, CLICK_WAIT_MS)
  }

  function onButtonDoubleClick(e: React.MouseEvent): void {
    e.preventDefault()
    if (disabled) return
    clearClickTimer()
    setDraft(String(percent))
    setMode('edit')
  }

  function commitDraft(raw: string, cancel: boolean): void {
    setMode('idle')
    if (cancel) return
    const next = parseImageZoomPercent(raw)
    if (next === null || next === percent) return
    onPick(next)
  }

  function pick(next: number): void {
    close()
    if (next !== percent) onPick(next)
  }

  if (mode === 'edit') {
    return (
      <div ref={wrapRef} className="image-chip image-zoom-ctl">
        <input
          className="image-zoom-input"
          value={draft}
          aria-label="输入缩放百分比"
          inputMode="numeric"
          spellCheck={false}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={(e) => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false
              return
            }
            commitDraft(e.currentTarget.value, false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              e.preventDefault()
              skipBlurRef.current = true
              commitDraft(draft, true)
            }
            e.stopPropagation()
          }}
        />
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="image-chip image-zoom-ctl">
      <button
        type="button"
        className="image-zoom-btn"
        aria-haspopup="listbox"
        aria-expanded={mode === 'menu'}
        aria-label="缩放百分比,点一下选档位,双击输入"
        disabled={disabled}
        onClick={onButtonClick}
        onDoubleClick={onButtonDoubleClick}
      >
        {percent}%
      </button>
      {mode === 'menu' && (
        <div className="image-zoom-menu" role="listbox" aria-label="缩放档位">
          {IMAGE_ZOOM_PRESETS.map((step) => (
            <button
              key={step}
              type="button"
              role="option"
              className={'image-zoom-opt' + (step === percent ? ' is-current' : '')}
              aria-selected={step === percent}
              onClick={() => pick(step)}
            >
              {step}%
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
